# STATE

## Current task
Goal 11: keep-going loop (docs/PLAN.md). 11.1-11.3 done (165/165 tests). Next: 11.4 UI toggle and stop-note rendering.

## Done this session
- Goal 10 complete; prod at 3ade10a (voice key panel live, healthy at 192.168.1.30:8790).
- Test-data cleanup: deleted dev /workspace/livecheck and /workspace/life_manager_questionnaire.md (user approved). Kept /workspace/mcp-live (still referenced by dev mcp.json as "echo").
- User confirmed: MCP settings, MCP dialogs, question card, MCP-off work. No chat-view note needed.

## Next step
11.1: ask the user to restate "keep going" (the original wording m02031 is not in the notes): when to continue, stop marker, max continues. Then 11.2.

## How to run and test
- Tests: `npm run typecheck && npm test` (154 passing at last run).
- Dev: `docker compose up -d --build` in durable-web/, check http://127.0.0.1:8787/healthz.
- Prod: `deploy/production/deploy.sh` (only when user asks). Backup first.

## Needs you
- Keep-going design answers (11.1).
- Goal 5.2 second user check (parked, m01458).
- Dev mcp.json "echo" entry and /workspace/mcp-live: delete if you want (say so).
- Reverse proxy / HTTPS for LAN (you said you'll do it).
