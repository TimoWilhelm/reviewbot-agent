// ReviewMCP — expose REVIEWBOT's review capability as an MCP server.
//
// Any MCP client (MCP Inspector, Claude Desktop, OpenCode, Cursor, another
// agent...) can connect to `/mcp` and call the `review-pr` tool.
//
// Same logic as the single-shot reviewer from checkpoint 2, just wrapped in
// an McpAgent. Each MCP session is its own DO instance with its own state.

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchPullRequest } from "./lib/github";
import { diffToPromptText, runReview } from "./lib/aiReview";
import { GENERALIST_PROMPT } from "./prompts/generalist";

interface MCPState {
  callCount: number;
}

export class ReviewMCP extends McpAgent<Env, MCPState> {
  initialState: MCPState = { callCount: 0 };

  server = new McpServer({
    name: "reviewbot",
    version: "0.1.0"
  });

  async init() {
    // Tool: review-pr — review a public GitHub PR.
    this.server.tool(
      "review-pr",
      "Run REVIEWBOT on a public GitHub pull request. Returns structured findings (severity, category, file, message).",
      {
        owner: z.string(),
        repo: z.string(),
        number: z.number().int().positive()
      },
      async ({ owner, repo, number }) => {
        const pr = await fetchPullRequest(this.env, owner, repo, number);
        const diff = diffToPromptText(pr.files);
        const result = await runReview(this.env, GENERALIST_PROMPT, diff, {
          gatewayId: this.env.AI_GATEWAY_ID
        });
        this.setState({ callCount: this.state.callCount + 1 });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  pr: { owner, repo, number, title: pr.title, url: pr.url },
                  findings: result.findings,
                  summary: result.summary
                },
                null,
                2
              )
            }
          ]
        };
      }
    );

    // Tool: review-diff — review a raw unified diff (no GitHub fetch).
    this.server.tool(
      "review-diff",
      "Run REVIEWBOT on a raw unified diff. Use this when you have a diff in hand and don't want REVIEWBOT to call GitHub.",
      {
        diff: z.string().describe("A unified diff (the output of `git diff`)")
      },
      async ({ diff }) => {
        const result = await runReview(this.env, GENERALIST_PROMPT, diff, {
          gatewayId: this.env.AI_GATEWAY_ID
        });
        this.setState({ callCount: this.state.callCount + 1 });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { findings: result.findings, summary: result.summary },
                null,
                2
              )
            }
          ]
        };
      }
    );
  }
}
