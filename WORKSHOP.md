# REVIEWBOT Workshop Guide

> Code companion to the [slide deck](../reviewbot-deck/) and the agent-driven
> [school](../agents-school/). The presenter drives the deck; you build here with
> your own coding agent, guided by the school. 90 minutes from blank starter to a
> deployed AI code reviewer.

## How the three pieces fit

- **[`reviewbot-deck`](../reviewbot-deck/)** — the slides the presenter shows (the _why_).
- **[`agents-school`](../agents-school/)** — lessons your coding agent walks you through (the _how_).
- **`reviewbot-agent`** (this repo) — the code you build, with a git checkpoint per module.

The school's exercises point right back at these checkpoints.

## Three themes

1. **Coding agent + Cloudflare Skills** — see Module 0 below.
2. **Better than SaaS** — you own the data, models, prompts, and infra.
3. **Zero Trust security (optional extra)** — see "Lock it down with Zero Trust".

## Modules at a glance

The live 90 minutes covers the five build modules (0-5), with the heavier
hands-on in 1-4 and MCP often walked through. The PR review exercise and the
optional Zero Trust lesson you can finish at your own pace in the school.

| #   | Module          | Tag                               | What you add                                                                |
| --- | --------------- | --------------------------------- | --------------------------------------------------------------------------- |
| 0   | Setup + Skills  | `checkpoint-0-starter`            | Coding agent + Cloudflare Skills, working chat UI + reviewer persona        |
| 1   | Foundations     | `checkpoint-1-foundations`        | `Review` state + persistence + findings panel                               |
| 2   | Tools & AI      | `checkpoint-2-tools-ai`           | `fetchPullRequest`, `reviewDiff`, Workers AI, AI Gateway, diff noise filter |
| 3   | Workflows       | `checkpoint-3-workflows`          | `ReviewWorkflow` with 3 parallel specialists + risk tiers + coordinator     |
| 4   | HITL + Schedule | `checkpoint-4-hitl-schedule`      | `postReview` with `needsApproval`, `scheduleRecheck`                        |
| 5   | MCP             | `checkpoint-5-mcp`                | `ReviewMCP` at `/mcp`                                                       |
| 🎬  | Review a PR     | branch `pr/the-suspicious-change` | The final exercise. See below.                                              |
| +   | Zero Trust      | _(optional extra, no checkpoint)_ | Access, service tokens, Tunnel. See "Lock it down".                         |

## Module 0: set up your coding agent + Cloudflare Skills

Before building, give your agent platform expertise so it writes Workers-correct
code:

```bash
# Claude Code
/plugin marketplace add cloudflare/skills
/plugin install cloudflare@cloudflare

# OpenCode / Codex / any Agent Skills tool
npx skills add https://github.com/cloudflare/skills
```

The bundle covers Workers, Durable Objects, Workflows, AI, Zero Trust, and
wrangler. The [`AGENTS.md`](./AGENTS.md) in this repo pins the project
conventions your agent reads first.

## Lock it down with Zero Trust

REVIEWBOT can read repos and post comments, so do not leave it open once
deployed:

- Put a self-hosted **Cloudflare Access** application in front of the Worker and
  the `/mcp` path; require login via your identity provider.
- For agent-to-agent calls to `/mcp`, create a **service token** and a Service
  Auth policy, then send `CF-Access-Client-Id` / `CF-Access-Client-Secret`.
- For local dev, expose localhost with a **Tunnel** (`cloudflared`) behind the
  same policies.
- Add the `access-oauth` skill to `AGENTS.md` so your agent handles interactive
  Access logins automatically.

Reference: <https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/>

## How to use the checkpoints

```bash
# Jump to a fresh starting point:
git checkout checkpoint-0-starter

# After finishing module N or getting stuck, recover the canonical files:
git checkout checkpoint-N-... -- src/

# See what changed in a module:
git diff checkpoint-2-tools-ai..checkpoint-3-workflows
```

If you're recovering mid-module, prefer overlaying with `-- src/` over a full
checkout — that keeps any notes, scratch files, and README edits you've made.

## The 🎬 PR review exercise

The branch `pr/the-suspicious-change` contains a deliberately bad diff. To run
the review:

1. **Fork or mirror this repo to your own GitHub** (so REVIEWBOT can fetch via
   the public API). The Cloudflare team will host the canonical copy at
   `github.com/TimoWilhelm/reviewbot-agent`.

2. **Open the PR:**

   ```bash
   git push origin pr/the-suspicious-change
   gh pr create --base main --head pr/the-suspicious-change \
     --title "The suspicious change" --body "Various improvements."
   ```

   Use the PR number printed by `gh pr create`. It is `#1` in a fresh demo repo,
   but it may be higher if the repo already has pull requests.

