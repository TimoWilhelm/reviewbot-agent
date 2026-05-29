# 🤖 REVIEWBOT — your code, but make it judged

> Workshop reference repo. Build an AI code review agent on Cloudflare in 90 minutes. Then make it review itself.

Inspired by [Cloudflare's CI-native AI code reviewer](https://blog.cloudflare.com/ai-code-review/), simplified for a workshop.

## Workshop formats

This repo is the code you build. It is taught two ways:

- **Live:** a presenter drives the [`reviewbot-deck`](../reviewbot-deck/) slides while you build along.
- **Self-paced:** the agent-driven [`agents-school`](../agents-school/) walks you through every step with your coding agent. Its exercises map to the checkpoints below.

See [`WORKSHOP.md`](./WORKSHOP.md) for the full guide, including Module 0 (coding agent + Cloudflare Skills) and the Zero Trust setup.

## What you build

| Module                  | What's added                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| **0 — Setup**           | Bare reviewer persona, no tools                                            |
| **1 — Foundations**     | `Review` state, persistence, real-time UI                                  |
| **2 — Tools & AI**      | `fetchPR`, `reviewDiff`, Workers AI, AI Gateway, diff noise filter         |
| **3 — Workflows**       | `ReviewWorkflow`: 3 parallel specialists + risk tiers + coordinator        |
| **4 — HITL + Schedule** | `needsApproval` before posting, scheduled re-review                        |
| **5 — MCP**             | Expose `review-pr` and `review-diff` as MCP tools. **Review your own PR.** |

## Quick start

First, give your coding agent Cloudflare Skills so it writes Workers-correct code:

```bash
# Claude Code: /plugin marketplace add cloudflare/skills && /plugin install cloudflare@cloudflare
# OpenCode / Codex / any Agent Skills tool:
npx skills add https://github.com/cloudflare/skills
```

Then scaffold the project:

```bash
git clone https://github.com/TimoWilhelm/reviewbot-agent
cd reviewbot-agent
npm install
npm run dev
```

Open <http://localhost:5173>.

## Checkpoints

Each checkpoint is a git tag. To jump to one:

```bash
git checkout checkpoint-1-foundations
# or
git checkout checkpoint-3-workflows -- src/   # overlay code only, keep your notes
```

| Tag                          | State                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `checkpoint-0-starter`       | Where you start. Reviewer persona, no tools.              |
| `checkpoint-1-foundations`   | + state, persistence                                      |
| `checkpoint-2-tools-ai`      | + GitHub fetch, single-shot review tool, AI Gateway       |
| `checkpoint-3-workflows`     | + 3-specialist workflow with risk tiers                   |
| `checkpoint-4-hitl-schedule` | + approval gate + scheduled re-review                     |
| `checkpoint-5-mcp`           | + MCP server (`main` also adds workflow completion cards) |

The branch `pr/the-suspicious-change` contains a deliberately bad diff used as the climax demo in Module 5.

## Free-tier friendly

Uses only free Cloudflare features:

- Workers AI: `@cf/google/gemma-4-26b-a4b-it` (free Neurons)
- Durable Objects: SQLite-backed (free tier)
- Workflows: free tier (100k steps/day, more than enough)
- AI Gateway: free tier (100k logs/day)

No paid plan required.

## Deploy

```bash
npm run deploy
```

You get a public `https://reviewbot.<your-subdomain>.workers.dev` URL.

Optional secrets:

```bash
wrangler secret put GITHUB_TOKEN     # raises GitHub rate limit 60 → 5000/hr
```

## Secure it with Zero Trust

Once deployed, do not leave a comment-posting agent open to the internet. Put a
Cloudflare Access application in front of the Worker and the `/mcp` endpoint,
use a service token for machine-to-machine MCP calls, and a Tunnel for local
dev. See [`WORKSHOP.md`](./WORKSHOP.md#lock-it-down-with-zero-trust) and the
[authenticate agents guide](https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/).

## Going further

The [blog post](https://blog.cloudflare.com/ai-code-review/) covers the production version: 7 specialists, multi-model failback, circuit breakers, GitLab CI component, Braintrust tracing. This workshop teaches the mental model so you can read that blog and build the real thing.

## License

MIT
