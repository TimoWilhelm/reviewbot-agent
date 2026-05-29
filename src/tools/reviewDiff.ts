// Tool: reviewDiff — single-shot review of a PR (checkpoint 2).
//
// Pulls the PR, runs one generalist reviewer over the whole diff, writes the
// findings into agent state so the UI can render them, returns a summary.
//
// In checkpoint 3 we replace this with the multi-specialist workflow.

import { tool } from "ai";
import { z } from "zod";
import type { ReviewAgent } from "../server";
import { fetchPullRequest } from "../lib/github";
import { diffToPromptText, runReview } from "../lib/aiReview";
import { GENERALIST_PROMPT } from "../prompts/generalist";
import type { Review } from "../state";

export function reviewDiffTool(agent: ReviewAgent, env: Env) {
  return tool({
    description:
      "Review a public GitHub pull request end-to-end. Fetches the PR, runs an AI code review, stores the findings in REVIEWBOT's state, and returns a short summary.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      number: z.number().int().positive()
    }),
    execute: async ({ owner, repo, number }) => {
      const id = `${owner}/${repo}#${number}`;
      const now = Date.now();

      // 1. Fetch the PR
      let pr;
      try {
        pr = await fetchPullRequest(env, owner, repo, number);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }

      // 2. Mark the review as in-progress in state
      const stub: Review = {
        id,
        owner,
        repo,
        number,
        title: pr.title,
        url: pr.url,
        status: "reviewing",
        verdict: "pending",
        findings: [],
        createdAt: now,
        updatedAt: now
      };
      agent.upsertReview(stub);

      // 3. Run the model
      const diffText = diffToPromptText(pr.files);
      const result = await runReview(env, GENERALIST_PROMPT, diffText, {
        gatewayId: env.AI_GATEWAY_ID
      });

      // 4. Decide a verdict from severity counts
      const counts = { critical: 0, warning: 0, suggestion: 0 };
      for (const f of result.findings) counts[f.severity]++;
      const verdict =
        counts.critical > 0
          ? "requested_changes"
          : counts.warning > 0
            ? "approved_with_comments"
            : "approved";

      // 5. Write final review back to state
      agent.upsertReview({
        ...stub,
        status: "ready",
        verdict,
        findings: result.findings,
        summary: result.summary,
        updatedAt: Date.now()
      });

      return {
        ok: true,
        reviewId: id,
        verdict,
        findingCount: result.findings.length,
        counts,
        summary: result.summary
      };
    }
  });
}
