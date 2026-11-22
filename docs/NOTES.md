# NOTES (append-only)

- 2026-11-22: Default model set to claude-haiku-5-5 (src/config.ts) and default limit 100000 (src/settings.ts DEFAULT_CONTEXT_LIMIT, min with window-16384). Saved settings.json already had haiku/100000. Redeployed. Reason: user instruction.
- 2026-11-22: Repo git-initialised; baseline commit 1d673d8. secrets/, data/, node_modules/ gitignored.
- 2026-11-22: Live test rule: claude-haiku-5-5 only, context <= 100000. Paid APIs allowed (user instruction m01192).
- Pi Durable quirk: maxTurns stop => submission status "unanswered", reason "turn_limit", detail "N turns" (seen in DB, submissions table).
- Pi Durable quirk: steer (whenBusy:"steer") is recorded as a pi.user entry after the current tool results; it does not stop tool calls already issued (s3.txt still created in test).
- Earlier test helper scripts live in /tmp (not in repo); move to tests/ when creating `npm test`.
- 2026-11-22 (step 1.3): old ENOENT cause found. The model put `write` and `read` of turn-test.txt in ONE assistant message (entry 171). Tool calls in one message run concurrently, so read ran before write finished (entry 174 ENOENT). File layer is fine. Mitigation: system prompt rule added in src/prompt.ts (wait for write result before reading in a later message). Not yet verified live.
- 2026-11-22 (1.1/1.2): turn-limit notice. Source: view.docs["pi.live"].runFailure (reason turn_limit, detail "1 turn"). Server adds `notice` to each `view` message (src/notice.ts, tested). UI shows it in #notice above transcript. Live check with haiku at 100000 passed: notice text received after maxTurns=1 run; cleared after normal run.
- 2026-11-22 (1.4 live, haiku 100k): write then read in separate steps: tool results write,read, no errors, correct answer. PASS.
- 2026-11-22 (2.1 live, haiku 100k): sequential bash steps `sleep 8 && echo N > cN.txt`; steer sent at 5s during step 1. Entries: user > system > assistant > tool-result > user(steer) > assistant "DONE-STEER". c2-c4 were NOT created. Steer is applied after the current tool step, and the rest of the plan is dropped. PASS.
- 2.2: steer tooltip text updated in public/index.html.
- 2026-11-22: Review tasks (goal 3). Design: src/review.ts. Reviewer = the chat's own model (agent.model) via completeSimple; per-chat toggle stored in data volume reviews.json (ReviewSettings); OFF by default; one retry max (a continuation starting "[Review]" is not reviewed again). Reviewer error = verdict "error", answer stands. Every review writes an `answer-review` transcript entry (pass/fail/error). Reason for a durable task: the verdict is a committed entry, and the hook returns tasks rather than calling the model inside onYield.
- 2026-11-22: Pi Durable surprise: installed extensions apply to every conversation by default (README "Extensions"), so installing reviewExtension in src/harness.ts is enough; no per-conversation extension selection needed.
- 2026-11-22: Live review check, claude-haiku-5-5, limit 100000, 3 chats, about 0.05 USD total (estimate): (a) capital of France -> PASS, transcript shows "Review: PASS"; (b) claim of a saved file without a tool -> FAIL, one retry, retry answered honestly, not reviewed again; (c) deliberate wrong sum 17x23=400 -> PASS (reviewer missed the arithmetic error). Limitation: the same small model reviews its own answers, so it misses arithmetic errors. Possible improvement: a stronger reviewer model (not done: the mission says use only haiku for live calls).

