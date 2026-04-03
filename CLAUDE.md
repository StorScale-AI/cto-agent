# CTO Agent

## What This Is
Automated CI/deploy auto-fix agent and infrastructure monitor for all StorScale repos.
Monitors GitHub CI, Render deploys, Stripe webhooks, Supabase, Vercel, Cloudflare, and agent health.

## Architecture
- **patterns/** — Pattern matchers for known CI failure types (fast path, no AI)
- **monitor/** — Hono service on Render that polls all infrastructure and feeds health data
- **.github/workflows/auto-fix.yml** — Reusable workflow called by each repo on CI failure
- **prompts/** — Claude Code system prompts for novel failure analysis
- **caller-template/** — Thin workflow YAML to copy into each monitored repo

## Stack
- TypeScript, ESM (`"type": "module"`)
- Vitest for testing
- Hono + @hono/node-server for monitor service
- `anthropics/claude-code-action@v1` for AI-powered fixes

## Conventions
- Pattern matchers export `match(logText, annotations)` returning `PatternResult | null`
- Confidence threshold: 0.8 (below = escalate to Claude Code or Slack)
- Auto-fix commits use `[cto-fix]` tag in commit message
- Max diff: 5 files, 100 lines
- Max 1 fix attempt per failure — escalate on second failure

## Safety Rules
- NEVER modify .env files
- NEVER hardcode secrets
- NEVER delete tests
- Every fix MUST include a regression test
