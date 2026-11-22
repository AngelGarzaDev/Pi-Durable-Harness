# STATE (handoff)

!! PRODUCTION is running at http://127.0.0.1:8790 (personal use, commit fb098e2). Read docs/PRODUCTION.md before touching any docker or deploy command. Do not change production without the user's request.

## Summary
pi-durable-web: browser chat for Claude on Pi Durable, with a sandboxed runner.
- Goals 1-6 done (turn-limit notice, steer timing, answer review, production, README, ask_user). 5.2 blocked (needs second account).
- Goal 7 (browser-entered Anthropic key, stored in DATA_DIR/credentials.json mode 600, pi-ai CredentialStore): code, tests, UI row and notes done, UNCOMMITTED at time of writing. Suite 62 passing.
- Goal 8 (MCP servers, Pi-style: @earendil-works/pi-mcp 1.6.0, stdio in runner, HTTP in app): planned in docs/PLAN.md, not started.

## Current task
- Goal 7: commit it (7.4 docs done in NOTES.md), then deploy dev and curl-check. Then start goal 8.1.

## Next step
1. Commit goal 7 (src/credentials.ts, src/harness.ts, src/config.ts, src/server.ts, public/*, tests/*, docs).
2. `docker compose up -d --build` in durable-web (DEV only), curl healthz 8787.
3. Goal 8.1: add @earendil-works/pi-mcp pinned 1.6.0, mcp.json validation, tests.

## How to run and test
- Typecheck: `npm run typecheck`. Tests: `npm test` (node:test, spawns real server on random port).
- Dev without Docker: see README (ports 8788 / 7101 to avoid the Docker stack on 8787).

## Known failures / watch
- Browser question card and key row not clicked in a real browser (WS path tested).
- I pushed to origin/main earlier (goal 6) although AGENTS.md says no pushes to remotes. Do not push again without the user's OK.
- Old test chats and files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt) still exist; do not delete without approval.
- Goal 5.2 needs a second user account (not possible here).

## Needs you
- Approve or reject the earlier push to origin (goal 6) and any future pushes.
- Delete test chats/workspace files (listed above) if you want them gone.
- Second account for goal 5.2 if you want that check.