## 2026-11-22 review gaps closed (reviewer model, settings.json, parser)
- Decision: per-chat reviewer model, default "same as chat". Stored as `settings.json` `reviews: { "<chatId>": { on, reviewerModel? } }`, matching root PLAN.md item 3. Old `reviews.json` (list of ids) is copied once on first start; the file is left in place and no longer read.
- Decision: `saveSettings` merges into settings.json so chat settings and review settings can coexist.
- Bug fixed: `parseVerdict` read a reply that works through the sum and ends with PASS as a FAIL. Now the first line PASS passes; a trailing PASS line passes only if no line starts with FAIL. Prompt now asks for the verdict first.
- Live test (sonnet, not haiku, reviewer only): `reviewer` prompt on "What is 17 times 23?" with answer "17 times 23 is 400." -> FAIL "Arithmetic error: 17 × 23 = 391". Same question with 391 -> PASS after the parser fix. Cost about $0.0003 per call.
- Live test (chat haiku, reviewer sonnet): chat 414, neutral question "What is 17 times 23?" -> answer 391, review entry PASS with reviewer claude-sonnet-5-5. Cost well under $0.01.
- Lesson: an earlier arithmetic test asked the chat to give a deliberately wrong answer. The reviewer correctly judged that as matching the request, so the test proved nothing. Test the reviewer with a neutral question and a wrong answer.
- Test chats created for these checks: 400 and 414 (review on). Not deleted (no delete path; user to decide).
- Live-check scripts saved to durable-web/scripts/: live-chat-review.mjs (WebSocket chat check) and live-review-checks.mjs (haiku review checks, earlier run). Both need the running app and secrets/ on disk; not run by npm test.

## 2026-11-22 Goal 4.1: HTTP/WebSocket hardening
- WebSocket Origin is checked (src/guard.ts originAllowed): closes cross-site WebSocket hijacking (review F1). Requests with no Origin still need the cookie.
- Login attempts are counted before the body is read (LoginLimiter); a 413 for an oversized body also counts. Records are pruned when quiet.
- Static files: explicit allowlist PUBLIC_FILES; the source tree is never served (review F13).
- Security headers on every response. CSP allows style-src 'unsafe-inline' because index.html has a <style> block and inline style attributes; scripts stay 'self' only.
- Logout is POST (204) with a sign-out button; GET /logout no longer works (review F22).
- Errors reach the browser as "Something went wrong (ref xxxxxxxx)"; the full error is logged on the server (review F11).
- SECURE_COOKIES=1 adds the Secure flag for HTTPS deployments. Off by default because the default install serves plain HTTP on 127.0.0.1.
- Sessions still never expire; the cookie is derived from the token, so rotating the token is the only revoke (review F5, accepted for now, recorded).
- Test: tests/http.test.ts starts the real server in a child process (no model call; runner URL points at a closed port).

## 2026-11-22 Goal 4.2: runner hardening
- Runner requires `Authorization: Bearer <runner_token>` on every route except GET /healthz (review F2). Token file: secrets/runner_token (gitignored, 64 hex chars from openssl rand -hex 32), mounted as Docker secret runner_token in both containers; env RUNNER_TOKEN_FILE. Missing or short (<32) token = startup error.
- Path check moved to runner/guard.ts insideRoot: walks to nearest existing ancestor and realpaths it; dangling symlinks are refused (review F3). Non-string paths return code "invalid" (F4).
- Method names checked with Object.hasOwn (F17). Request body capped at 16 MiB (413, connection closed) (F16).
- App side: RemoteExecutionEnv sends the bearer token; non-exec calls time out after 30 s (F19). Exec streams with no timeout; the command's own timeout still applies.
- Runner 500 responses no longer carry the raw error text; it is logged on the server (F11).
- Tests: tests/runner-guard.test.ts (unit) and tests/runner-http.test.ts (starts runner/server.ts as child; auth, 413, symlink escape, non-string path, prototype method names).
- Surprise: fetch (undici) reuses a keep-alive socket that the server destroyed after an oversized upload, which showed as ECONNRESET on the next test. Fixed by sending 413 with connection: close before destroying the request.

## 2026-11-22 Goal 4.3: process robustness
- Chat list and "apply to all chats" follow scanConversations cursors (collectPages in src/chats.ts); before, both stopped at 200 chats (review F10). Tested with tests/collect-pages.test.ts.
- unhandledRejection is logged instead of ignored; watch stop errors are logged (F7). Shutdown terminates WebSocket clients, closes the HTTP server, closes the harness, and forces exit after 10 s (F18).
- Accepted and recorded: sessions do not expire and logout does not revoke the cookie (F5). The cookie is HMAC-like (sha256 of "session:"+token), so changing secrets/app_token is the only revoke. Documented in SECURITY.md.

