# STATE

## Summary
pi-durable-web: browser chat for Claude on Pi Durable 1.6.0, running in Docker at http://127.0.0.1:8787.
Built: login with token and lockout, dark UI, settings (model, "Compact at" limit, max tool rounds), manual and
automatic compaction, steer (joins after the current tool step, tooltip + NOTES), fork, reset with handoff, multiple
chats, turn-limit notice in the transcript, and answer review (per chat, off by default; reviewer = chat's model;
one retry; every review shows in the transcript).
Default model claude-haiku-5-5, 100,000-token limit.

## Current task
Goals 1-3 of <host-dir>/AGENTS.md are implemented and checked. Review work is ready to commit.

## Next step
Commit the review work (src/review.ts, public/review-view.js, tests/review.test.ts, harness/server/app/index changes,
docs). Then stop: all three goals are done.

## How to run and test
- Typecheck: `npm run typecheck`; tests: `npm test` (20 passing)
- Deploy: `docker compose up -d --build`; `curl -s http://127.0.0.1:8787/healthz` = ok
- Live check scripts (not in repo): /tmp/live-review.mjs pass|fail|claim (WebSocket client, reads secrets/app_token, never prints it).

## Known failures
- Reviewer (haiku) passes wrong arithmetic (17x23=400). Recorded in NOTES; not fixed.
- Earlier model `write` then `read` of turn-test.txt reported ENOENT. Cause found earlier (see NOTES 1.3).

## Needs you
- Test chats (about six) and workspace test files (s1-s3.txt, turnlimit.txt, turn-test.txt, docker-ok.txt, race-test.txt,
  a1-a4.txt from live tests) remain. Delete only on approval.
- Review defaults (same model, off by default, one retry) were chosen by the agent; confirm.
- Unclear item from the earlier session: "Start in the order you provided". Not acted on.

## Blocked
(none)
