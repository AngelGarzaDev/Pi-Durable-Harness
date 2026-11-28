# STATE (handoff)

## Current task
Goal (f) steer test: DONE (tests/steer.test.ts, docs/NOTES.md entry, tooltip checked). Next: S3 (bundle push tool +
approval page) per docs/DESIGN.md "Plan: approval-gated push and GUI secrets". Before S3, the open item below.

## Exact next step
Read docs/DESIGN.md section for S3, then build S3 in small commits with tests. Remember: pushes after each tested
step (AGENTS.md), no secrets in git, prod untouched (user said leave it).

## How to run and test
- Typecheck: `npm run typecheck`; tests: `npm test` (227 pass as of steer test).
- Dev: `docker compose up -d --build` in durable-web/, then `curl -s http://127.0.0.1:8787/healthz` -> ok.
- Live WS: login is POST /login with JSON {"token"}; then WS /ws with the cookie.
- Push: temporary askpass script in /tmp (recipe in AGENTS.md), delete afterwards.

## Done this session (all pushed to origin/main)
- S2 Anthropic key in encrypted store (68ba9d0, 4f29acb).
- Per-file upload limit removed; runner streams and picks names (b645580, 7fe36d6). Dev live check: 20 MB upload ok.
- Breaking-change wording removed from docs/NOTES.md.
- Steer test (f) added and verified (tests/steer.test.ts).

## Known failures / gotchas
- SELinux: secrets/master_key needs `chcon -t container_file_t` on enforcing hosts (setup-secrets.sh does this).
- Earlier: model write then read of turn-test.txt gave ENOENT (explained in NOTES: concurrent tool calls in one message).
- Test files s1.txt-s3.txt, turnlimit.txt, turn-test.txt exist in the workspace; do not delete without approval.
- Dev workspace has /workspace/uploads from upload checks; live proof file was removed.

## Open items for the user
- Folder picker browser check on dev not done (secret panel is confirmed working).
- Prod still runs the older build (user: leave prod alone for now).
- Steer test covers Pi Durable behaviour; the WS path (server.ts whenBusy mapping) is not tested end to end.

## Needs you
- Rollback caveat (S2): a key saved after S2 exists only in secrets.json; the pre-S2 build will not see it.

## Blocked
- None.
