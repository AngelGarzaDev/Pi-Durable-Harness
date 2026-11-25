# STATE

## Current task
Goal 10 complete. Prod deployed at 3ade10a (panel included, healthy at 192.168.1.30:8790). Browser panel check on dev done by user.

## Done this session
- 10.2-10.4: /v1/models, /v1/chat/completions (non-streaming), voice chat per folder, voiceTools switch (default off). Commit f7c2de8 on prod.
- 10.5: voice key panel (create once, list, revoke) and folder voice-tools checkbox. Commit c1f45fb (dev only).
- 10.6: docs/HOME-ASSISTANT.md (9ee3397); live Haiku check pi/livecheck, 200, ~0.1 cent (ef410de, logged in NOTES).
- User confirmed HA subentry (http://192.168.1.30:8790/v1, pi/lifemanager) and a test conversation in Assist.
- Suite 154/154 before c1f45fb.

## Next step
1. Next: keep-going loop (user request m02031, not started). Design notes in NOTES.

## How to run and test
- Tests: `npm run typecheck && npm test` (154 passing).
- Dev: `docker compose up -d --build` in durable-web/, check http://127.0.0.1:8787/healthz.
- Prod: `deploy/production/deploy.sh` (only when user asks). Backup first.

## Needs you
- None for goal 10.
- LAN is plain HTTP (approved m02061). Consider HTTPS before heavy use.
