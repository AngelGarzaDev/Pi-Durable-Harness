# STATE

## Current task
Folder upload (user m00418 "Let's add the ability to upload folders not just files"): code, tests, UI done. Docs and commit in progress.

## Done this session
- Uploads (files) from earlier: src/uploads.ts, POST /upload (src/server.ts), POST /v1/upload (runner/server.ts). Prod has files-only uploads at 23c1db1.
- Folder upload: src/uploads.ts sanitizeRelativePath (max 8 folder levels, refuses "", ".", "..", bad parts). Browser sends x-relative-path; server keeps folder structure under the target; runner unchanged (already mkdirs).
- UI: "Folder" button in chat composer (inserts the saved folder path into the message) and a folder picker in the workspace dialog (public/index.html, public/app.js uploadFolder). Folder limit is now 2 GB total (no file count cap); Cancel upload button stops after the current file.
- tests/upload.test.ts: sanitizeRelativePath unit test, nested folder upload, unsafe path refused. Full suite 183 pass; typecheck ok.

## Next step
Update README/NOTES, commit, push (askpass recipe; delete script), dev redeploy and check healthz. Browser check of the folder picker not yet done. Prod NOT deployed (needs user go-ahead).

## How to run and test
- Tests: `npm run typecheck && npm test` (183 passing).
- Dev: `docker compose up -d --build` in durable-web/, check http://127.0.0.1:8787/healthz.
- Prod: `deploy/production/deploy.sh` (only when user asks). Backup first.

## Needs you
- Prod deploy of folder upload, when you say so.
- Keep-going design answers (11.1, from earlier).
- Goal 5.2 second user check (parked).
- Dev mcp.json "echo" entry and /workspace/mcp-live: delete if you want.
- Reverse proxy / HTTPS for LAN (you said you'll do it).
- Known: a folder name starting with a dot loses the dot (".github" becomes "github") because the name sanitizer drops leading dots.

## Planned next (not started)
- Staged folder upload: see docs/PLAN-STAGED-FOLDER-UPLOAD.md. Answer its 4 questions first.
