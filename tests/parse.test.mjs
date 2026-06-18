import assert from "node:assert/strict";
import test from "node:test";
import { extractContent, parseReviewJson } from "../src/lib/aiReview.ts";

test("extractContent handles OpenAI-style (Kimi) shape", () => {
  const out = {
    choices: [{ message: { content: '{"findings":[],"summary":"ok"}' } }]
  };
  assert.equal(extractContent(out), '{"findings":[],"summary":"ok"}');
});

test("extractContent handles classic Workers AI shape", () => {
  const out = { response: '{"findings":[],"summary":"ok"}' };
  assert.equal(extractContent(out), '{"findings":[],"summary":"ok"}');
});

test("extractContent prefers choices, ignores empty content", () => {
  assert.equal(
    extractContent({
      choices: [{ message: { content: "" } }],
      response: "fallback"
    }),
    "fallback"
  );
  assert.equal(extractContent(null), "");
  assert.equal(extractContent({}), "");
});

test("parseReviewJson parses clean JSON", () => {
  const parsed = parseReviewJson(
    '{"findings":[{"severity":"critical"}],"summary":"x"}'
  );
  assert.equal(parsed.findings[0].severity, "critical");
});

test("parseReviewJson strips markdown fences", () => {
  const parsed = parseReviewJson('```json\n{"findings":[],"summary":"x"}\n```');
  assert.deepEqual(parsed, { findings: [], summary: "x" });
});

test("parseReviewJson strips <think> blocks and finds the object", () => {
  const raw =
    '<think>let me reason about this</think> here you go: {"findings":[],"summary":"y"}';
  assert.deepEqual(parseReviewJson(raw), { findings: [], summary: "y" });
});

test("parseReviewJson returns null on junk", () => {
  assert.equal(parseReviewJson("not json at all"), null);
});
