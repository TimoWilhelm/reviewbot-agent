// GitHub REST helpers — public PRs, no auth required (60 req/hr/IP).
//
// If GITHUB_TOKEN is set as a Worker secret, we use it and get 5000 req/hr.

import { filterNoise, parseUnifiedDiff, type DiffFile } from "./noise";

export interface PullRequestData {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  url: string;
  files: DiffFile[];
}

function headers(env: Env) {
  const h: Record<string, string> = {
    "User-Agent": "reviewbot-workshop",
    Accept: "application/vnd.github.v3+json"
  };
  if (env.GITHUB_TOKEN) h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

export async function fetchPullRequest(
  env: Env,
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestData> {
  // 1. Metadata
  const metaRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
    { headers: headers(env) }
  );
  if (!metaRes.ok) {
    throw new Error(
      `GitHub API ${metaRes.status}: could not fetch ${owner}/${repo}#${number}. ${
        metaRes.status === 403
          ? "Likely rate-limited. Set GITHUB_TOKEN to raise the limit."
          : ""
      }`
    );
  }
  const meta = (await metaRes.json()) as {
    title: string;
    body: string | null;
    html_url: string;
  };

  // 2. Diff (different Accept header)
  const diffRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
    {
      headers: { ...headers(env), Accept: "application/vnd.github.v3.diff" }
    }
  );
  if (!diffRes.ok) {
    throw new Error(`GitHub diff fetch failed: ${diffRes.status}`);
  }
  const diff = await diffRes.text();

  const allFiles = parseUnifiedDiff(diff);
  const files = filterNoise(allFiles);

  return {
    owner,
    repo,
    number,
    title: meta.title,
    body: meta.body ?? "",
    url: meta.html_url,
    files
  };
}
