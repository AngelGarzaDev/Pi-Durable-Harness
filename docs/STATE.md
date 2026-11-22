# STATE (handoff)

## Summary
pi-durable-web: browser chat for Claude on Pi Durable, with a sandboxed runner. Goals 1-3 (turn-limit notice, steer timing, answer review with per-chat reviewer model) are done. Goal 4 (public GitHub release and production hardening, request m00307) is done: app and runner hardening, process robustness, packaging, public docs, history scrubbed, deployed and healthy.

## Current task
None open in the mission. Everything is committed (HEAD: see `git log`).

## How to run and test
- Tests and types: `npm run typecheck && npm test` (51 tests).
- Deploy: `docker compose up -d --build`, then `curl -s http://127.0.0.1:8787/healthz` (prints ok).
- Live model calls cost money: scripts/live-review-checks.mjs and scripts/live-chat-review.mjs. Use claude-haiku-5-5 only (limit 100000) unless the user approves more.

## Known failures and limits (accepted, see SECURITY.md)
- Sessions never expire and logout does not revoke the cookie (review F5).
- Runner has no internet by default; compose.internet.yaml allows egress; runner shell can read the workspace only.
- Earlier test chats (and their workspace files) remain in app-data; not deleted without user approval.

## Needs you
- The old unscrubbed git history is kept at /tmp/durable-web-orig-git-backup. Delete it when you are satisfied with the new history.
- Choose the public GitHub remote and push (no push done; no remote configured).
- Container uid now equals the host user (see SECURITY.md "Container user"); no 644 secret needed.

## Next steps
1. Push to the public GitHub repo when the user provides a remote.
2. Optional: review docs/REVIEW-2026-11-22.md for items not yet fixed (F5 sessions, F6 Secure flag default, F23 runner egress design).
