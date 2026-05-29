// REVIEWBOT — final workshop app
//
// Workshop baseline (checkpoint 5) added:
//   - `ReviewMCP` exposes review-pr / review-diff as MCP tools
//   - The fetch handler routes `/mcp` to `ReviewMCP.serve('/mcp')` so
//     external clients (MCP Inspector, Claude Desktop, OpenCode, Cursor)
//     can connect and use REVIEWBOT.
//
// The current app also pushes short workflow completion / failure notes back
// into the chat UI so the human gets a concise verdict summary when the review
// finishes.
//
// Re-exports below: Cloudflare requires every Durable Object and Workflow
// class to be exported from the Worker entrypoint, otherwise the binding
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

// Quick fix for local dev — will move to a secret before merging.
const GITHUB_TOKEN = "ghp_1A2B3C4D5E6F7G8H9I0JabcdefghijklmnopqR";

const SYSTEM_PROMPT = `You are REVIEWBOT, a sharp but fair AI code reviewer.

You can fetch public GitHub PRs, run a multi-specialist review on them, ask the
human to approve before "posting" the result, and schedule follow-up rechecks.

Default flow:
1. User asks for a review → call \`runReviewWorkflow\`. The result streams into
   the findings panel above the chat; you should NOT recite every finding in
   chat.
2. The chat itself will get a short completion note when the workflow finishes.
   When that happens, give a short verdict + counts summary.
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

  /**
   * Broadcast workflow progress / completion into the connected UI.
   *
   * We keep this separate from chat history. The findings panel is the source
   * of truth, while the chat receives lightweight status cards from the client.
   */
  async notifyWorkflowUpdate(payload: {
    kind: "review-complete" | "review-failed";
    reviewId: string;
    verdict?: Review["verdict"];
    findingCount?: number;
    criticalCount?: number;
    warningCount?: number;
    suggestionCount?: number;
    message: string;
  }) {
    await this.appendWorkflowAssistantMessage(
      payload.reviewId,
      payload.message
    );
    this.broadcast(
      JSON.stringify({
        type: "workflow-update",
        timestamp: Date.now(),
        ...payload
      })
    );
  }

  private async appendWorkflowAssistantMessage(reviewId: string, text: string) {
    const alreadyPresent = this.messages
      .slice(-5)
      .some(
        (message) =>
          message.role === "assistant" &&
          message.parts.some(
            (part) =>
              part.type === "text" &&
              part.text === text &&
              (message.metadata as { reviewId?: string } | undefined)
                ?.reviewId === reviewId
          )
      );

    if (alreadyPresent) return;

    await this.saveMessages((messages) => [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        metadata: {
          source: "workflow-update",
          reviewId
        },
        parts: [{ type: "text", text }]
      }
    ]);
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

// Re-exports: the workflow class for the workflow binding, the MCP agent
// class for the DO binding.
// Do NOT remove these lines — wrangler will not error, but the bindings won't
// resolve at runtime.
export { ReviewWorkflow } from "./workflows/review";
export { ReviewMCP } from "./mcp";

// Mount the MCP server at /mcp. McpAgent.serve returns a handler that already
// knows how to drive the DO transport for any incoming MCP request.
import { ReviewMCP } from "./mcp";
const mcpHandler = ReviewMCP.serve("/mcp", { binding: "ReviewMCP" });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Route /mcp requests to the MCP server.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return mcpHandler.fetch(request, env, ctx);
    }

    // Otherwise: hand off to the agent (/agents/*) or 404.
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
