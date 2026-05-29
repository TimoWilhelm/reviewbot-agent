// Tool: fetchPullRequest — pulls a public PR from GitHub.
//
// Returns title/body/url/files. Filters lockfiles and minified bundles before
// returning so the model doesn't waste its attention on noise.

import { tool } from "ai";
import { z } from "zod";
import { fetchPullRequest } from "../lib/github";

export function fetchPullRequestTool(env: Env) {
  return tool({
    description:
      "Fetch a public GitHub pull request by owner/repo/number. Returns title, body, and a list of changed files with their diffs (lockfiles and minified files filtered out).",
    inputSchema: z.object({
      owner: z.string().describe("GitHub owner / org, e.g. 'cloudflare'"),
      repo: z.string().describe("Repository name, e.g. 'agents-starter'"),
      number: z.number().int().positive().describe("PR number")
    }),
    execute: async ({ owner, repo, number }) => {
      try {
        const pr = await fetchPullRequest(env, owner, repo, number);
        return {
          ok: true,
          title: pr.title,
          body: pr.body.slice(0, 1000),
          url: pr.url,
          fileCount: pr.files.length,
          totalLines: pr.files.reduce(
            (s, f) => s + f.addedLines + f.removedLines,
            0
          ),
          files: pr.files.map((f) => ({
            path: f.path,
            added: f.addedLines,
            removed: f.removedLines
          }))
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  });
}
