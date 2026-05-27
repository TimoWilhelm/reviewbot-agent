// REVIEWBOT — checkpoint 0: bare reviewer persona, no tools yet.
//
// This is your starting point. We have:
//   - A ReviewAgent that streams chat replies from Workers AI
//   - A reviewer persona system prompt
//   - No tools, no state, no workflow, no MCP. Yet.
//
// Across the next checkpoints we will add all of those.

import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText } from "ai";

const SYSTEM_PROMPT = `You are REVIEWBOT, a sharp but fair AI code reviewer.

You have not been given any tools yet. When the user asks you to review a pull
request, explain that you cannot fetch PRs yet, and ask them to paste a diff
directly. When they paste a diff, give a short review:

- Be concrete. Reference file names and line numbers.
- Be honest. Say "looks good" when it looks good.
- Be brief. Bullet points beat paragraphs.
- Do NOT invent function names or imports that are not in the diff.
- Do NOT suggest "consider adding error handling" on code that already has it.

You will get more abilities in later checkpoints.`;

export class ReviewAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

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

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/google/gemma-4-26b-a4b-it", {
        sessionAffinity: this.sessionAffinity
      }),
      system: SYSTEM_PROMPT,
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
