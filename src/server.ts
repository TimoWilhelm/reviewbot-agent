// REVIEWBOT — checkpoint 2: Tools & AI
//
// What's new since checkpoint 1:
//   - Tools: `fetchPullRequest`, `reviewDiff`
//   - Workers AI single-shot reviewer with the "what to flag / what NOT to flag"
//     prompt structure from https://blog.cloudflare.com/ai-code-review/
//   - AI Gateway opt-in via the AI_GATEWAY_ID env var (free tier)
//   - Diff noise filter (lockfiles, minified bundles)
//   - State helper `upsertReview` so tools can write back

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
import { fetchPullRequestTool, reviewDiffTool } from "./tools";

const SYSTEM_PROMPT = `You are REVIEWBOT, a sharp but fair AI code reviewer.

You can fetch public GitHub pull requests and produce structured findings.

When the user asks you to review a PR:
1. Call \`reviewDiff\` with owner/repo/number — it does fetch + review in one step.
2. Summarise the result in 2-3 sentences. Mention the verdict and the count
   of critical / warning / suggestion findings. Do NOT recite every finding;
   the UI will render them.

If the user just wants to see PR metadata without a review, call \`fetchPullRequest\`.

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
  /**
   * Insert or update a review by id, and make it the "current" review.
   * State mutations automatically persist to SQLite and broadcast to all
   * connected WebSocket clients — the UI updates without polling.
   */
  upsertReview(review: Review) {
    const existing = this.state.reviews.findIndex((r) => r.id === review.id);
    const reviews =
      existing === -1
        ? [...this.state.reviews, review]
        : this.state.reviews.map((r, i) => (i === existing ? review : r));
    this.setState({ ...this.state, reviews, currentReviewId: review.id });
  }

  // ── Callable methods (typed RPC from the client) ─────────────────────

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
        reviewDiff: reviewDiffTool(this, this.env)
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
