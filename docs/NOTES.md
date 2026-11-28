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

## 2026-11-22 UI restyle (user m00946, "modern intuitive design language")
- Only CSS changed in public/index.html (same DOM and IDs, app.js untouched). Dark slate tokens, accent #7aa2f7, centred 46rem transcript, right-aligned user bubbles, primary Send, sidebar with active marker, mobile layout under 760px.
- Checked in a static harness (copy of the page styles with sample transcript, python http.server on 127.0.0.1:8999, not the live app: the live page needs the token, which is not put in tool calls). Live browser check still to do.
- 2026-11-22 chat bubbles (user m01081): your messages are right-aligned bubbles, Claude's are left-aligned bubbles (same width rules, role label hidden). Tool lines and reviews stay full width. CSS only. Checked in the static harness.
- 2026-11-22 chat list order (user m01121 corrected m01101): newest first (reverse chronological). Chat ids are assigned in creation order, so sorting by id is chronological. Forks are listed directly under their parent, oldest first. Logic in public/chat-order.js (pure function), tests/chat-order.test.ts (3 tests). Assumes ids are monotonic in storage; if not, the list would need a created-at field.

## 2026-11-22 production deploy 2a08cad (user m01101)
- Backup by streaming tar (bind mount not used). deploy.sh → healthy at 8790, .deployed-commit 2a08cad. Read-only WS checks only.
- 2026-11-22 prod 5185cc3: chat list order corrected to reverse chronological (newest first). Deployed after backup.
- 2026-11-22 questions placement (user m01134): the question cards from the harness now sit below the transcript, just above the composer, not above the transcript. DOM order change only in public/index.html.

## 2026-11-23 Per-chat instructions (step 1 of the per-chat workspace plan, user m01170)
- Each chat has an optional text box ("Chat instructions", src/chat-instructions.ts). It is appended after the base INSTRUCTIONS, never replacing them, so workspace rules always stay in force.
- Stored in <DATA_DIR>/chat-instructions.json, keyed by conversation id (tmp file + rename). Pi Durable's conversation.configure({ instructions }) receives the composed text; the library renders it last, so prompt caching is unaffected.
- A fork copies its parent's text; a new chat starts empty; clearing the box removes the entry.
- Max 8000 characters, checked on the server. Applies from the next request.
- Tests: tests/chat-instructions.test.ts (unit, 5), tests/chat-instructions-ws.test.ts (real server, 4). Suite 95/95 at this commit.
- Not done yet: browser click-through of the box; a live model check (would be one claude-haiku-5-5 call, a few cents at most; not run).

## 2026-11-23 Per-chat folder (step 2, user m01213)
- A new chat may name a folder: one plain name directly under /workspace (src/chat-folder.ts: ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$, no "..", no slashes). Chosen at creation and fixed; no move/rename.
- The folder is created on the runner first (`mkdir -p -- <name>` via RemoteExecutionEnv.exec with cwd /workspace). If that fails, no chat is created. Stored in <DATA_DIR>/chat-folders.json.
- The chat's cwd is set with conversation.configure({ cwd: "/workspace/<name>" }). The env factory in src/harness.ts is now `({ cwd }) => new RemoteExecutionEnv(url, token, cwd ?? "/workspace")`; Pi Durable builds the env per run from the stored agent cwd (harness.js buildEnv).
- Forks inherit the parent's folder. Chats without a folder are unchanged (/workspace).
- Surprise: RemoteExecutionEnv.exec sends no cwd unless one is passed, so the mkdir passes cwd explicitly.
- Tests: tests/chat-folder.test.ts (7: name rules, map round-trip, WS create/refuse/runner-failure/no-folder). Suite 102/102.
- Live check on dev (haiku, default model, 2 short calls, roughly 1 cent): chat in folder "livecheck" ran `pwd` via bash and the reply contained /workspace/livecheck. Shows the cwd reaches the runner's tools.
- Not done: step 3 (read AGENTS.md from the folder), browser click-through of the folder box.
- 2026-11-23 production deploy f3fa285 (user m01213, steps 1+2): backup deploy/production/backup/app-data-pre-step2-2026-11-23.tgz (stream tar, 245 KB). deploy.sh healthy at 8790. Read-only WS check: 3 chats listed, Anthropic key source secret. No chat created on prod, no model call on prod.
- 2026-11-23 push policy (user m01334): ../AGENTS.md now allows pushing to origin main after each tested step without asking (typecheck + test passing, docs committed). Only that remote, no force-push.

