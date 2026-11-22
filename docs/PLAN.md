# PLAN

## Goal 1: turn-limit notice (tests first)
- [x] 1.0 Add `npm test` (node:test) and a test script; keep typecheck passing.
- [x] 1.1 Server: when a submission ends `unanswered` with reason `turn_limit`, send a message to the browser. Test with a mock.
- [x] 1.2 UI: show a notice in the transcript ("Stopped after N tool rounds. Raise Max tool rounds in settings to continue."). Test the render function.
- [x] 1.3 (cause found; prompt rule added, live verification pending in 1.4) Investigate the old ENOENT read error; record cause in NOTES.md.
- [x] 1.4 Live check with claude-haiku-5-5 at 100000 tokens, using docs/templates if large text is needed. Log in NOTES.md.

## Goal 2: steer timing
- [x] 2.1 Test: steer sent during a multi-step run is recorded and acknowledged (mock or haiku live check).
- [x] 2.2 UI tooltip and docs/NOTES.md: steer joins after the current tool step.

## Goal 3: review tasks (design in root PLAN.md "Plan: review tasks")
- [x] 3.1 Per-chat review setting (off by default), stored in settings.json under "reviews" (NOTES 2026-11-22).
- [x] 3.4 Per-chat reviewer model (default same as chat), dropdown #reviewer; parser fix; sonnet arithmetic check (NOTES 2026-11-22).
- [x] 3.2 Reviewer task via onYield hook, same model default, one retry max. Hook tests in tests/review.test.ts.
- [x] 3.3 Transcript entry for review result; live check with haiku at 100000 tokens (NOTES: PASS, FAIL+retry, one miss).

Done rule: tests, `npm run typecheck && npm test`, docs, commit.

## Goal 4: production readiness and public release (started 2026-11-22)
Source: independent read-only review (findings numbered as in that review; full text in docs/REVIEW-2026-11-22.md).
- [x] 4.1 App HTTP/WS hardening: Origin check on WebSocket (F1), login attempt reserved before body read and map pruned (F9), 413 on big login body (F14), cookie Max-Age and optional Secure via SECURE_COOKIES (F5/F6), security headers (F12), static allowlist (F13), generic client errors with ids (F11), WS maxPayload + content cap (F8), settings type checks (F21), logout as POST (F22). Pure helpers in src/guard.ts with tests.
- [x] 4.2 Runner hardening: shared bearer token file for app->runner (F2), reject non-string paths (F4), dangling-symlink check via lstat (F3), body cap (F16), Object.hasOwn on methods (F17), guard in runner/guard.ts with tests. remote-env sends the token and a 30 s timeout (F19).
- [ ] 4.3 Process: unhandled rejection logging and close-handler catch (F7), graceful shutdown with client close and timeout (F18), paginate chat list and applyToAll past 200 (F10).
- [ ] 4.4 Packaging: prod-only install in Docker (F20), drop unused React/Vite, tsx as runtime dep, license field AGPL-3.0-or-later, fix `start` script, compose runner_token secret.
- [ ] 4.5 Repo hygiene: sanitize host paths/IPs/hostnames from docs and scripts, move root PLAN.md to docs/DESIGN.md, rewrite git author on history, scan full history for secrets, README (quick start, unsafe defaults noted), SECURITY.md, .gitignore.
- [ ] 4.6 Verify: typecheck, npm test, docker compose up --build, healthz, curl login and WS smoke, no secrets in `git ls-files` or history.
