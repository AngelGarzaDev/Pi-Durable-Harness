# STATE (2026-11-28)

## Current task
Runner internet access made the default (user m00826): DONE on dev, docs updated. Commit and push pending (see Status). Next after that: S2 (move the Anthropic key into the encrypted store), per docs/PLAN.md section "Plan: approval-gated push and GUI secrets".

## What was built recently
- S1 secret store (src/secret-store.ts, WS secrets-* messages, Secrets panel, scripts/setup-secrets.sh, tests secret-store.test.ts and secrets-ws.test.ts). Commit d027b33.
- Runner egress default: compose.yaml runner networks [tools, egress]; compose.internet.yaml is a no-op. Docs: README.md "Runner internet access", SECURITY.md, docs/DESIGN.md, docs/NOTES.md entry.
- Staged folder upload (7ea571c), folder 15 MB pre-check removed (f73e809), git in runner image (eaf8c34).

## Commands
- Tests: `npm run typecheck && npm test` (214 pass).
- Dev deploy: `docker compose up -d --build`; `curl -s http://127.0.0.1:8787/healthz` (ok).
- Host setup for secrets: `scripts/setup-secrets.sh` (safe to re-run). A hand-made file needs `chcon -t container_file_t secrets/<file>` (SELinux, else EACCES).
- Runner internet check: `docker compose exec runner node -e 'fetch("https://api.anthropic.com/")...'` (any HTTP status = reachable).

## Status
- Dev: runner reaches the internet by default; app reaches runner (port 7000).
- Prod (192.168.1.30:8790) still runs the old build and is tools-internal in deploy/production/compose.yaml (runner gets lan network there). Not deployed; needs go-ahead and an app-data backup first.

## Known failures / open
- Earlier: model write then read of turn-test.txt gave ENOENT, never investigated.
- Test chats and files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt) remain; do not delete without approval.
- Browser check of the Secrets panel and folder picker on dev not done.

## Needs you
- Whether to raise the 15 MB per-file upload limit.
- Go-ahead to deploy staged upload, pre-check removal, git tool, secrets store and runner egress to prod (prod needs setup-secrets.sh first).
