# GitHub App Migration Plan

## Current State
- Using a GitHub Personal Access Token (PAT) with broad permissions
- PAT is shared across monitor (read) and auto-fix workflow (write)
- Risk: PAT compromise = full access to all repos

## Target State
- Dedicated GitHub App: "StorScale CTO Agent"
- Per-repo installation tokens with minimal permissions
- Separate read-only and read-write token generation

## Steps

### 1. Create GitHub App
- Name: StorScale CTO Agent
- Homepage: https://github.com/StorScale-AI/cto-agent
- Permissions:
  - Repository: Actions (read/write), Contents (read/write), Pull requests (write)
  - Organization: Members (read) — for repo discovery
- Events: Workflow run
- Installation: Install on all StorScale-AI repos + personal repos

### 2. Generate Installation Tokens
Replace PAT usage with short-lived installation tokens:
- Monitor: generates read-only tokens for each poll cycle
- Auto-fix workflow: generates read-write token for the target repo only

### 3. Update Code
- `discovery.ts`: Use app installation API instead of user repos API
- `dispatch.ts`: Generate installation token for cto-agent repo
- `auto-fix.yml`: Use `actions/create-github-app-token` action
- Remove `GITHUB_PAT` env var, add `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY`

### 4. Rollback Plan
Keep PAT as fallback: if `GITHUB_APP_ID` is not set, fall back to `GITHUB_PAT`.

## Estimated Effort
- 2-3 hours for app creation + code changes
- Requires GitHub org admin access
