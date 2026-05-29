// ReviewWorkflow — the durable, multi-step reviewer.
//
// What it does, in order:
//   1. Fetch the PR (with retries) and classify the risk tier
//   2. Run the appropriate specialists IN PARALLEL via Promise.all
//   3. Coordinator pass to dedupe and decide the verdict
//   4. Write the final result back to the agent's state and notify the chat UI
//
// Each `step.do()` is checkpointed. If the workflow crashes after step 2, it
// resumes from step 3 — it does not re-run the model calls.

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig
} from "cloudflare:workers";
import { fetchPullRequest } from "../lib/github";
import { assessRisk, type RiskTier } from "../lib/risk";
import { diffToPromptText, runReview } from "../lib/aiReview";
import {
  COORDINATOR_PROMPT,
  DOCS_PROMPT,
  QUALITY_PROMPT,
  SECURITY_PROMPT
} from "../prompts/specialists";
import {
  FindingSchema,
  VerdictSchema,
  type Finding,
  type Verdict
} from "../state";
import { z } from "zod";

export interface ReviewParams {
  agentName: string; // which ReviewAgent instance owns this review
  owner: string;
  repo: string;
  number: number;
  reviewId: string;
}

const SPECIALIST_PROMPTS: Record<"security" | "quality" | "docs", string> = {
  security: SECURITY_PROMPT,
  quality: QUALITY_PROMPT,
  docs: DOCS_PROMPT
};

const CoordinatorOutputSchema = z.object({
  findings: z.array(FindingSchema).default([]),
  verdict: VerdictSchema.default("pending"),
  summary: z.string().default("")
});

const STEP_RETRY: WorkflowStepConfig = {
  retries: {
    limit: 3,
    delay: "5 seconds",
    backoff: "exponential"
  },
  timeout: "2 minutes"
};

export class ReviewWorkflow extends WorkflowEntrypoint<Env, ReviewParams> {
  async run(event: WorkflowEvent<ReviewParams>, step: WorkflowStep) {
    const { agentName, owner, repo, number, reviewId } = event.payload;
    try {
      // Step 1: fetch PR and assess risk
      const fetched = await step.do("fetch-pr", STEP_RETRY, async () => {
        const pr = await fetchPullRequest(this.env, owner, repo, number);
        const risk = assessRisk(pr.files);
        return {
          title: pr.title,
          url: pr.url,
          risk,
          diffText: diffToPromptText(pr.files)
        };
      });

      await this.updateAgentState(agentName, reviewId, {
        status: "reviewing",
        riskTier: fetched.risk.tier,
        title: fetched.title,
        url: fetched.url
      });

      // Step 2: run specialists in parallel (each one is its own checkpointed step)
      const specialistResults = await Promise.all(
        fetched.risk.specialists.map((name) =>
          step.do(`specialist-${name}`, STEP_RETRY, async () => {
            const out = await runReview(
              this.env,
              SPECIALIST_PROMPTS[name],
              fetched.diffText,
              { gatewayId: this.env.AI_GATEWAY_ID }
            );
            return { name, findings: out.findings, summary: out.summary };
          })
        )
      );

      const allFindings = specialistResults.flatMap((r) => r.findings);

      // Step 3: coordinator pass — dedupe + verdict
      const coordinated = await step.do("coordinate", STEP_RETRY, async () => {
        if (allFindings.length === 0) {
          return {
            findings: [] as Finding[],
            verdict: "approved" as Verdict,
            summary: "All specialists are happy. Looks good."
          };
        }
        const out = await runReview(
          this.env,
          COORDINATOR_PROMPT,
          `<specialist-findings>
${JSON.stringify(allFindings, null, 2)}
</specialist-findings>`,
          { gatewayId: this.env.AI_GATEWAY_ID, maxTokens: 3000 }
        );
        // The coordinator's response has an additional "verdict" field which our
        // generic runReview doesn't validate; re-parse with the wider schema.
        // If parse fails we fall back to a sensible default.
        const parsed = CoordinatorOutputSchema.safeParse({
          ...out,
          verdict:
            (out as unknown as { verdict?: string }).verdict ??
            fallbackVerdict(allFindings)
        });
        if (!parsed.success) {
          return {
            findings: allFindings,
            verdict: fallbackVerdict(allFindings),
            summary: out.summary || "Coordinator output could not be parsed."
          };
        }
        return parsed.data;
      });

      // Step 4: write final result back
      await this.updateAgentState(agentName, reviewId, {
        status: "ready",
        findings: coordinated.findings,
        verdict: coordinated.verdict,
        summary: coordinated.summary
      });

      const counts = countFindings(coordinated.findings);
      await this.notifyAgent(agentName, {
        kind: "review-complete",
        reviewId,
        verdict: coordinated.verdict,
        findingCount: coordinated.findings.length,
        ...counts,
        message: buildCompletionMessage(reviewId, coordinated.verdict, counts)
      });

      return {
        reviewId,
        tier: fetched.risk.tier,
        verdict: coordinated.verdict,
        findingCount: coordinated.findings.length
      };
    } catch (error) {
      await this.updateAgentState(agentName, reviewId, {
        status: "failed",
        summary:
          error instanceof Error
            ? error.message
            : "Workflow failed unexpectedly."
      });
      await this.notifyAgent(agentName, {
        kind: "review-failed",
        reviewId,
        message:
          error instanceof Error
            ? error.message
            : "Workflow failed unexpectedly."
      });
      throw error;
    }
  }

  /**
   * Reach into the ReviewAgent DO and update one review by id. We use the
   * agent's `upsertReview` via its callable surface so the broadcast happens
   * cleanly.
   */
  private async updateAgentState(
    agentName: string,
    reviewId: string,
    patch: Partial<{
      status: "pending" | "reviewing" | "ready" | "posted" | "failed";
      riskTier: RiskTier;
      title: string;
      url: string;
      findings: Finding[];
      verdict: Verdict;
      summary: string;
    }>
  ) {
    const id = this.env.ReviewAgent.idFromName(agentName);
    const stub = this.env.ReviewAgent.get(id);
    await stub.patchReview(reviewId, patch);
  }

  private async notifyAgent(
    agentName: string,
    payload: {
      kind: "review-complete" | "review-failed";
      reviewId: string;
      verdict?: Verdict;
      findingCount?: number;
      criticalCount?: number;
      warningCount?: number;
      suggestionCount?: number;
      message: string;
    }
  ) {
    const id = this.env.ReviewAgent.idFromName(agentName);
    const stub = this.env.ReviewAgent.get(id);
    await stub.notifyWorkflowUpdate(payload);
  }
}

function fallbackVerdict(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === "critical"))
    return "requested_changes";
  if (findings.some((f) => f.severity === "warning"))
    return "approved_with_comments";
  return "approved";
}

function countFindings(findings: Finding[]) {
  return findings.reduce(
    (acc, finding) => {
      acc[`${finding.severity}Count` as const] += 1;
      return acc;
    },
    {
      criticalCount: 0,
      warningCount: 0,
      suggestionCount: 0
    }
  );
}

function buildCompletionMessage(
  reviewId: string,
  verdict: Verdict,
  counts: ReturnType<typeof countFindings>
) {
  return (
    `${reviewId} finished with ${verdict.replaceAll("_", " ")}. ` +
    `${counts.criticalCount} critical, ${counts.warningCount} warning, ` +
    `${counts.suggestionCount} suggestion findings. ` +
    `See the findings panel above for details.`
  );
}
