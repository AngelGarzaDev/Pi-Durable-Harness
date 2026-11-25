# STATE

## Current task
Goal 10 (Home Assistant voice, docs/PLAN.md): code, tests, docs and live check are done. Only the browser sign-in check of the panel is left.

## Done this session
- 10.2-10.4: /v1/models, /v1/chat/completions (non-streaming), voice chat per folder, voiceTools switch (default off). Commit f7c2de8 on prod.
- 10.5: voice key panel (create once, list, revoke) and folder voice-tools checkbox. Commit c1f45fb (dev only).
- 10.6: docs/HOME-ASSISTANT.md (9ee3397); live Haiku check pi/livecheck, 200, ~0.1 cent (ef410de, logged in NOTES).
- User confirmed HA subentry (http://192.168.1.30:8790/v1, pi/lifemanager) and a test conversation in Assist.
- Suite 154/154 before c1f45fb.

## Next step
1. User signs in to dev (127.0.0.1:8787), tries panel: create key, copy, revoke; toggle folder voice switch. Record result in NOTES.
2. Then deploy panel to prod only if user asks (prod is still f7c2de8, no panel).
3. Then start the keep-going loop (user request m02031; design notes in NOTES, not started).

## How to run and test
- Tests: `npm run typecheck && npm test` (154 passing).
- Dev: `docker compose up -d --build` in durable-web/, check http://127.0.0.1:8787/healthz.
- Prod: `deploy/production/deploy.sh` (only when user asks). Backup first.

## Needs you
- Browser sign-in check of the voice key panel on dev.
- Prod redeploy with the panel, if wanted. Prod key currently in deploy/production/secrets/ha_api_key is the one HA uses.
- LAN is plain HTTP (approved m02061). Consider HTTPS before heavy use.
