// The actual call to Workers AI. Returns Zod-validated findings.

import { z } from "zod";
import { FindingSchema, type Finding } from "../state.ts";

const ReviewResponseSchema = z.object({
  findings: z.array(FindingSchema).default([]),
  summary: z.string().default("")
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

// Free Workers AI model (covered by the free Neuron allocation). Good enough to
// catch the planted bugs; swap it for any other instruct model you like.
export const REVIEWBOT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

interface RunOptions {
  /** Optional AI Gateway id. If set, requests are routed through AI Gateway
   *  for logging, caching, and rate limiting. */
  gatewayId?: string;
  /** Soft cap on output tokens. Reviews rarely need more. */
  maxTokens?: number;
}

/**
 * Workers AI models disagree on response shape. Some return
 * `{ response: "..." }`; OpenAI-compatible ones return
 * `{ choices: [{ message: { content: "..." } }] }`. Gemma now uses the
 * `choices` shape, so reading only `response` silently yielded empty reviews.
 * Pull the assistant text out of whichever shape we got.
 */
export function extractContent(out: unknown): string {
  if (!out || typeof out !== "object") return "";
  const o = out as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const choiceContent = o.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string" && choiceContent.length > 0) {
    return choiceContent;
  }
  if (typeof o.response === "string") return o.response;
  return "";
}

/**
 * Best-effort JSON extraction. Strips reasoning/think blocks and markdown
 * fences, then falls back to the first balanced-looking object so a stray
 * preamble does not blank out a whole specialist.
 */
export function parseReviewJson(raw: string): unknown | null {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Call Workers AI with a reviewer prompt and a diff. Coerces the JSON output
 * through Zod; on parse failure returns an empty findings list and the raw
 * text in `summary` so we never crash a workflow on a bad LLM response.
 */
export async function runReview(
  env: Env,
  systemPrompt: string,
  diff: string,
  opts: RunOptions = {}
): Promise<ReviewResponse> {
  const gateway = opts.gatewayId
    ? { id: opts.gatewayId, skipCache: true }
    : undefined;

  const out = await env.AI.run(
    REVIEWBOT_MODEL,
    {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Review this diff and respond with JSON only.\n\n${diff}`
        }
      ],
      max_tokens: opts.maxTokens ?? 4096,
      response_format: { type: "json_object" }
    },
    gateway ? { gateway } : {}
  );

  const raw = extractContent(out);
  const parsed = parseReviewJson(raw);
  if (parsed !== null) {
    const validated = ReviewResponseSchema.safeParse(parsed);
    if (validated.success) return validated.data;
  }
  return {
    findings: [],
    summary: `[REVIEWBOT could not parse model output as JSON. Raw response: ${raw.slice(0, 200)}]`
  };
}

/** Build a compact "diff text" from a list of files for prompting. */
export function diffToPromptText(
  files: { path: string; patch: string }[],
  maxChars = 20_000
): string {
  const parts: string[] = [];
  let used = 0;
  for (const f of files) {
    const block = `### ${f.path}\n${f.patch}\n`;
    if (used + block.length > maxChars) {
      parts.push(
        `### (truncated; ${files.length - parts.length} more files omitted)\n`
      );
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n");
}

export { type Finding };
