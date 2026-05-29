// Shared reviewer rules + output schema. Imported by every specialist prompt.

export const OUTPUT_RULES = `## Output rules

Respond with JSON only. No prose, no markdown fences, no explanation.

Shape:
{
  "findings": [
    {
      "severity": "critical" | "warning" | "suggestion",
      "category": "security" | "quality" | "docs" | "performance",
      "file": "path/to/file.ts",
      "line": <number or null>,
      "message": "<one sentence>"
    }
  ],
  "summary": "<one paragraph, plain text>"
}

Severity rubric:
- "critical": will cause an outage, data loss, or is exploitable.
- "warning":  measurable regression or concrete risk.
- "suggestion": improvement worth considering, not blocking.

If the diff looks fine, return { "findings": [], "summary": "Looks good." }.`;

export const GLOBAL_GUARDRAILS = `## Hard rules

- Do NOT invent function names, imports, or files that are not in the diff.
- Do NOT flag "consider adding error handling" if the code already handles errors.
- Do NOT flag style nitpicks unless the project clearly cares about them.
- Do NOT speculate about theoretical risks that need unlikely preconditions.
- If you are not sure, do not flag it.`;
