# STATE (handoff)

## Summary
pi-durable-web: browser chat for Claude on Pi Durable, with a sandboxed runner.
- Goals 1-3 done: turn-limit notice, steer timing (tests + tooltip), answer review (per-chat, reviewer model, settings.json).
- Goal 4 done: public-release hardening, AGPL-3.0-or-later, README quick start, SECURITY.md, history scrubbed.
- Containers run as the invoking host user's uid (setup-secrets.sh writes .env). Secrets stay mode 600.
- Deployed and healthy. Login, cookie gate, and WebSocket origin check verified (see NOTES 2026-11-22 verification).

## Current task
None open. Everything is committed (HEAD: `git log -1`). Goal 5 documentation audit done except 5.2.

## How to run and test
- Setup: `./scripts/setup-secrets.sh`, then `docker compose up -d --build`, then `curl -s http://127.0.0.1:8787/healthz` (prints ok).
- Tests: `npm run typecheck && npm test` (51 tests).
- Live model calls cost money: scripts/live-review-checks.mjs and scripts/live-chat-review.mjs. Use claude-haiku-5-5 only (limit 100000) unless the user approves more.

## Known limits (accepted, see SECURITY.md)
- Sessions never expire; logout does not revoke the cookie (review F5).
- Runner shares the host uid (SECURITY.md "Container user").
- Test chats and their workspace files from earlier work remain; not deleted without approval.

## Needs you
- Second host user check not possible here (PLAN 5.2).

## Next steps
1. Done: pushed to https://github.com/AngelGarzaDev/Pi-Durable-Harness.git (main). Future pushes: see AGENTS.md "Pushing".
2. Optional: work through docs/REVIEW-2026-11-22.md items not yet fixed (F5, F6 Secure flag, F23).
