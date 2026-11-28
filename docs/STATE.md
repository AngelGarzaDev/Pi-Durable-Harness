# STATE (2026-11-28)

## Current task
Step S1 of the approval-gated push and GUI secrets plan (docs/PLAN.md, section "Plan: approval-gated push and GUI secrets") is DONE and deployed to dev. Next: S2 (move the Anthropic key into the encrypted store).

## What was built (S1)
- src/secret-store.ts: AES-256-GCM store in DATA_DIR/secrets.json; master key from MASTER_KEY_FILE (default /run/secrets/master_key, 64 hex). Name is AAD.
- src/server.ts: WS messages secrets-list, secrets-reauth (app token; 5 min window per socket), secrets-set, secrets-remove. Audit: DATA_DIR/secrets-audit.log (no values).
- Panel "Secrets" in the global settings dialog (public/index.html, public/app.js). Names and times only.
- compose.yaml: master_key secret for app. scripts/setup-secrets.sh creates secrets/master_key.
- Tests: tests/secret-store.test.ts, tests/secrets-ws.test.ts. npm test 214 pass, typecheck clean.

## Commands
- Tests: `npm run typecheck && npm test`
- Dev deploy: `docker compose up -d --build`; check `curl -s http://127.0.0.1:8787/healthz` (ok).
- Host setup: `scripts/setup-secrets.sh` (safe to re-run). If a secret file was created by hand, run `chcon -t container_file_t secrets/<file>` (SELinux, else EACCES).

## Status
- Dev app running with master_key (container healthy after chcon fix).
- Not committed yet at time of writing: S1 changes (run `git status`). Commit after tests pass, then push per AGENTS.md rule.
- Prod (192.168.1.30:8790) still runs the old build. Not deployed; needs your go-ahead and an app-data backup first.

## Known failures / open
- Earlier: model write then read of turn-test.txt gave ENOENT, never investigated.
- Test chats and files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt) remain; not to be deleted without approval.
- Browser check of the Secrets panel and folder picker on dev not done.

## Needs you
- Whether to raise the 15 MB per-file upload limit.
- Go-ahead to deploy staged upload, folder pre-check removal, git tool and the secrets store to prod.
- Prod master key and app token: one SSH step per new host (docs/DESIGN.md).
- Pending decision: none for S2 and S3, as the design was approved (m00702, m00705, m00712).
