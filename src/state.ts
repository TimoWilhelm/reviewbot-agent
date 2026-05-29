// Shared types + Zod schemas for the REVIEWBOT agent state.
//
// State is automatically persisted in the Durable Object's SQLite-backed
// table `cf_agents_state`, and broadcast to all connected WebSocket clients.

import { z } from "zod";

export const SeveritySchema = z.enum(["critical", "warning", "suggestion"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.object({
  severity: SeveritySchema,
  file: z.string(),
  line: z.number().nullable().optional(),
  category: z.enum(["security", "quality", "docs", "performance"]),
  message: z.string()
});
export type Finding = z.infer<typeof FindingSchema>;

export const VerdictSchema = z.enum([
  "approved",
  "approved_with_comments",
  "requested_changes",
  "pending"
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  status: z.enum(["pending", "reviewing", "ready", "posted", "failed"]),
  riskTier: z.enum(["trivial", "lite", "full"]).optional(),
  verdict: VerdictSchema.default("pending"),
  findings: z.array(FindingSchema).default([]),
  summary: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type Review = z.infer<typeof ReviewSchema>;

export interface ReviewbotState {
  reviews: Review[];
  currentReviewId: string | null;
}

export const initialReviewbotState: ReviewbotState = {
  reviews: [],
  currentReviewId: null
};
