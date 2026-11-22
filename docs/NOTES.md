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
- 2026-11-22 GitHub upload: remote `origin` = https://github.com/AngelGarzaDev/Pi-Durable-Harness.git, pushed `main` at ff8efa9 (history scrubbed earlier, see entry above). The fine-grained PAT was moved from the repo root to `secrets/github_repo_api_key` (mode 600, gitignored). Pushes used a temporary credential helper that reads that file; no token in `.git/config`. Local branch is `master`, tracking `origin/main`. Pre-push: typecheck ok, 51 tests pass. The token's permissions were not changed (no tool for that here); narrow them on GitHub if needed.
- 2026-11-22: local branch renamed master -> main (tracking origin/main). The old unscrubbed backup at /tmp/durable-web-orig-git-backup was already gone when checked, so nothing was deleted. Test chats and workspace files from earlier work were left alone (they need separate approval).
- 2026-11-22 README audit: clone URL set to the real repo; manual secrets steps are one commented code block; dev-without-Docker section now creates ./workspace (runner does not create it) and warns to stop Docker first (both use 8787). Removed the default-values claim that the runner binds 0.0.0.0 on the dev command. Old-volume "Upgrading" note moved to its own section. Verified: dev app and runner start and answer /healthz (app on 8788, runner on 7101 to avoid the Docker stack; ports were overridden, paths unchanged); docker compose up --build healthy.

## 2026-11-22 ask_user feature (goal 6)
- Question is a parked tool call: `sleep` with signal `app.answer` keyed by a memoized UUID, so no process waits. Chosen over a blocking tool because a restart or browser reload then loses nothing.
- Pi Durable surprise: `JsonValue` is not exported from `@earendil-works/pi-durable`; use the concrete type. `harness.resume()` must be called or nothing runs (tests hang with no error). `watch.start(cb)` is needed for `watch.value` to update.
- Server checks that the question is open in the chat on that socket before calling `harness.signal`, so a client cannot answer another chat's question. Pi Durable itself checks nothing about senders.
- Answer limit 2000 characters, options max 6 of 200 characters, question 1000 characters (src/ask.ts constants).
- Tests: tests/ask.test.ts uses the faux provider from @earendil-works/pi-ai (no paid call). Suite: 56 tests pass.

## 2026-11-22 live check and deploy (goal 6.4, 6.5)
- Live check, claude-haiku-5-5, context limit 100000 (default). Script /tmp/livecheck/run.mjs (outside repo, not committed): logs in with the app token read from file (not printed), opens WS, sends new + submit asking for a two-option colour question, clicks "Red", waits for final reply. Result: question seen with options ["Red","Blue"]; answer-result ok; model replied "You chose Red.". Cost: 3 runs of about 3 calls each, well under $0.05.
- One early run waited for a reply that did not match the detection rule (the detection was too loose), so it was re-run with a fixed rule; the re-run passed. Browser UI itself was not clicked (no browser login without putting the token in a tool call); the card HTML/JS was checked with node --check and the WS path was tested live.
- `docker compose up -d --build` ok; app healthy; `curl -s http://127.0.0.1:8787/healthz` returns ok.

