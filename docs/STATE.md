# STATE (handoff)

## Current task
UI design work (user m00946): 1) markdown rendering — DONE (commit 55ef85e); 2) modern UI restyle — DONE (378521f, CSS only); 3) further polish — not started.

## Done recently
- Goal 8 MCP servers complete (8.1–8.6), incl. edit server (a329be2). Production on a329be2.
- Markdown: public/markdown-view.js (marked 18.2.1 + DOMPurify 3.5.0, vendored in public/vendor/, img tags forbidden).
- Restyle: public/index.html <style> only.
- Push: origin main at 378521f (via temp GIT_ASKPASS script reading secrets/github_repo_api_key; recipe in /var/home/angel/Pi/host/AGENTS.md).

## Next steps
1. Live browser check on dev (http://127.0.0.1:8787): sign in with the token ONLY inside the browser (do not put it in tool calls), check markdown, restyle, goal 6 question card, goal 7 key row, goal 8 MCP panel + Edit.
2. Optional polish: settings bar grouping, composer states, empty-state.
3. Production redeploy (deploy/production/deploy.sh) only when user asks; back up app-data first.

## How to test
- npm run typecheck && npm test (83 passing).
- Dev: docker compose up -d --build; curl -s http://127.0.0.1:8787/healthz → ok.

## Known gaps
- Browser click-through not done for goal 6/7/8 UI or the new restyle (only static harness and WS tests).
- Goal 5.2 blocked (second account).

## Needs you
- Test chats/files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt, /workspace/mcp-live) — do not delete without approval.