## 2026-11-22 Goal 4.4: packaging
- License field is AGPL-3.0-or-later (LICENSE at repo root is the AGPL-3.0 text). Name and description set; the stale "main": "index.js" and empty author removed.
- Removed unused React, react-dom, vite, and their @types (the UI is plain JS in public/). The "build" script (tsc plus vite, vite not configured) is gone; "start" runs src/server.ts through tsx, "start:runner" runs the runner. Previously "start" pointed at dist/server.js, which was never built.
- tsx moved to dependencies because the production images run the TypeScript source directly. Production image installs with npm ci --omit=dev (verified: no typescript, react or vite in the app image).
- Engines stays >=22.19.0 (node:sqlite needs 22.13+).
- Runner token wired in compose.yaml for both services (secret runner_token, file secrets/runner_token, gitignored).

## 2026-11-22 Goal 4.5-4.6: public release hygiene and verification
- History rewritten (git 2.56 has no filter-branch; used git fast-export | python rewrite | fast-import). Replaced host paths, LAN IPs, the host name and the host user name; author now "pi-durable-web contributor <contributor@example.invalid>". Commit hashes changed. Verified: no hits for /var/home, htpc, 192.168, angel in history or tree; no hits for the value of any secret file. The old repo was kept at /tmp/durable-web-orig-git-backup (outside the repo) until the user agrees; delete it then.
- Deploy surprise: the runner (uid 10001) could not read secrets/runner_token (EACCES), because the file was mode 600 and owned by the host user. Also SELinux was Enforcing and the file under /var/home had label user_home_t. Fix: chmod 644 plus chcon -t container_file_t. The README quick start now says so. The token is random and shared with only this stack, so 644 is an accepted trade-off.
- Verified after deploy: docker compose up -d --build; runner healthy; curl http://127.0.0.1:8787/healthz returns ok; runner logs "runner listening on 0.0.0.0:7000, workspace /workspace".
- Test suite on the rewritten history: npm run typecheck clean, npm test 51 pass.
- Public release assets: LICENSE (AGPL-3.0), README.md (quick start), SECURITY.md (accepted risks), docs/DESIGN.md (was root PLAN.md), docs/REVIEW-2026-11-22.md (security review that drove goal 4).

## 2026-11-22 Container uid: run as the host user
- Problem: containers ran as fixed uid 1000 (app) and 10001 (runner). A host user with another uid could not read secrets, and the runner needed a 644 secret plus an SELinux relabel. Other users would hit this.
- Decision: pass the invoking user's uid/gid as build args (`APP_UID`/`APP_GID` from `.env`, written by `scripts/setup-secrets.sh`), so secrets stay mode 600 and owned by that user. Rejected: chmod 644 or ACLs (loosens secrets), and a fixed uid other than the host user (same problem).
- Trade-off: runner shares the host uid. Documented in SECURITY.md.
- Workspace volume was owned by 10001; chowned to 1000:1000 once (it was empty). README has the upgrade command.
- Verified: `docker compose up -d --build` healthy, app uid 1000, runner uid 1000 writes to /workspace, healthz ok. Not verified with a second real host user (no second account available); the build-arg path was checked with `HOST_UID=4321 docker compose config` which showed APP_UID "4321".

## 2026-11-22 Verification record (goal 4.6) and superseded notes
- Superseded: the "Deploy surprise" entry above (chmod 644 + chcon on runner_token) is no longer the approach. Since 2c80f74 the containers run as the host user's uid, and secrets stay mode 600.
- Smoke test run against the running stack (no secret values printed): POST /login with the app token -> 200 and a session cookie; GET / with cookie -> 200; GET / without cookie -> 302 to /login; POST /login with a wrong token -> 401 {"ok":false}. WebSocket /ws with cookie and origin http://127.0.0.1:8787 -> opens; with origin http://evil.example -> rejected (401). The check script was run from the repo and deleted afterwards.
- Also verified: npm run typecheck clean; npm test 51 pass; docker compose up -d --build healthy; app and runner uid 1000; runner can write /workspace.
- Not verified: a second real host user (no second account here). Git history was rewritten once (2da46e6 era); no secret value appears in tree or history (scan by grep of tracked files and history for /var/home, htpc, 192.168, angel, and the secret file contents).
