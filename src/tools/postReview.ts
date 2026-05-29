// Tool: postReview — flips a review's status to "posted" after human approval.
//
// `needsApproval` makes the chat UI render Approve / Reject buttons before the
// tool executes. The "post" is mocked: in a real system this would call
// `gh pr review --body "..."` or the GitLab REST notes API.
//
// In the workshop this is a 100% mechanical demo of the approval pattern.

import { tool } from "ai";
import { z } from "zod";
import type { ReviewAgent } from "../server";

export function postReviewTool(agent: ReviewAgent) {
  return tool({
    description:
      "Post the most recent completed review to the upstream PR. This requires explicit human approval because it leaves a visible comment.",
    inputSchema: z.object({
      reviewId: z
        .string()
        .describe(
          "ID of the review to post, in the form 'owner/repo#number'. Use the currently-active review if unsure."
        )
    }),
    // The chat UI renders an Approve/Reject button when this returns true.
    needsApproval: async () => true,
    execute: async ({ reviewId }) => {
      const review = agent.state.reviews.find((r) => r.id === reviewId);
      if (!review) {
        return { ok: false, error: `No review found with id ${reviewId}` };
      }
      if (review.status !== "ready") {
        return {
          ok: false,
          error: `Review ${reviewId} is in state '${review.status}', not 'ready'.`
        };
      }
      // In a real system: POST to GitHub `/repos/.../pulls/.../reviews` here.
      // For the workshop we just flip state — the UI shows "posted".
      agent.patchReview(reviewId, { status: "posted" });
      return {
        ok: true,
        reviewId,
        verdict: review.verdict,
        message: `Review for ${reviewId} marked as posted. (In production this would call the GitHub Reviews API.)`
      };
    }
  });
}
