import assert from "node:assert/strict";
import test from "node:test";
import { assessRisk } from "../src/lib/risk.ts";

test("suspicious workshop PR triggers full review", () => {
  const assessment = assessRisk([
    {
      path: "src/server.ts",
      addedLines: 3,
      removedLines: 0,
      patch: `diff --git a/src/server.ts b/src/server.ts
+++ b/src/server.ts
+const GITHUB_TOKEN = "ghp_1A2B3C4D5E6F7G8H9I0JabcdefghijklmnopqR";`
    },
    {
      path: "src/tools/fetchPR.ts",
      addedLines: 6,
      removedLines: 0,
      patch: `diff --git a/src/tools/fetchPR.ts b/src/tools/fetchPR.ts
+++ b/src/tools/fetchPR.ts
+const cfg = pr.body.split("REVIEWBOT_CONFIG:")[1].split("\\n")[0];
+eval(cfg);`
    }
  ]);

  assert.equal(assessment.tier, "full");
  assert.deepEqual(assessment.specialists, ["security", "quality", "docs"]);
  assert.equal(assessment.hasSecurityFiles, true);
});

test("small non-security changes still avoid full review", () => {
  const assessment = assessRisk([
    {
      path: "README.md",
      addedLines: 1,
      removedLines: 0,
      patch: `diff --git a/README.md b/README.md
+++ b/README.md
+Clarify setup instructions.`
    }
  ]);

  assert.equal(assessment.tier, "trivial");
  assert.deepEqual(assessment.specialists, ["quality"]);
});