3. **Ask REVIEWBOT to review it** in the chat UI:

   > Review PR #<number> on `<your-org>/<repo>`.

   The empty-state quick action points at the canonical host demo,
   `Review PR #1 on TimoWilhelm/reviewbot-agent`, which is kept open for live
   workshops. Participants using a fork should type their own repo and PR
   number instead.

4. **Watch the workflow fan out.** The risk tier will be `full` because the diff
   adds security-sensitive content: a hardcoded token and `eval()` on
   PR-description input. All three specialists fire. The coordinator merges
   their findings. The review card appears immediately, and the findings panel
   fills in when the workflow finishes.

5. **Approve the post.** REVIEWBOT proposes `postReview` and the chat asks
   you to approve. Click Approve. The review status flips to `posted`.

6. **(Bonus) Schedule a recheck.** "Check this PR again in 30 seconds." Watch
   it re-run via `scheduleRecheck`.

## The planted bugs (cheatsheet for the host)

The diff contains 7 deliberate issues. A well-tuned reviewer should catch all
of them, though severity calls may vary:

| File                        | Bug                                    | Specialist        | Severity |
| --------------------------- | -------------------------------------- | ----------------- | -------- |
| `src/server.ts`             | Hardcoded GitHub token                 | security          | critical |
| `src/prompts/generalist.ts` | Removed "What NOT to flag" guardrail   | quality           | warning  |
| `src/workflows/review.ts`   | `Promise.all` → sequential `for` loop  | quality (or perf) | warning  |
| `src/tools/fetchPR.ts`      | `eval()` of PR-description input       | security          | critical |
| `README.md`                 | Fake HIPAA / FedRAMP / SOC 2 claim     | docs              | warning  |
| `tests/agent.test.ts`       | Tests skipped with cryptic JIRA refs   | quality           | warning  |
| `wrangler.jsonc`            | `compatibility_date` set to 1999-12-31 | quality           | warning  |

There's one intentional overlap — the eval is both a security issue (untrusted
input) and a quality issue (broken error handling) — so the coordinator's
dedup pass has something visible to do.

## Free-tier constraints

- **Workers AI**: free Neurons covers all models we use. The model is
  `@cf/google/gemma-4-26b-a4b-it`, set in `src/lib/aiReview.ts`.
- **Durable Objects**: SQLite-backed DOs are free tier.
- **Workflows**: 100k steps/day on the free tier. The workshop uses about 5
  steps per review.
- **AI Gateway**: 100k logs/day. Enabled by setting `AI_GATEWAY_ID` in
  `wrangler.jsonc` to the gateway you create in the dash.

## Common issues

**"Workflow runs forever / never starts"**
Did you re-export `ReviewWorkflow` from `src/server.ts`? Cloudflare won't
error if you forget — it just silently doesn't run.

**"My agent says 'I don't have that tool'"**
Tools live in `src/tools/` but they have to be added to the `tools: { ... }`
map inside `onChatMessage`. Easy to miss.

**"GitHub API returns 403"**
You've hit the unauthenticated rate limit (60/hr/IP). Either wait an hour,
or `wrangler secret put GITHUB_TOKEN` with a token that has `public_repo`
scope.

**"The findings panel is empty"**
Open DevTools → Network → look for the `/agents/...` WebSocket. State updates
flow through it. If it's disconnected, refresh the page.

**"The review completes with 0 findings"**
Make sure you are running a checkpoint that includes the risk-tier fix from
`main`, or re-run `git checkout main -- src/lib/risk.ts src/lib/aiReview.ts`
after overlaying an older checkpoint. The suspicious PR must classify as
`full`; otherwise the security specialist will not run. If AI Gateway is
enabled, review model calls skip cache so reruns do not reuse an earlier false
negative.

## Going further (after the workshop)

The [Cloudflare blog post](https://blog.cloudflare.com/ai-code-review/) covers
the production version that inspired this workshop. The leap from REVIEWBOT
to that system is:

- 7 specialists instead of 3, including release management, internal codex
  compliance, and AGENTS.md materiality.
- Multi-provider failback (Anthropic ↔ OpenAI ↔ Workers AI) with circuit
  breakers.
- GitLab CI component for `.gitlab-ci.yml` integration.
- Braintrust for distributed tracing.
- A Cloudflare Worker control plane for live model-routing config.
- Telemetry to a separate Workers Logs pipeline.
- "Break glass" mechanic for production hotfixes.

Read the blog. You now have the mental model to actually build it.
