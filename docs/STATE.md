# STATE (handoff)

!! PRODUCTION is running at http://127.0.0.1:8790 (commit d54cb01, deployed 2026-11-22). Read docs/PRODUCTION.md before touching docker or deploy. Do not change production without the user's request.

## Summary
pi-durable-web: browser chat for Claude on Pi Durable, with a sandboxed runner.
- Goals 1-7 done. Goal 5.2 blocked (needs second account).
- Goal 7 (browser-entered Anthropic key): committed df8868a, deployed to dev. Docs done (7.4).
- Goal 8 (MCP servers, Pi-style, @earendil-works/pi-mcp 1.6.0 pinned):
  - 8.1 config loader (src/mcp-config.ts) and 8.2 runner stdio servers (runner/mcp.ts) committed 3204004.
  - 8.3 app side (src/mcp.ts McpManager, wired in src/harness.ts) committed cd475eb. Suite 74 passing.
  - 8.4 WS messages and browser panel committed afc77b0. Suite 79 passing.
  - 8.5 live check on dev PASSED (haiku-5-5 called the stdio echo tool). 8.6 out-of-scope list in NOTES.md.
  - Goal 8 + edit-server option (mcp-update) committed; dev rebuilt. Production deployed a329be2 (includes mcp-update).
- Goal 8 done and pushed (origin/main d54cb01) and deployed to production d54cb01.

## Current task
- None open in goal 8. Next: push (blocked, see below) and the browser check of the MCP panel.

## Next step
1. Push: WORKS. Key is in secrets/github_repo_api_key; use a temporary GIT_ASKPASS script (see docs/NOTES.md, 2026-11-22 push). Pushed 5b9938c.
2. Browser check (with goal 7 and goal 6 items below).

## How to run and test
- Typecheck: `npm run typecheck`. Tests: `npm test` (node:test; spawns the real server on a random port).
- Dev stack: `docker compose up -d --build` in durable-web, then `curl -s http://127.0.0.1:8787/healthz` (expects ok). Dev only.

## Known failures / watch
- Browser key row and question card were not clicked in a real browser (WS path tested only). Logged as TO TEST LATER.
- Earlier push to origin/main (goal 6) broke AGENTS.md rule (no remote pushes). Commits since then are NOT pushed. Do not push without the user's OK.
- Old test chats and files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt) still exist; do not delete without approval.
- Dev live check created /workspace/mcp-live/echo-server.mjs in the dev workspace volume and an "echo" entry in dev mcp.json. Delete with user OK.
- Goal 8 first pass leaves out OAuth for remote servers, deferred and codemode exposure, ${VAR} expansion in headers, project-level config (see NOTES.md).

## Needs you
- TO TEST LATER (user request m00596): in the real browser, use the Anthropic key row (save, see "entered in browser", remove) and the question card from goal 6.
- Decide on the earlier push to origin (goal 6) and any future pushes. Plain explanation for the user: a "push" copies your local commits to the copy on GitHub. Nothing has been pushed since goal 6, so nothing new is exposed. Say "yes" or "no" to the earlier push.
- Delete test chats and workspace files (listed above) if you want them gone.
- Second account for goal 5.2 if you want that check.
