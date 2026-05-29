# AGENTS.md

Conventions for AI coding agents working in this repo. This is the file your
agent reads first, every session. REVIEWBOT is an AI code reviewer built on
Cloudflare Workers with the Agents SDK.

## Use Cloudflare Skills

Install and rely on the [`cloudflare/skills`](https://github.com/cloudflare/skills)
bundle. Reach for the `agents-sdk`, `durable-objects`, and `wrangler` skills when
working on this codebase. Prefer the documented Cloudflare patterns over guesses.

```
# Claude Code
/plugin marketplace add cloudflare/skills
/plugin install cloudflare@cloudflare

# OpenCode / Codex / any Agent Skills tool
npx skills add https://github.com/cloudflare/skills
```

When accessing a Cloudflare Access-protected URL (for example a deployed `/mcp`
endpoint), use the `access-oauth` skill to authenticate via OAuth, or a service
token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) for non-interactive
calls.

## Stack

- Cloudflare Workers + the Agents SDK (`agents`).
- `ReviewAgent` and `ReviewMCP` are Durable Objects (SQLite-backed).
- `ReviewWorkflow` is a `WorkflowEntrypoint`.
- Workers AI for model calls, routed through AI Gateway when `AI_GATEWAY_ID` is set.
- Config in `wrangler.jsonc`. Work from the repo root so the agent sees the bindings.

## Commands

```bash
npm run dev      # local dev server at http://localhost:5173
npm run deploy   # deploy to Workers
```

## Conventions

- State is typed with Zod in `src/state.ts`. Keep it the single source of truth.
- `setState` persists AND broadcasts over WebSocket. Do not write ad-hoc storage.
- Tools live in `src/tools/`. A tool is only callable once it is added to the
  `tools` map in `onChatMessage`.
- New Durable Objects or Workflows must be exported from `src/server.ts` AND
  declared in `wrangler.jsonc`, or they silently never run.
- Secrets go through `wrangler secret put`, never into source.
- Validate all tool inputs with Zod. Gate destructive actions (like posting a
  review) behind `needsApproval`.

## Workshop checkpoints

Each module has a git tag: `checkpoint-0-starter` through `checkpoint-5-mcp`.
To recover canonical source while keeping notes, overlay just `src/`:

```bash
git checkout checkpoint-N-name -- src/
```

## Writing style

- Do not use em dashes. Use hyphens, commas, or rewrite the sentence.
