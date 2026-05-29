// Tool: scheduleRecheck — schedule a follow-up review.
//
// Uses `this.schedule()` on the agent. The DO alarm survives hibernation and
// restarts; the handler `recheckReview` will fire and trigger the workflow
// again. No compute is consumed while waiting.

import { tool } from "ai";
import { z } from "zod";
import type { ReviewAgent } from "../server";

export function scheduleRecheckTool(agent: ReviewAgent) {
  return tool({
    description:
      "Schedule a follow-up review of an already-reviewed PR. Use this when the user wants REVIEWBOT to take another look after some time, e.g. 'check this PR again in 5 minutes'.",
    inputSchema: z.object({
      reviewId: z
        .string()
        .describe(
          "ID of the review to recheck, in the form 'owner/repo#number'"
        ),
      delaySeconds: z
        .number()
        .int()
        .min(5)
        .max(7 * 24 * 60 * 60)
        .describe("Delay before recheck, in seconds. Max 1 week.")
    }),
    execute: async ({ reviewId, delaySeconds }) => {
      const review = agent.state.reviews.find((r) => r.id === reviewId);
      if (!review) {
        return { ok: false, error: `No review with id ${reviewId}` };
      }
      const scheduled = await agent.schedule(
        delaySeconds,
        "recheckReview",
        reviewId
      );
      return {
        ok: true,
        scheduleId: scheduled.id,
        firesAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        reviewId
      };
    }
  });
}

export function listSchedulesTool(agent: ReviewAgent) {
  return tool({
    description:
      "List all currently-scheduled rechecks (and any other scheduled tasks).",
    inputSchema: z.object({}),
    execute: async () => {
      const schedules = agent.getSchedules();
      return {
        count: schedules.length,
        schedules: schedules.map((s) => ({
          id: s.id,
          callback: s.callback,
          payload: s.payload,
          time:
            typeof s.time === "number"
              ? new Date(s.time * 1000).toISOString()
              : null
        }))
      };
    }
  });
}
