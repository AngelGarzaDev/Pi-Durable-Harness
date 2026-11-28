# STATE

## Current task
Uploads (user m00265) and update instructions (m00289): DONE in code, tests, docs. Ready to commit and push.

## Done this session
- Uploads: src/uploads.ts, POST /upload in src/server.ts, POST /v1/upload in runner/server.ts, attach button in chat composer and "Upload a file" in workspace dialog (public/index.html, public/app.js).
- tests/upload.test.ts: 10 tests pass. Full suite: 180 pass; typecheck ok.
- Dev redeployed (docker compose up -d --build), healthz ok, live chat upload verified; test file removed.
- Docs: README "Updating an install"; docs/PRODUCTION.md "Updating production (checklist)"; docs/NOTES.md entries.

## Next step
Commit (uploads + docs), push with the askpass recipe (delete the script after), record push range in NOTES. Prod NOT deployed (needs user go-ahead).

## How to run and test
- Tests: `npm run typecheck && npm test` (180 passing).
- Dev: `docker compose up -d --build` in durable-web/, check http://127.0.0.1:8787/healthz.
- Prod: `deploy/production/deploy.sh` (only when user asks). Backup first.

## Needs you
- Prod deploy of uploads, when you say so.
- Keep-going design answers (11.1, from earlier).
- Goal 5.2 second user check (parked).
- Dev mcp.json "echo" entry and /workspace/mcp-live: delete if you want.
- Reverse proxy / HTTPS for LAN (you said you'll do it).
