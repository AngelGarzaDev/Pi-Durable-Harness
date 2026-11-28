# STATE (handoff)

## Current task
S2 done: browser-entered Anthropic key lives in the encrypted store (commit "S2: keep the browser-entered
Anthropic key in the encrypted store ..."). Next: S3 (bundle push tool + approval page), see docs/DESIGN.md
"Plan: approval-gated push and GUI secrets".

## Exact next step
Open docs/DESIGN.md section for S3. Decide with the user first (open item a below) whether auth-set needs app-token
re-auth. Then build S3 in small commits with tests.

## How to run and test
- Typecheck: `npm run typecheck`; tests: `npm test` (223 pass as of S2).
- Dev: `docker compose up -d --build` in durable-web/, then `curl -s http://127.0.0.1:8787/healthz` -> ok.
- Live WS checks: login is POST /login with JSON {"token"}; then WebSocket /ws with the cookie.

## Known failures / gotchas
- SELinux: secrets/master_key needs `chcon -t container_file_t` on enforcing hosts (setup-secrets.sh does this).
- Earlier: model write then read of turn-test.txt gave ENOENT, not investigated.
- Test files s1.txt-s3.txt, turnlimit.txt, turn-test.txt exist in the workspace; do not delete without approval.

## Open items for the user (not blocking)
a. Should changing the Anthropic key require app-token re-auth (DESIGN says yes; UI does not)?
b. Prod deploy of S2, staged upload, folder pre-check removal, git, secret store, runner egress: needs go-ahead and an app-data backup.
c. (Done in this change) per-file upload limit removed.
d. Browser check of the Secrets panel and folder picker on dev not done.
e. docs/NOTES.md still has old breaking-change wording (append-only log; decide).
f. No automated test for steer, although docs/PLAN.md item 2.1 is ticked.

## Needs you
- Rollback caveat (S2): a key saved after S2 is only in secrets.json; the pre-S2 build will not see it. Re-enter it or keep the Docker secret.

## Blocked
- None.
