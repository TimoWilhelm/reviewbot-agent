// The actual call to Workers AI. Returns Zod-validated findings.

import { z } from "zod";
import { FindingSchema, type Finding } from "../state";

const ReviewResponseSchema = z.object({
  findings: z.array(FindingSchema).default([]),
  summary: z.string().default("")
});
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

export const REVIEWBOT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

interface RunOptions {
  /** Optional AI Gateway id. If set, requests are routed through AI Gateway
   *  for logging, caching, and rate limiting. */
  gatewayId?: string;
  /** Soft cap. Gemma 4 26b A4B allows much more, but reviews rarely need it. */
  maxTokens?: number;
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
    ? { id: opts.gatewayId, skipCache: false, cacheTtl: 3600 }
    : undefined;

  const out = (await env.AI.run(
    REVIEWBOT_MODEL,
    {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Review this diff and respond with JSON only.\n\n${diff}`
        }
      ],
      max_tokens: opts.maxTokens ?? 2048,
      response_format: { type: "json_object" }
    },
    gateway ? { gateway } : {}
  )) as { response?: string };

  const raw = out?.response ?? "";
  try {
    const parsed = JSON.parse(raw);
    const validated = ReviewResponseSchema.parse(parsed);
    return validated;
  } catch (_err) {
    return {
      findings: [],
      summary: `[REVIEWBOT could not parse model output as JSON. Raw response: ${raw.slice(0, 200)}]`
    };
  }
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
