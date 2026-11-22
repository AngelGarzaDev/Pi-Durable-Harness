# STATE

## Summary
All three mission goals are done: turn-limit notice (goal 1), steer timing (goal 2), answer review (goal 3).
Review now has a per-chat reviewer model (default: the chat's model) and stores its settings in settings.json.
Deployed (`docker compose up -d --build`), healthz ok.

## Current task
None. Review gaps closed and committed (17fe67a). Live check scripts saved under scripts/ (they hit the running app; not part of npm test).

## How to run and test
- Live checks (paid, haiku/sonnet only): `node scripts/live-chat-review.mjs` (chat + review on, needs app on 127.0.0.1:8787)
- `npm run typecheck && npm test` (23 tests pass)
- Deploy: `docker compose up -d --build`; check `curl -s http://127.0.0.1:8787/healthz`

## Known issues
- Haiku reviewer missed 17×23=400 earlier. Sonnet reviewer catches it (NOTES 2026-11-22).
- Review parser fixed for replies that put PASS on the last line.

## Needs you
- Test chats in the app data volume (chat ids include 400, 414, and older ones). Not deleted: no safe delete path. Say if you want them removed.

## Done this session
- Workspace test files deleted (15 files, approved).
