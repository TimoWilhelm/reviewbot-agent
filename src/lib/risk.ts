// Risk tiering — port of the heuristic from
// https://blog.cloudflare.com/ai-code-review/ (simplified).
//
// "Don't send the dream team to review a typo fix."

import type { DiffFile } from "./noise";

export type RiskTier = "trivial" | "lite" | "full";

const SECURITY_SENSITIVE = [
  /\bauth\b/i,
  /\bcrypto\b/i,
  /\bsecret/i,
  /\btoken/i,
  /\bsession/i,
  /\bpassword/i,
  /\bpermission/i
];

const SECURITY_SENSITIVE_ADDITIONS = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
  /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"']{12,}["']/i
];

function isSecuritySensitive(path: string): boolean {
  return SECURITY_SENSITIVE.some((re) => re.test(path));
}

function hasSecuritySensitiveAddition(patch: string): boolean {
  const addedLines = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
  return SECURITY_SENSITIVE_ADDITIONS.some((re) => re.test(addedLines));
}

export interface RiskAssessment {
  tier: RiskTier;
  totalLines: number;
  fileCount: number;
  /** True when the path or added diff content contains security signals. */
  hasSecurityFiles: boolean;
  /** Specialists that should run for this tier. */
  specialists: ("security" | "quality" | "docs")[];
}

export function assessRisk(files: DiffFile[]): RiskAssessment {
  const totalLines = files.reduce(
    (s, f) => s + f.addedLines + f.removedLines,
    0
  );
  const fileCount = files.length;
  const hasSecurityFiles = files.some(
    (f) => isSecuritySensitive(f.path) || hasSecuritySensitiveAddition(f.patch)
  );

  let tier: RiskTier;
  if (fileCount > 50 || hasSecurityFiles) tier = "full";
  else if (totalLines <= 10 && fileCount <= 20) tier = "trivial";
  else if (totalLines <= 100 && fileCount <= 20) tier = "lite";
  else tier = "full";

  const specialists: RiskAssessment["specialists"] =
    tier === "trivial"
      ? ["quality"]
      : tier === "lite"
        ? ["quality", "docs"]
        : ["security", "quality", "docs"];

  return { tier, totalLines, fileCount, hasSecurityFiles, specialists };
}
