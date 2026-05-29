// REVIEWBOT — checkpoint 1: Foundations
//
// What's new since checkpoint 0:
//   - Declared `ReviewbotState` with the agent's tracked reviews
//   - `initialState` for fresh instances; persisted state for existing ones
//   - `@callable` helpers the UI can call directly via typed RPC
//   - System prompt now mentions the (still empty) review tracker

import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { initialReviewbotState, type ReviewbotState } from "./state";

const SYSTEM_PROMPT = `You are REVIEWBOT, a sharp but fair AI code reviewer.

You can see the current set of reviews in your state. You cannot fetch new PRs
yet — that comes in checkpoint 2. If the user asks for a review, explain that
they should paste a diff for now, and give them a quick verbal review of it.

Rules:
- Be concrete. Reference file names and line numbers.
- Be honest. Say "looks good" when it looks good.
- Be brief. Bullets beat paragraphs.
- Do NOT invent function names or imports that are not in the diff.
- Do NOT suggest "consider adding error handling" on code that already has it.`;

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

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const reviewSummary = this.state.reviews.length
      ? `Current reviews: ${this.state.reviews.map((r) => `${r.owner}/${r.repo}#${r.number} (${r.status})`).join(", ")}.`
      : "No reviews yet.";

    const result = streamText({
      model: workersai("@cf/google/gemma-4-26b-a4b-it", {
        sessionAffinity: this.sessionAffinity
      }),
      system: `${SYSTEM_PROMPT}\n\n${reviewSummary}`,
      messages: await convertToModelMessages(this.messages),
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
