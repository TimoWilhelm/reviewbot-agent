// Tool: runReviewWorkflow — kicks off the durable, multi-specialist workflow.
//
// In checkpoint 3 this replaces `reviewDiff` as the user-facing review action.
// We still keep `reviewDiff` around so attendees can see the single-shot vs
// multi-specialist contrast.

import { tool } from "ai";
import { z } from "zod";
import type { ReviewAgent } from "../server";
import { fetchPullRequest } from "../lib/github";
import { assessRisk } from "../lib/risk";
import type { Review } from "../state";

export function runReviewWorkflowTool(agent: ReviewAgent, env: Env) {
  return tool({
    description:
      "Run REVIEWBOT's full multi-specialist review on a public PR. Spawns parallel security, code-quality, and docs reviewers (subject to the risk tier), then a coordinator that dedupes and decides the verdict. Returns a workflow instance id; the findings appear in the UI as they land.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      number: z.number().int().positive()
    }),
    execute: async ({ owner, repo, number }) => {
      const id = `${owner}/${repo}#${number}`;
      const now = Date.now();

      // Quick pre-flight: fetch the PR once so we can show metadata + risk tier
      // in the UI immediately. The workflow will fetch again in its first step
      // (that fetch is the checkpointed one, this one is just for instant UX).
      let title = `${owner}/${repo}#${number}`;
      let url = `https://github.com/${owner}/${repo}/pull/${number}`;
      let tier: Review["riskTier"];
      try {
        const pr = await fetchPullRequest(env, owner, repo, number);
        title = pr.title;
        url = pr.url;
        tier = assessRisk(pr.files).tier;
      } catch {
        // Non-fatal — the workflow will surface the real error if any
      }

      agent.upsertReview({
        id,
        owner,
        repo,
        number,
        title,
        url,
        status: "reviewing",
        riskTier: tier,
        verdict: "pending",
        findings: [],
        createdAt: now,
        updatedAt: now
      });

      const instance = await env.REVIEW_WORKFLOW.create({
        params: {
          agentName: agent.name ?? "default",
          owner,
          repo,
          number,
          reviewId: id
        }
      });

      return {
        ok: true,
        reviewId: id,
        workflowInstanceId: instance.id,
        riskTier: tier ?? "unknown"
      };
    }
  });
}