## 2026-11-23 Step 3: folder AGENTS.md into chat instructions (user m01344)
- src/agents-md.ts: readFolderAgents reads <folder>/AGENTS.md through the runner (`test -f`, then `head -c 8001`; cwd = the folder). Missing file = nothing loaded; runner failure or file over 8000 characters = error, nothing copied (no truncation).
- Copy, not link: the text goes into the chat's instructions box as one block headed "--- AGENTS.md from this chat's folder ---". The person sees and can edit exactly what the model gets. Nothing is read again unless asked.
- When: at creation of a chat in a folder (read before the chat exists, so a refusal leaves no chat), and on demand: "Load AGENTS.md from folder" button (enabled only in chats with a folder) sends {type:"load-agents"}. Load keeps the person's own text and replaces an earlier block.
- Reason for an explicit button: a file in the workspace can be changed by the model itself, so reloading is always a person's choice.
- Test change: tests/chat-folder.test.ts runner stub now answers test/head. The "new with folder" test checks runnerCalls[0] (mkdir) instead of the last call, since the AGENTS.md probe follows it.
- Tests: 108/108 (5 new WS/merge tests in chat-folder.test.ts).
- Dev live check (no model call): folder with 2-line AGENTS.md, new chat, open message carried the block exactly. Test folder removed from the dev workspace afterwards.
- Prod NOT redeployed for step 3 (AGENTS.md: prod changes need the user's request).
- 2026-11-23 production deploy 0a61619 (user m01391, step 3). Backup deploy/production/backup/app-data-pre-step3-2026-11-23.tgz (98 KB, stream tar). deploy.sh healthy at 8790; healthz ok; read-only WS list answered (4 titled chats in chats.json, same titles as the backup). No chat created, no model call, no folder changed on prod.

## 2026-11-23 Sidebar grouped by folder (user m01407)
- chat-order.js groupByFolder(chats): one group per folder, folders by newest chat id, no-folder chats last. Forks stay under their parent in the same group (orderChats).
- chatList (src/server.ts) now sends folder ("" = none) with each chat.
- public/app.js renderChats: folder header button ("▾ name" / "▸ name", aria-expanded), click collapses/expands. Collapsed set in localStorage key pdw-collapsed-folders (this browser only). Opening a chat in a collapsed folder expands it.
- Tests: 3 new groupByFolder tests in tests/chat-order.test.ts. Suite 111/111.
- Not browser-checked: needs sign-in by the user (token is not put in tool calls).
- 2026-11-23 production deploy 06da1bc (user m01441, sidebar grouped by folder). Backup deploy/production/backup/app-data-pre-sidebar-2026-11-23.tgz (709 KB). deploy.sh healthy at 8790; healthz ok; prod serves the new app.js (groupByFolder present). No chat or folder changed on prod; no model call.
- 2026-11-23 user decisions (m01458): life-manager prompt dropped; goal 5.2 (second user check) parked for later. Goals 1-3 confirmed done per docs/PLAN.md. Browser check of the folder sidebar, instructions box and Load AGENTS.md passed (user m01450). "Save to folder AGENTS.md" button declined (m01450), not built.

## 2026-11-23 No autofill history for the chat box (user m01463)
- public/index.html: #msg, form #f and #instrtext get autocomplete="off" (plus data-form-type="other" and data-lpignore="true" for password managers). #msg has no name attribute, since browsers key autofill history on it.
- Browsers may still keep history for fields they consider "address-like"; autocomplete="off" is the standard request, and Chrome/Firefox generally honour it for typed-text history. Not verified in a browser (needs sign-in); check after the next visit.
- Tests: tests/autofill-off.test.ts (3). Suite 114/114.
- 2026-11-23 production deploy c190f7c (user m01477, autofill off). Backup deploy/production/backup/app-data-pre-autofill-2026-11-23.tgz (206 KB). deploy.sh healthy at 8790; healthz ok; prod serves the new index.html. No model call, no chat changed.

## 2026-11-23 "+" on each workspace in the sidebar (user m01483)
- public/app.js renderChats: each folder header is now a row (.folder-row) with the toggle button and a "+" button (.folder-plus, title "New chat in /workspace/<folder>"). "+" sends {type:"new", folder} — the same path as the new-chat form, so it runs mkdir -p (idempotent for an existing folder) and reads the folder's AGENTS.md into the new chat's instructions.
- Button is not nested in the toggle button (invalid HTML).
- Suite 114/114. Not browser-checked (needs sign-in).
- 2026-11-23 production deploy 8fb7f51 (user m01493, "+" per workspace). Backup deploy/production/backup/app-data-pre-plus-2026-11-23.tgz (206 KB). deploy.sh healthy at 8790; healthz ok; prod serves the new app.js. No model call, no chat changed.

## 2026-11-23 AGENTS.md, long workflows and compaction (user m01499, answered by reading pi-durable 1.6.0)
- A chat's instructions are stored in its agent state (pi.agent), not in the transcript. dist/harness/agent.js:253-256 renders them each request as the reserved section "instructions" (after all other sections).
- Compaction summarizes transcript messages only (compaction.js summarizedMessages; system messages are omitted from the summarizer prompt). So the instructions are never summarized away and survive compaction, reset-free. Cost: they use context on every request (max 8000 chars, roughly 2k tokens).
- Compaction focus can be given with compact(instructions) (README "Compaction"), but the app does not pass AGENTS text there; the summarizer does not see it.
- Our AGENTS copy is taken at creation or on "Load AGENTS.md"; later edits to the folder file (including by the model) do not reach the chat until reloaded.

## 2026-11-23 Settings pages (user m01522)
- Global settings (model, compact limit, max rounds, Anthropic key, MCP) moved into a <dialog> behind a "Settings" button in #top. Element ids unchanged, so the existing JS is untouched.
- Workspace settings live in a <dialog> opened by a gear button on each folder row, next to "+". Chosen over a page (no router in the app) and over a sidebar pane (keeps the chat view the same).
- Workspace instructions are stored per folder in <DATA_DIR>/workspace-instructions.json, not per chat, so one edit covers every chat in the folder. They go first; the chat's own text follows. Reason: the workspace rules should be the base, and a chat can add to them.
- Saving or loading AGENTS.md at workspace level re-applies the instructions to every chat in that folder (applyFolder), so the change takes effect from the next request without reopening chats.
- Overlap: chat "Load AGENTS.md" (step 3) and workspace "Load AGENTS.md" both copy the same block. Each box keeps one copy, but a chat with both gets the file's text twice. Left as is; the chat box shows exactly what is sent.
- workspace-get/save/load only accept a folder that some chat uses. Reason: avoids creating settings for arbitrary names; folder names are already checked by checkFolderName.
- Test: tests/workspace-settings.test.ts (8: combine order, storage, limit, WS get/save/clear/too-long/load/no-file). Browser check not done by the agent (needs user sign-in; token not used in tool calls).
- 2026-11-23 production deploy 908b2df (user m01536). Backup deploy/production/backup/app-data-pre-settings-2026-11-23.tgz (279 KB). deploy.sh healthy at 8790; healthz ok; prod serves the new index.html. No model call, no chat changed.

## 2026-11-23 Workspace defaults (fc4efe4)
- Decision: folder defaults apply LIVE to all chats in the folder, not only to chats created afterwards. The request said "new chat"; live was chosen because a stale per-chat copy would make the dialog lie. Flag to user.
- Decision: folder config is a separate file (workspace-config.json), not inside workspace-instructions.json, to keep the instructions format unchanged.
- Decision: a folder combination that does not fit its model is refused on save, and at runtime falls back to global with a warning (a global model change can make an older folder setting invalid).
- MCP off per folder: applyChat passes disabledMcp; harness applySettings sends extensions {remove: [defineExtension({name:"mcp:<n>", tools:[]})]}, or null when none are off. configure accepts it; that the model's tool list drops the server is NOT verified live.
- Test lesson: the runner stub returned exitCode 1 for every exec, so the folder mkdir failed and "open" never arrived. Fixed in tests/workspace-config.test.ts (mkdir succeeds, AGENTS.md probe fails).
- Overlap: chat "Load AGENTS.md" and workspace "Load AGENTS.md" insert the same block; the text keeps one copy per source, so a chat can hold it twice. Known, documented.
- 2026-11-23 prod deploy e30c0b7 (workspace defaults). Backup deploy/production/backup/app-data-pre-workspace-defaults-2026-11-23.tgz (226 KB). healthz ok at 8790; served index.html/app.js contain the new dialog. No chat changed on prod; no model call.
- 2026-11-23 goal 9 (user m01778, option 1): single source for workspace rules. A folder's rules are its AGENTS.md file. Removed: the workspace-instructions store (src/workspace-settings.ts), the workspace instructions box, both "Load AGENTS.md" copy buttons, and the load-agents / workspace-get / workspace-save / workspace-load-agents messages. Reason: two stores drifted; copies went stale and a chat could hold the block twice.
- Decision: the model reads AGENTS.md before each user submit in a folder (src/folder-rules.ts FolderRules.refresh, src/server.ts submit path). Chosen over reading on change only, because pi-durable takes instructions as a plain string set with configure and cannot read a file itself. Cost: two runner exec calls per submit in a folder (test -f, head -c 8001). A runner failure keeps the last text read.
- Decision: the chat's own note is no longer merged into AGENTS.md; the model gets the folder rules, then the chat note, under composeInstructions' heading (src/chat-instructions.ts). Old AGENTS copies in chat-instructions.json are stripped at startup (stripLegacyBlock, marker AGENTS_HEADER).
- Migration: legacy workspace-instructions.json text moves into the folder's AGENTS.md on first use when no AGENTS.md exists (one time; kept if the write fails; forgotten after success). An existing AGENTS.md wins over legacy text.
- Test replacement (reason): tests/workspace-settings.test.ts tested the removed store and copy flow, so it was deleted. Its coverage is replaced by tests/folder-rules.test.ts (combine, strip, refresh, edit, delete, runner failure, legacy migration, server WS path). Copy tests in tests/chat-folder.test.ts replaced by tests for rules reaching the model and the 8000 limit. Suite 135/135.
- Test lesson: the runner exec body is {command, options:{cwd,...}}, not {cmd, cwd}. Stubs must read parsed.command and parsed.options.cwd.
- Test lesson: agent.instructions (conv.agent(context)) includes the base INSTRUCTIONS prompt, so tests match the folder rules with a regex, not equality.
- 2026-11-23 prod deploy a1c0cf6 (goal 9: single-source AGENTS.md). Backup deploy/production/backup/app-data-pre-goal9-2026-11-23.tgz (226 KB, taken with docker run alpine tar of pi-durable-prod_app-data). deploy.sh healthy at 8790; healthz ok; served index.html and server.ts contain the new code. No model call, no chat changed.
- Bug (user report): workspace dialog showed "unknown message" and MCP list stuck on Loading. Cause: goal 9 (3090ef5) removed the server's workspace-get handler, but public/app.js still sends it. Fix: restored workspace-get as read-only (replies "workspace" with config, effective values, MCP list; no rules text). Test: tests/folder-rules.test.ts "the workspace dialog gets its config and MCP list". Suite 136/136.
- 2026-11-23 prod redeployed to 83d5fa7 (workspace-get fix). Backup deploy/production/backup/app-data-pre-workspace-get-fix-2026-11-23.tgz (backup dir root-owned write failed; written via stdout redirect).
- Goal 10 decisions (user approved m02035): model name pi/<folder> picks the workspace; separate HA API key stored as SHA-256 hash in DATA_DIR/api-keys.json (0600), shown once; voice chats get no runner tools by default (voiceTools off).
- 10.1 done: src/api-keys.ts (create/revoke/find/bearer), tests/api-keys.test.ts. Suite 139/139.
- LAN exposure (user m02061 "Let's open it to LAN"): production (8790) now published on the main LAN address 192.168.1.30 only, not 0.0.0.0 (as DESIGN.md recommends). Dev (8787) stays 127.0.0.1. Login token, lockout and API keys still apply. Risk: plain HTTP, so token and API keys cross the LAN in clear. Mitigation later: HTTPS proxy (SECURE_COOKIES=1). No firewall rule was added; check the host firewall if the LAN can't reach it.

## 2026-11-24 Goal 10: Home Assistant voice (Assist)
- Voice key panel in global settings: create (shown once), list without hashes, revoke. Folder checkbox "voice tools" default off (c1f45fb). Tests: tests/voice-keys-ws.test.ts (5). Test fix: create sends a trailing api-keys reply that must be consumed (waitFor helper), otherwise later replies are stale.
- Full suite before the commit: 154/154 (npm run typecheck && npm test).
- Dev deployed (docker compose up -d --build): healthz ok, served app.js contains the panel. Browser sign-in check of the panel still needed from user.
- User checks (reported): HA subentry verified (base URL http://192.168.1.30:8790/v1, model pi/lifemanager); test conversation in Assist done. Results not recorded in detail here.
- Docs: docs/HOME-ASSISTANT.md written (endpoint, auth, pi/<folder> models, voice tools default off, 400/401/404/409 table, HA setup, LAN HTTP caveat).
- Still open for goal 10: one live claude-haiku-5-5 check at context <=100000, cost logged here; then STATE/PLAN update.
- LIVE CHECK 2026-11-24 (goal 10.6): one POST /v1/chat/completions on dev (127.0.0.1:8787), model pi/livecheck (folder "livecheck", no voice tools), model claude-haiku-5-5 from global settings, contextLimit 100000. Prompt: "In one short sentence, what is 17 times 3?" Reply "17 times 3 is 51.", HTTP 200, 674 ms. Cost: roughly 0.1 cent or less (one tiny Haiku turn; the API response has no usage field, so exact tokens unknown). A temporary key was created via WS and revoked; the revoked key returned 401.
- PROD DEPLOY 2026-11-24 (commit 3ade10a, includes voice key panel and folder voice switch). Backup before deploy: deploy/production/backup/app-data-pre-panel-2026-11-24.tgz (taken with docker run tar to stdout; direct write into backup/ failed with Permission denied). Verified: /healthz ok; /v1/models with the existing HA key 200; without key 401; served app.js has the panel. The HA key was not changed.
- Browser sign-in check of the panel on dev: user reported complete (m02353).
- CLEANUP 2026-11-24 (user m02381: test data may be deleted if I see fit): removed empty dev runner dir /workspace/livecheck. Kept /workspace/mcp-live/echo-server.mjs because dev /data/mcp.json still registers it as the "echo" MCP server; removing it means editing that config. Kept the dev workspace life_manager_questionnaire.md (not clearly test data). Test folders "livecheck" and "agentscheck" and chats in app-data were not deleted (app data; needs a deliberate in-app delete).
- CLEANUP 2026-11-24: user (m02394) approved deleting dev /workspace/life_manager_questionnaire.md; deleted.

## Goal 11 keep-going (2026-11-25)
- Decisions (user m02407/m02421): work until done; per chat; stop marker DONE as the last line; default cap 5 continues per user request, hard max 20; continuation text carries the marker "[Keep going]" so continues can be counted (countContinues) and skipped by the review hook.
- Docs (Pi Durable README) give no recommendation on when to stop; the only rule is that a continuing extension must bound its own loop (run.turns resets per continue).
- 11.2 done: src/keep-going.ts (pure: endsWithDone, decideKeepGoing, countContinues, clampMaxContinues). tests/keep-going.test.ts, 8 tests. Suite 162/162.
- 11.3 done (2026-11-25): src/keep-going-hook.ts (KeepGoingSettings per chat in settings.json "keepGoing"; keepGoingYield; KeepGoingStopTask writes kind "keep-going-stop" with reason; keepGoingExtension onYield). Wired in src/harness.ts (extension install, applySettings keepGoing option appends KEEP_GOING_PROMPT) and src/server.ts (applyChat keepGoing flag; WS "keepgoing" message). Tests tests/keep-going-hook.test.ts. Suite 165/165. Not yet tested end to end with a live model or a faux provider (11.5). Stop note render is 11.4.
- 11.4 done (2026-11-25): public/keep-going-view.js (keepGoingLine for kind "keep-going-stop", isKeepGoingContinuation hides "[Keep going]" messages); app.js shows the stop note as a plain line and wires the "Keep going" checkbox + rounds select (WS "keepgoing"); index.html #keepgoing and #keepmax in #actions; server sends keepGoing state on view. Tests tests/keep-going-view.test.ts. Suite 167/167 on two reruns.
- FLAKY (observed once, 2026-11-25): the first full npm test run had 1 failure (pass 166 / fail 1); the failing test name was not captured in the log. Reruns passed 3/3. Investigate if it recurs: rerun with `npm test > /tmp/t.log 2>&1; grep -n "not ok" /tmp/t.log`.
- 11.5 live check (2026-11-25, dev app, claude-haiku-5-5, contextLimit 100000, maxTurns 20, keep-going on, maxContinues 1). scripts/live-keep-going.mjs. Run 1 (poem, asks for DONE): order user > assistant (ends "DONE") > keep-going-stop; no continue. Run 2 (KG_PROMPT "Reply with the single word hello. Never write DONE."): assistant "hello" > user "[Keep going] ..." > assistant > keep-going-stop {reason:"cap"}. Confirms continue, count and cap. Cost: 4 Haiku calls, well under 1 cent.
- Observation: scripts/live-chat-review.mjs uses reviewerModel claude-sonnet-5-5, which breaks the Haiku-only rule for live calls. Not changed here; keep it in mind before running it again.
- 11.6 docs: README "Keep going" section. Dev rebuilt at dba2fda (healthz ok). Prod NOT deployed (needs user go-ahead).
- Goal 11 done pending the "Done" check: tests 167/167, typecheck clean, committed.
- 2026-11-25 web search (goal 12). Decision: run pi-web-access as a built-in MCP server "web" INSIDE THE APP process, not the runner. Reason: app already has internet; runner has no internet by default and docs/REVIEW-2026-11-22.md item 23 warns against runner egress with an unauthenticated shell.
- Pinned pi-web-access 0.48.0 exact with `npm install --save-exact --omit=peer`. Its peer deps (pi-ai, pi-coding-agent, pi-tui, typebox) are not needed for MCP mode. Lockfile grew ~3100 lines (MCP SDK, defuddle, linkedom, turndown, undici, unpdf). npm printed install-script warnings for esbuild, protobufjs, @google/genai; scripts were not run (Dockerfile uses --ignore-scripts).
- Built-in env is explicit and minimal: PATH, HOME, PI_CODING_AGENT_DIR and PI_WEB_ACCESS_CACHE_ROOT, all under DATA_DIR/web-access. No API key is passed. Optional web-search.json and provider keys go in DATA_DIR/web-access (never printed or committed).
- The name "web" is reserved: mcp.json entries with that name are reported as errors, and add/remove refuse it. Per-chat disabledMcp and voice-chat disabling use the normal server name.
- Smoke test (outside repo): MCP server listed web_search, fetch_content, get_search_content, source_check; web_search with the keyless exa provider returned Node.js results.
- Not covered: Pi-only features (curator and summaries, Kimi, ChatGPT-signin OpenAI search, fetch_content answer/extract modes, video). Per the package README these return tool errors in MCP mode.
- 12.5 dev deploy (2026-11-25): docker compose up -d --build; /healthz ok; /app/node_modules/pi-web-access/dist/mcp-cli.js present in app image; mcp-list shows web builtin ready, 4 tools.
- 12.5 live check: scripts/live-web-search.mjs, claude-haiku-5-5, contextLimit 100000, maxTurns 6. Order: user > system > assistant (tool call) > tool-result > assistant; final answer cited nodejs.org URLs. Cost: 2 Haiku calls, about 5k tokens, well under 1 cent.
- 2026-11-25 runner LAN access (user request m02731): added compose.lan.yaml (runner also on a plain bridge network "lan"). Dev deployed with `docker compose -f compose.yaml -f compose.lan.yaml up -d --build`; healthz ok. Verified from the runner: 192.168.1.1:443 open, 192.168.1.30:22 (host sshd) open, 192.168.10.10:445 open, example.com:443 open. Compose cannot restrict to LAN only; that needs a host firewall rule (sudo, not set up). Risk accepted by user: the agent can reach LAN devices and host services. Prod NOT changed; deploy needs the user's go-ahead and should use the same override file in deploy/production (not yet added).
- 2026-11-25 prod runner LAN access: added lan network to deploy/production/compose.yaml (runner [tools, lan]) and deployed 0c8be08. Verified runner reaches 192.168.1.1:443; healthz ok. Same accepted risk as dev.
- 2026-11-25 Workspace dialog: Save button was below the fold (dialog max-height 88vh, AGENTS.md save at bottom). Added sticky footer with Save (requestSubmit both forms) and Close in public/index.html + public/app.js. Verified by rendering a copy of the dialog in agent-browser (file://), not via live login (no token in tool calls). Deployed with docker compose up -d --build.
- 2026-11-25 Pushed origin main to 25a3c24 (workspace save footer; no token recorded).
- 2026-11-25 prod deploy fc79f24 (workspace save footer, user m02xxx 'Update my prod'). Backup deploy/production/backup/app-data-pre-workspace-save-2026-11-25-1018.tgz (1.1 MB, docker run alpine tar). deploy.sh healthy at 8790; healthz ok. Served app.js/index.html check: static files need login, so verified inside container instead.
- 2026-11-28 Dockhand draft: deploy/dockhand/compose.yaml (single file, not deployed). Dockhand deploys only the compose text, so: build from git URL (needs the repo pushed and readable by Docker), secrets as absolute host paths, no ./ files. Validated with `docker compose -f deploy/dockhand/compose.yaml config -q`. Open decisions: it currently reuses prod's secrets and port 192.168.1.30:8790 (would clash with prod), and its volume names differ from prod's (data would not carry over). Dockhand facts (web, Finsys/dockhand docs): stacks with relative paths need matching host paths (DATA_DIR); Git stacks support compose files from a repo. The app reads secrets only from *_FILE paths (src/config.ts), so no env-var secret option exists.
- 2026-11-28 Dockhand secret paths: deploy/dockhand/compose.yaml now uses `file: ${SECRETS_DIR:-./secrets}/<name>` (was a hard-coded /var/home/angel path, which broke on TrueNAS). Dockhand bind-mounts secrets from the daemon's host filesystem, so SECRETS_DIR must be an absolute host path there. Verified with `SECRETS_DIR=<tmp> docker compose -f deploy/dockhand/compose.yaml config`. Not deployed.
- 2026-11-28 App on LAN by default: compose.yaml publishes `${APP_BIND:-0.0.0.0}:8787:8787` (was 127.0.0.1). Reason: user asked for LAN access by default. Trade-off: listens on every host interface (this host has 192.168.1.30, .10.30, .20.30), plain HTTP, token login. README and SECURITY updated; APP_BIND=127.0.0.1 restores local-only. Verified: `docker compose up -d --build`, healthz ok on 127.0.0.1 and 192.168.1.30:8787; ss shows 0.0.0.0:8787. Tests and typecheck pass. Prod (8790 on 192.168.1.30) unchanged.
- 2026-11-28 Uploads: POST /upload (app, login cookie) with ?folder=<name> (must be a known workspace) or ?chat=<id> (chat folder, or /workspace/uploads when the chat has none). The app picks the safe name (src/uploads.ts) and forwards raw bytes to the runner's new POST /v1/upload (bearer runner token, x-upload-path must be inside /workspace). Runner writes with flag wx, so it never overwrites: clashes get -2, -3 up to 50. Limit 15 MB (app) and 16 MiB body cap (runner). Reason: the runner's writeFile route is text only, so binary files needed a new route. Tests: tests/upload.test.ts (10 tests, real app + fixture runner). Full suite 180 pass. Dev redeployed; live check: chat=1 upload landed at /workspace/uploads/hello.txt; test file removed afterwards.
- 2026-11-28 Update instructions added: README "Updating an install" and docs/PRODUCTION.md "Updating production (checklist)".
- 2026-11-28 Pushed origin main c46a261..0b74438 (uploads + update docs). Token via temporary askpass, script deleted.
- 2026-11-28 Prod deployed 23c1db1 (uploads + update docs). Backup deploy/production/backup/app-data-pre-uploads-2026-11-28-0247.tgz (git-ignored, 1.6 MB). Checks: deploy.sh healthy; healthz ok; containers up; login ok; upload probe returned 200 and the probe file was deleted afterwards.
- 2026-11-28 Folder upload: the browser sends each file with x-relative-path (encoded), one request per file, up to 2000 files per pick. The app keeps the folder structure under the target and refuses "", ".", "..", empty parts and more than 8 levels (sanitizeRelativePath in src/uploads.ts). Reason: no runner change needed, since the runner already creates folders and refuses clashes (wx). Known loss: sanitizeUploadName drops leading dots, so ".github" becomes "github"; documented in README, not changed. Tests: tests/upload.test.ts (now 183 pass in total). UI picker not yet checked in a browser.
- 2026-11-28 Pushed origin main d6833fa..c300f8b (folder upload). Token via temporary askpass, script deleted.
- 2026-11-28 Folder limit: replaced the 2000-file cap (app.js MAX_FOLDER_FILES, a guess) with a 2 GB total-size cap (MAX_FOLDER_BYTES). Reason: the real cost is bytes and time, not count. Added Cancel upload (class uploadcancel, shown while a folder uploads; stops after the current file, reports how many were not sent). Browser module scripts can't use inline onclick, so buttons are bound in app.js. The size cap is client-side only; the server still enforces 15 MB per file. Open idea, not done: skip files already saved with the same size on retry (would make resume possible without -2 copies).

- 2026-11-28 Staged folder upload (user answers m00509: hidden dot-dir, rename on clash, folders only, 24 h sweep). Folder files go to `<target>/.staging/<id>/<top>` via `x-staging-id`; `/upload/commit` makes the runner rename the folder into place (`mkdir` reservation then `rename`, so a taken name gets -2, never a merge). Cancel or any failed file runs `/upload/cancel` (runner `rm -rf`). Reason: a partial folder must never be visible to the model. Staging sits inside the target because `rename` across the runner's /tmp would fail (EXDEV); the workspace is one volume. Surprise: the first version put staging at the workspace root, but the commit then needs `dirname` checks per folder; fixed by keeping staging inside each target folder. Surprise: `fetch` follows the 302 to /login, so a no-cookie GET test saw 200; the test now POSTs and expects 401.
- 2026-11-28 Runner typecheck: the root tsconfig covers only `src`, so the runner is checked with `npx tsc --ignoreConfig --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --esModuleInterop --types node runner/server.ts runner/staging.ts`.
- 2026-11-28 Pushed origin main 86ebfe8..7ea571c (staged folder upload, commit 7ea571c). Token via temporary askpass, script deleted.
- 2026-11-28 Removed the client-side pre-check that refused a folder containing any file over 15 MB before uploading (user request). The server limit of 15 MB per file still applies (UPLOAD_MAX_BYTES, runner 16 MiB body cap), so an oversized file now fails mid-folder and the staged folder is discarded. The 2 GB total cap is unchanged. Open question: raise the per-file server limit?
- 2026-11-28 Pushed origin main 7ea571c..f73e809 (remove folder 15 MB pre-check). Token via temporary askpass, script deleted.
- 2026-11-28 Runner image now installs git (apt, git + ca-certificates, --no-install-recommends) in the runner stage of Dockerfile. Verified in the dev runner: git 2.39.5. Internal-only networks still block outbound access by default; git clone needs compose.internet.yaml or compose.lan.yaml.
- 2026-11-28 Design decided (user m00702, m00705): app-only approval-gated push to main with bundle review page; encrypted secret store in app-data with GUI (write-only, re-auth, audit). LAN-only app. Written to docs/DESIGN.md section "Plan: approval-gated push and GUI secrets". No code yet.
- 2026-11-28 Secret store (step S1) built per docs/DESIGN.md. Files: src/secret-store.ts, src/server.ts (secrets-* WS messages), public/index.html + app.js (Secrets panel), compose.yaml (master_key secret, MASTER_KEY_FILE), scripts/setup-secrets.sh (creates secrets/master_key). Store is off when the master key file is absent; compose itself fails to start if ./secrets/master_key does not exist, so run scripts/setup-secrets.sh first on any host.
- 2026-11-28 Surprise: the new secrets/master_key was created outside the setup script, so it lacked the SELinux label container_file_t and the app crashed with EACCES on /run/secrets/master_key. Fix: chcon -t container_file_t (the script does this for secrets/* on each run). Recorded so prod bootstrap runs the chcon step.
- 2026-11-28 Decision: re-authentication is per WebSocket connection (a new page load starts locked). The app token check reuses tokenMatches (timing-safe). No separate lockout on secrets-reauth; the token is 32+ random characters, and LAN-only access is the user's stated setup (user m00705).
- 2026-11-28 Live test on dev (no model call, cost 0): WS secrets-list, refused set, reauth, set probe secret, remove. Secret file had no plaintext; audit log had 4 lines, no values. Probe secret removed afterwards.
- 2026-11-28 Test count: npm test 214 pass = 196 before + 10 in tests/secret-store.test.ts + 8 in tests/secrets-ws.test.ts.
- 2026-11-28 Pushed origin main e059bf4..d027b33 (secret store, step S1). Token via temporary askpass, script deleted.
- 2026-11-28 Runner internet access is now the default (user m00826 "make it the default"). compose.yaml: runner networks [tools, egress]; tools still internal; compose.internet.yaml is a no-op kept for old commands. Reverses the 2026-11-22 review item 23 advice (docs/REVIEW-2026-11-22.md, egress off by default + allowlist proxy); user overrode it, risk recorded in SECURITY.md and DESIGN.md. Verified on dev: runner reaches api.anthropic.com (HTTP 404 = reachable); docker compose config OK with and without the override. Not changed: deploy/production/compose.yaml and deploy/dockhand/compose.yaml keep tools-internal (prod runner already gets LAN and internet via its own override, docs/PRODUCTION.md line 89); decide when prod is next deployed.
- 2026-11-28 Pushed origin main d027b33..a7dda72 (S1 secret store, runner internet default). Token via temporary askpass, script deleted.

## Production deployment history

Moved here from docs/PRODUCTION.md when the runbook was rewritten as generic steps. Facts are unchanged.

### Initial setup
- `deploy/production/secrets/{anthropic_api_key,app_token,runner_token}`, mode 600. The Anthropic key was copied from
  dev; the app token and runner token were generated new.
- `deploy/production/.env` with `HOST_UID` and `HOST_GID` (the containers run as this uid).
- SELinux (Enforcing on this host): secrets must carry `container_file_t`. `deploy.sh` does this. Without it the runner
  fails with `EACCES: permission denied, open '/run/secrets/runner_token'`.
- Chat data is in `pi-durable-prod_app-data` (SQLite). Earlier, `-v "$PWD/...:/backup"` bind mounts failed with
  Permission denied on this host (SELinux), so backups stream to a host file.

### Browser-entered key and MCP servers (live since d54cb01)
- Anthropic key: a key saved in the browser is stored in the app-data volume at credentials.json (mode 600, plaintext).
  It wins over the Docker secret. Decision and reasoning: see the goal 7 entry earlier in this file.
- MCP servers: DATA_DIR/mcp.json in the app-data volume. Local programs run inside the runner (no credentials).

### Deployment log
- 2026-11-22: production created on port 8790, from commit 2d95ba3 (ask_user feature included). Login verified (correct
  token 200, wrong 401). Model claude-haiku-5-5.
- 2026-11-22: production updated fb098e2 → d54cb01 (goal 7 browser key, goal 8 MCP servers, docs). Pre-deploy backup:
  deploy/production/backup/app-data-pre-goal8-2026-11-22-1725.tgz (ignored by git). Checks: healthz ok, all containers
  up, auth-status source "secret", mcp-list 0 servers, chats kept.
- 2026-11-22: production updated d54cb01 → a329be2 (edit an MCP server). Backup first:
  deploy/production/backup/app-data-pre-edit-2026-11-22-1738.tgz (ignored by git). Checks: healthz ok, WS auth-status and
  mcp-list answer.
- 2026-11-22: production updated a329be2 → 2a08cad (markdown, UI restyle, chat bubbles, chronological chat list). Backup
  first: deploy/production/backup/app-data-pre-chatorder-2026-11-22-1755.tgz (git-ignored). Checks: healthz ok, WS
  auth-status and mcp-list answer. No model call.
- 2026-11-22: production updated 2a08cad → 5185cc3 (chat list newest first, per user m01121). Backup:
  deploy/production/backup/app-data-pre-chatorder-rev-2026-11-22-*.tgz (git-ignored). healthz ok.
- 2026-11-25: production updated 3ade10a → 72bb123 (keep-going loop, per-chat, off by default; browser toggle; README
  section). Backup first: deploy/production/backup/app-data-pre-keepgoing-2026-11-25-0024.tgz (git-ignored). Checks:
  healthz ok, both containers healthy, .deployed-commit 72bb123. No model call; prod chats untouched.
- 2026-11-25: production updated 72bb123 → 5c6bd6d (web search: pi-web-access built-in MCP server "web" in the app).
  Backup first: deploy/production/backup/app-data-pre-websearch-2026-11-25-0051.tgz (git-ignored). Checks: healthz ok,
  both containers healthy, pi-web-access present in app image. No model call.
- 2026-11-25: production updated 5c6bd6d → 0c8be08 (runner joins a normal "lan" network so it can reach the LAN; user
  approved m02742). Backup first: deploy/production/backup/app-data-pre-lan-2026-11-25-0104.tgz (git-ignored). Checks:
  healthz ok at 192.168.1.30:8790; runner on pi-durable-prod_lan and _tools; runner reaches 192.168.1.1:443. No model
  call. Note: production runner now has LAN and internet access; no host firewall rule limits it.
- 2026-11-28 Documentation rewritten for new users (user m00855): README restructured (quick start, using the app, configuration, networking, secrets, updating, development), docs/README.md index added, DESIGN/PRODUCTION/SECURITY/HOME-ASSISTANT cleaned of dates and change history. Dated production deploy log moved to the "Production deployment history" section below. Open: no automated test currently covers steer (PLAN 2.1 says one exists; grep of tests/ finds none). Docs are checked against code; claims not re-verified: the deploy script behaviour in PRODUCTION.md.
- 2026-11-28 S2: Anthropic key moved into the encrypted store. Design: LayeredCredentialStore (src/credentials.ts) wraps FileCredentialStore; for provider "anthropic" with a store, read prefers store entry "anthropic_api_key", save writes the store and deletes the plaintext copy in credentials.json, clear removes both. Other providers and hosts without master_key unchanged. Generic secrets panel hides and refuses the reserved name. Auth set/clear write audit lines (no values).
Tests: tests/anthropic-store.test.ts (6, new), tests/secrets-ws.test.ts (+3). Full suite 223 pass.
- 2026-11-28 S2 dev check: docker compose up -d --build OK, healthz ok, app listening with master_key present; live WS auth-status returned {"source":"secret"} (Docker secret fallback). Browser save on dev NOT exercised live (covered by tests/secrets-ws.test.ts against a spawned server). Live test cost: none (no model call).
- 2026-11-28 Per-file upload limit removed (user m00992 "C"). Reason: the 15 MB cap was a guess and the app could not stream the body while also retrying names. Now: app streams the request to the runner with x-upload-path and x-upload-tries; the runner writes a hidden .upload-<hex> temp file, hard-links it to the first free name (name, -2, -3 ...), then removes the temp. Nothing is buffered in app or runner, so there is no size cap; the disk is the limit. Trade-off: hard links need the temp and target on the same filesystem (they are, same folder). Staged uploads still use one try. Tests: tests/upload.test.ts (fixture mirrors runner naming), tests/runner-http.test.ts (real runner: 20 MB upload, clash, 409, temp cleanup, bad tries). Suite 226 pass. Live check on dev (2026-11-28): 20 MB POST /upload?chat=1 returned 200; runner file is 20971520 bytes; no .upload-* temp left; test file removed afterwards. Cost: none (no model call).
- 2026-11-28 Pushed origin main for the upload-limit change (commit range is in git log). Token via temporary askpass, script deleted.
- 2026-11-28 Steer timing (PLAN 2.1 was ticked without a test; now tests/steer.test.ts). Steer = submit with whenBusy "steer" (src/server.ts maps it; anything else is follow-up). Verified with a faux model and a run parked in ask_user: the steer is in pi.inbox while the tool step runs, no answer appears before the step ends, the steer is recorded in the transcript BEFORE the answer it shapes, and it leaves the inbox. A mutant with followUp fails the ordering assertion. Pi Durable README (Busy Conversations): "Steers are placed after the current tool round and join the running work." Tooltip (public/index.html, #steer) says the same. Cost: none (faux provider, no live call).
- 2026-11-28 S3 approval-gated push (user m01130 "Start S3"). Built: runner POST /v1/git/bundle (main only, bundle of refs/heads/main from /workspace, no credentials); app src/git-push.ts (GitPushService: propose = fetch bundle, verify, list commits and files, store; push = re-check fast-forward against live origin, then `git push origin <tip>:refs/heads/main`, no force); src/push-approval.ts (model tool git_push, parks on PushDecisionSignal); server WS push-decide; browser card in public/app.js (push-view.js pure helpers).
- Deviation from DESIGN.md: approval is a card in the chat (same parked-tool path as ask_user), not a separate page. Reason: reuses the signal path that already works; the card lists the same commits and files.
- Non-ff is refused at proposal time (no card offered), and again at push time if origin moved.
- Token: secret store name github_repo_token, entered in Secrets (no Docker secret). GIT_REMOTE_URL is unset by default, so nothing can push until it is set on purpose. Token only in git's per-command env (http.<origin>/.extraheader), never in argv, a file, or the log; clean() redacts it from errors.
- Mirror lives at dataDir/git-mirror.git, never the workspace. Bundles are removed after propose or push.
- Tests: tests/git-policy.test.ts, tests/git-push.test.ts (real bare origin), tests/push-approval.test.ts (faux model, approve and reject), tests/runner-http.test.ts bundle case. Test bugs fixed on the way: bundle inspection must run inside a repo (bundle verify refuses outside one); runner bundles the workspace root, so the test repo is the workspace; header slice was 14 bytes instead of 15.
- Live check still needed: set GIT_REMOTE_URL and github_repo_token, then one real push to a throwaway branch is NOT allowed (main only), so test against a local bare origin only unless the user approves a real push.
- 2026-11-28 pushed 5e38fe2..954c680 (steer test, upload-limit removal, S3) to origin main (askpass recipe, script deleted).
- 2026-11-28 dev redeployed at 04c8028 (docker compose up -d --build), healthz ok. Dev app image has git 2.39.5. Browser approval card not yet exercised live.