## 2026-11-22 goal 7: browser-entered Anthropic key
- Decision (user m00454: allow browser-entered key; reuse Pi's architecture). Storage: DATA_DIR/credentials.json, mode 600, in the app-data volume, plaintext. Alternative (encrypted with a key kept elsewhere) rejected for now: the key that decrypts would sit next to the ciphertext in the same volume, so it adds little. Revisit if the data volume is ever shared or backed up off-host.
- Mechanism: pi-ai's Models reads a CredentialStore on every request, so a new key takes effect with no restart. Stored key beats the Docker secret (pi-ai anthropic provider resolve order: stored credential, ANTHROPIC_AUTH_TOKEN, env keys, federation).
- The Docker secret is now optional when a browser key exists (readOptionalApiKey). With neither, startup still fails with the original readApiKey error.
- Surprise: pi-ai's `@earendil-works/pi-ai/auth` subpath does not exist; types come from the package root.
- Key never leaves the server: auth-status / auth-set replies carry only source and last four characters. Format check only (sk-ant- prefix, length 20–300, no spaces); no live call.
- Tests: tests/credentials.test.ts (5), tests/http.test.ts auth WS test. Suite 62 passing, typecheck clean.
- UI: key row under the settings bar (password field, Save key, Remove browser key). Checked with node --check and curl; not clicked in a real browser (no token in tool calls).

## 2026-11-22 goal 8.1: MCP dependency and config
- Pinned @earendil-works/pi-mcp 1.6.0 exact (npm install --save-exact). Its config types and validateMcpServerConfig are used for each entry; app adds name rules and "exactly one of command or url" (Pi's validator alone accepts both).
- Config file: DATA_DIR/mcp.json, Pi's mcpServers shape, mode 600, written atomically. src/mcp-config.ts; tests/mcp-config.test.ts (6 tests). Env values and headers are NOT expanded (no ${VAR} substitution yet); a decision for 8.3 since it touches secrets.
- Surprise: npm install printed "install-scripts" warnings; no install scripts are needed by this package (deps: cross-spawn only).

## 2026-11-22 goal 8.1–8.2: MCP config and runner stdio servers
- Pinned @earendil-works/pi-mcp 1.6.0 (exact). Its validator accepts both command and url, so src/mcp-config.ts adds the exactly-one rule.
- Config file: DATA_DIR/mcp.json, Pi's mcpServers shape, written with mode 600 via tmp file + rename.
- Stdio servers run in the runner (runner/mcp.ts). Each child gets a minimal env (PATH, HOME, user env only) because StdioTransport merges process.env unless inheritEnv is false. Relative cwd resolves inside the workspace; outside is refused.
- Risk to remember: anyone who can add a server can run its command inside the runner container (workspace volume only, no credentials). The runner has no secrets by design; keep it that way.
- Test fixture: tests/fixtures/mcp-echo-server.mjs; tests/runner-mcp.test.ts (4 tests).
- Bug found by test: a relative cwd was refused and then start reported "server is not running". Fixed: relative cwd is resolved against the workspace root.

## 2026-11-22 goal 8.3: app side MCP (src/mcp.ts, McpManager)
- One pi-durable extension per server, named mcp:<server>; tools mcp__<server>__<tool>. exposure hidden → callers ["tools"], otherwise ["model"]. deferred and codemode exposure are NOT in this pass.
- http servers: StreamableHttpTransport + McpClient inside the app. stdio servers: via runner /v1/mcp/*.
- Headers are sent literally; ${VAR} expansion is not done (first pass).
- Surprise: Registry has no tools() method; use registry.snapshot().tools() → [{extension, tool}].
- Surprise: pi-schema unsafe() needs a Record<string, unknown>, not `object`.
- A failed server is recorded in mcp.list() with state "error"; start() never throws. Tests: tests/mcp-http.test.ts (2), in-process HTTP fixture.
- Not covered by a test yet: app-side stdio path end to end (covered by runner-mcp.test.ts only). Live check is 8.5.
- Not yet verified: whether a chat that is already open sees a server added later. Check in 8.4 / 8.5.

## 2026-11-22 goal 8.4: MCP WebSocket messages and browser panel
- WS: mcp-list, mcp-add {name, config}, mcp-remove {name}, mcp-reconnect {name}. Replies {type:"mcp", servers, configErrors}; refusals come back as {type:"error"}.
- configErrors is re-read from mcp.json on every reply, so a bad file shows up right away.
- Browser panel is a <details> block above the chat (public/index.html #mcp, public/app.js showMcp). Text is set with textContent only.
- Tests: tests/mcp-ws.test.ts (5), spawns the real server and an in-process HTTP fixture. Suite 79 passing.
- Not clicked in a real browser yet: TO TEST LATER with the goal 7 key row and the goal 6 question card.
- Pushing failed: no GitHub credentials on this host (git: "could not read Username for 'https://github.com'"). The user authorised pushes (m00748) but credentials are needed. Commits are local only.

## 2026-11-22 goal 8.5: live check on dev (stdio MCP, claude-haiku-5-5)
- Setup: copied tests/fixtures/mcp-echo-server.mjs into the dev workspace volume at /workspace/mcp-live/echo-server.mjs (via `docker run alpine` piping stdin; a bind mount of the repo failed with permission denied under SELinux). Removing it later needs user OK; it is test data only.
- Ran `node scripts/live-mcp-check.mjs` against dev (127.0.0.1:8787): new chat, settings haiku-5-5 / limit 100000 / maxTurns 10, mcp-add echo (command node, args /workspace/mcp-live/echo-server.mjs) → state ready, 3 tools, exposure direct.
- Prompt: echo the text live-check-7731. Result: assistant called mcp__echo__echo, tool-result "live-check-7731", final assistant reply "live-check-7731". errors: none.
- Finding: the chat was opened before the server was added and still used it, so servers added later are visible to existing chats.
- Cost: 2 haiku calls, small input (well under $0.01 estimated). Model: claude-haiku-5-5 only.
- Dev now runs the goal 8 build (docker compose up -d --build, healthz ok).
- Dev mcp.json for the dev data volume now contains the "echo" server; remove it from the UI if unwanted.

## 2026-11-22 goal 8.6: out of scope for the first pass
- OAuth for remote MCP servers (Pi has OAuth fields; not implemented, so remote servers needing login fail with an error).
- Deferred and codemode exposure (only direct and hidden are implemented).
- ${VAR} expansion in headers and env; values are literal.
- Project-level config (only DATA_DIR/mcp.json).
- /login-style sign-in for MCP servers.
- Runner stdio: anyone who can add a server can run its command in the runner (no credentials, workspace volume only).

## 2026-11-22 push to origin (user m00833)
- Pushing now works. The user authorised it and pointed to the key in secrets/github_repo_api_key (mode 600, gitignored). Push used a temporary GIT_ASKPASS script in /tmp that printed the key from that file and was deleted afterwards. The remote URL stays credential-free and the key is not in git or the transcript.
- Command: GIT_ASKPASS=<script> GIT_TERMINAL_PROMPT=0 git push origin HEAD → main 5f550bc..5b9938c.

## 2026-11-22 production deploy d54cb01 (user m00862)
- Backup first (deploy/production/backup/app-data-pre-goal8-2026-11-22-1725.tgz). Then deploy/production/deploy.sh → healthy at 8790, .deployed-commit = d54cb01.
- Post-deploy read-only WS check via a temp script (removed): auth-status → source "secret", mcp-list → 0 servers. No live model call on production.

## 2026-11-22 production network check (user question m00884)
- Networks: edge (bridge, NAT to outside, 172.23.0.0/16) = app; tools (internal:true, 172.22.0.0/16) = app and runner.
- Runner (the bash/read/write tools' container): no route. 192.168.1.1:443, 10.0.0.1, 192.168.10.10:445 and example.com all fail with ENETUNREACH / EAI_AGAIN.
- App container: reaches the LAN and internet. TCP open: 192.168.1.1:443, 192.168.1.30:22 (host sshd), 192.168.10.10:445 (SMB), 172.17.0.1:22. https://example.com returns 200.
- Consequence: the app holds the Anthropic key and makes http MCP connections (StreamableHttpTransport), so an http MCP URL pointing at a LAN device is reachable. Model-driven tool calls run in the runner, which cannot reach the LAN.
- Not changed. Options for the user: (a) put app on tools only and move the Anthropic call out of the LAN-capable network (app still needs internet for api.anthropic.com, so a proxy/allowlist is needed); (b) add an egress firewall rule (DOCKER-USER) to block 192.168.0.0/16, 10.0.0.0/8 and 172.16.0.0/12 from 172.23.0.0/16; (c) keep as is and accept it.

## 2026-11-22 app access to the LAN subnet (user m00898)
- Checked from the app container: already reachable without any change. 192.168.1.x answers on 22/80/443/445 for .1, .2, .10, .20, .30 (other .x silent). 192.168.10.10 and 192.168.20.30 also reachable.
- No config change made. Could not inspect or change host firewall (iptables needs root; no sudo). Runner remains isolated (see network note above).

## 2026-11-22 edit an MCP server (user m00912)
- WS: new mcp-update {name, config}. Refused with "No server named" unless the name is in mcp.json; otherwise mcp.add(name, config, true) (replace) which stops and restarts the server. Name cannot be changed (rename = remove + add).
- mcp reply now includes configs: {name: config} from mcp.json so the browser can pre-fill the form. Includes headers and env (the user's own values, same single-user trust as the rest of mcp.json).
- UI: Edit button per row fills the form; Save changes sends mcp-update, Cancel edit clears. Editing keeps headers/env and other fields; only url/command/args come from the form.
- Test: tests/mcp-ws.test.ts "mcp-update replaces..." (suite 80 passing).
- Not yet clicked in a real browser.

## 2026-11-22 production deploy a329be2 (user m00940)
- Backup taken with the streaming method (bind mount not used). deploy.sh → healthy at 8790, .deployed-commit a329be2. Read-only WS checks only, no model call.

## 2026-11-22 markdown rendering for assistant messages (user m00946)
- Libraries pinned exact: marked 18.2.1, dompurify 3.5.0. Vendored copies in public/vendor/ (marked.esm.js, purify.es.mjs, license files) so the browser needs no CDN or build step. Served through the PUBLIC_FILES allowlist.
- public/markdown-view.js: marked (gfm, breaks) → DOMPurify. Raw HTML stripped; <img> forbidden (an answer must not make the browser fetch arbitrary URLs); links get target=_blank rel=noopener noreferrer. Code blocks get a Copy button.
- Server: .mjs was served as application/octet-stream (browsers refuse that for modules); added text/javascript for .mjs. Covered by tests/static-files.test.ts.
- Verified in a real browser on a static harness (python http.server on 127.0.0.1:8999, copy of public/ files): headings, bold/italic, inline code, list, table, fenced code + Copy, quote, link. Injected onerror and javascript: href were removed; no script ran; no img after the forbid change.
- Not verified on the live app page (no login in tool calls). User messages stay plain text (no markdown), by design.
- Test-harness gotcha: a "</script>" inside a JS string in an inline <script> ends the tag early; escape as <\/script>.
