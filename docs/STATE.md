# STATE

## Current task
Goal 10: OpenAI-compatible endpoint for Home Assistant voice (docs/PLAN.md). Design approved by user (m02035).

## Done this session
- Workspace dialog "unknown message" fixed (workspace-get restored), dev 19b66ae, prod 83d5fa7 (healthy 8790).
- 10.1 api keys: src/api-keys.ts, tests/api-keys.test.ts. Suite 139/139.

## Next step
10.2: GET /v1/models and POST /v1/chat/completions in src/server.ts (before the session gate, bearer key check via findApiKey). Non-streaming; stream:true -> 400. Body cap separate from login's 1 KiB.

## How to run and test
- Tests: `npm run typecheck && npm test` (139 passing).
- Dev: `docker compose up -d --build` in durable-web/, check http://127.0.0.1:8787/healthz.
- Prod: `deploy/production/deploy.sh` (only when user asks). Backup first.

## Needs you
- Home Assistant reachability: the app listens on 127.0.0.1 only. Choose LAN bind or Tailscale, or keep local. Not decided.
- Create the HA API key once the endpoint exists (shown once in the browser settings).
- Browser check of workspace dialog (needs sign-in).

## Known gaps
- Chat view has no note that a folder overrides global settings.
- MCP-off per folder not verified with a live model call.
- "Keep going" loop (onYield) is the next big development after goal 10 (m02031).
