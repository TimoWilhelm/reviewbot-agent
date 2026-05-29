// REVIEWBOT — checkpoint 4: Human-in-the-loop + scheduling
//
// What's new since checkpoint 3:
//   - `postReview` tool gated by `needsApproval` — the UI renders Approve /
//     Reject buttons before it runs. Mirrors the blog's "break glass" idea.
//   - `scheduleRecheck` tool calls `this.schedule()`; the DO alarm fires the
//     `recheckReview` handler which re-runs the workflow.
//   - `listSchedules` tool exposes the schedule API.
//
// The `ReviewWorkflow` class is RE-EXPORTED below — Cloudflare requires every
// Workflow class to be exported from the Worker entrypoint or the binding
// silently no-ops at runtime. This is the single most common production bug.

import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText
} from "ai";
import {
  initialReviewbotState,
  type Review,
  type ReviewbotState
} from "./state";
import { REVIEWBOT_MODEL } from "./lib/aiReview";
import {
  fetchPullRequestTool,
  reviewDiffTool,
  runReviewWorkflowTool,
  postReviewTool,
  scheduleRecheckTool,
  listSchedulesTool
} from "./tools";

const SYSTEM_PROMPT = `You are REVIEWBOT, a sharp but fair AI code reviewer.

You can fetch public GitHub PRs, run a multi-specialist review on them, ask the
human to approve before "posting" the result, and schedule follow-up rechecks.

Default flow:
1. User asks for a review → call \`runReviewWorkflow\`. The result streams into
   the UI; you should NOT recite every finding in chat.
2. When the workflow finishes, give a short verdict + counts summary.
3. If the user says "post it" or "approve it" or similar, call \`postReview\`.
   The UI will ask the human to confirm.
4. If the user says "check this again in N minutes", call \`scheduleRecheck\`.

Only fall back to \`reviewDiff\` if the user explicitly asks for a single-shot
generalist review (useful for comparing approaches).

Rules:
- Be concrete. Reference file names and line numbers.
- Be brief. Bullets beat paragraphs.
- Do NOT invent function names or imports that are not in the diff.`;

export class ReviewAgent extends AIChatAgent<Env, ReviewbotState> {
  maxPersistedMessages = 100;
  initialState: ReviewbotState = initialReviewbotState;

  onStart() {
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  // ── State helpers ────────────────────────────────────────────────────

  upsertReview(review: Review) {
    const existing = this.state.reviews.findIndex((r) => r.id === review.id);
    const reviews =
      existing === -1
        ? [...this.state.reviews, review]
        : this.state.reviews.map((r, i) => (i === existing ? review : r));
    this.setState({ ...this.state, reviews, currentReviewId: review.id });
  }

  /**
   * Called by the workflow over DO RPC to merge partial updates into a review.
   * Marked public so the workflow can reach it; not exposed as @callable
   * because clients shouldn't be able to forge findings.
   */
  async patchReview(id: string, patch: Partial<Review>) {
    const reviews = this.state.reviews.map((r) =>
      r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r
    );
    // If the id wasn't in state yet, create a stub.
    if (!reviews.some((r) => r.id === id) && patch.owner && patch.repo) {
      reviews.push({
        id,
        owner: patch.owner,
        repo: patch.repo,
        number: patch.number ?? 0,
        title: patch.title ?? id,
        url: patch.url ?? "",
        status: patch.status ?? "reviewing",
        verdict: patch.verdict ?? "pending",
        findings: patch.findings ?? [],
        summary: patch.summary,
        riskTier: patch.riskTier,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    this.setState({ ...this.state, reviews, currentReviewId: id });
  }

  // ── Callable methods ─────────────────────────────────────────────────

  @callable()
  async addServer(name: string, url: string) {
    return await this.addMcpServer(name, url);
  }

  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  @callable()
  async clearReviews() {
    this.setState({ ...this.state, reviews: [], currentReviewId: null });
  }

  // ── Scheduled callbacks ──────────────────────────────────────────────

  /**
   * Fired by the DO alarm when `scheduleRecheck` resolves. Re-runs the
   * workflow on the same PR. We notify connected clients via `broadcast`
   * (NOT by injecting a chat message, which would cause the model to react
   * to its own follow-up as if the user sent it).
   */
  async recheckReview(reviewId: string) {
    const review = this.state.reviews.find((r) => r.id === reviewId);
    if (!review) return;

    this.broadcast(
      JSON.stringify({
        type: "scheduled-task",
        description: `Re-reviewing ${reviewId}...`
      })
    );

    const instance = await this.env.REVIEW_WORKFLOW.create({
      params: {
        agentName: this.name ?? "default",
        owner: review.owner,
        repo: review.repo,
        number: review.number,
        reviewId
      }
    });

    this.broadcast(
      JSON.stringify({
        type: "scheduled-task",
        description: `Recheck workflow started (${instance.id.slice(0, 8)}).`
      })
    );
  }

  // ── Chat loop ────────────────────────────────────────────────────────

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai(REVIEWBOT_MODEL, {
        sessionAffinity: this.sessionAffinity
      }),
      system: SYSTEM_PROMPT,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        fetchPullRequest: fetchPullRequestTool(this.env),
        reviewDiff: reviewDiffTool(this, this.env),
        runReviewWorkflow: runReviewWorkflowTool(this, this.env),
        postReview: postReviewTool(this),
        scheduleRecheck: scheduleRecheckTool(this),
        listSchedules: listSchedulesTool(this)
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

// Re-export the workflow class so the binding can find it.
// Do NOT remove this line — wrangler will not error, but the workflow won't run.
export { ReviewWorkflow } from "./workflows/review";

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
