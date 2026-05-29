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

function isSecuritySensitive(path: string): boolean {
  return SECURITY_SENSITIVE.some((re) => re.test(path));
}

export interface RiskAssessment {
  tier: RiskTier;
  totalLines: number;
  fileCount: number;
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
  const hasSecurityFiles = files.some((f) => isSecuritySensitive(f.path));

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
