# STATE

## Summary
pi-durable-web: browser chat for Claude on Pi Durable 1.6.0, running in Docker at http://127.0.0.1:8787.
Built: login with token and lockout, dark UI, settings (model, "Compact at" limit, max tool rounds), manual and automatic
compaction, steer, fork ("branch from here"), reset with handoff ("New context"), multiple chats, turn limit.
Default model is now claude-haiku-5-5 with a 100,000-token limit (config.ts, settings.ts).

## Current task
Mission from <host-dir>/AGENTS.md. Git baseline committed (1d673d8). Docs created on first run.

## Next step
docs/PLAN.md item 1.1: browser notice when a run stops at the turn limit. Start by adding `npm test` (node:test) and
a test for the submission status `unanswered` / reason `turn_limit`.

## How to run and test
- Typecheck: `npm run typecheck`
- Tests: `npm test` (to be created in PLAN item 1.0)
- Deploy: `docker compose up -d --build`; check `curl -s http://127.0.0.1:8787/healthz` = ok
- Logs: `docker compose logs app`
- Test client pattern: /tmp scripts POST /login with secrets/app_token, then WebSocket ws://127.0.0.1:8787/ws with the cookie.
  Never print the token.

## Known failures
- An earlier model `write` then `read` of turn-test.txt reported ENOENT (not investigated).
- Turn-limit stop shows `[call write]` with no notice in the browser.

## Needs you
- Test chats (about six) and workspace test files (s1-s3.txt, turnlimit.txt, turn-test.txt, docker-ok.txt) remain. Delete only on approval.
- Review-task design defaults (same model, off by default, one retry) were chosen by the agent; confirm before goal 3 is finished.

## Blocked
(none)
