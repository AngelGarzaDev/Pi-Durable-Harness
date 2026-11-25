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
- [x] 4.3 Process: unhandled rejection logging and close-handler catch (F7), graceful shutdown with client close and timeout (F18), paginate chat list and applyToAll past 200 (F10).
- [x] 4.4 Packaging: prod-only install in Docker (F20), drop unused React/Vite, tsx as runtime dep, license field AGPL-3.0-or-later, fix `start` script, compose runner_token secret.
- [x] 4.5 Repo hygiene: sanitize host paths/IPs/hostnames from docs and scripts, move root PLAN.md to docs/DESIGN.md, rewrite git author on history, scan full history for secrets, README (quick start, unsafe defaults noted), SECURITY.md, .gitignore.
- [x] 4.6 Verify: typecheck, npm test, docker compose up --build, healthz, curl login and WS smoke (done 2026-11-22: login 200/401, cookie gate 302, WS good origin opens, evil origin rejected), no secrets in `git ls-files` or history (done by grep scan).

## Goal 5: documentation audit
- [x] 5.1 Every progress item has a NOTES entry, PLAN tick and STATE update (2026-11-22).
- [ ] 5.2 Second real host user check (needs a second account; not possible on this host).

## Goal 6: ask the user a question (started 2026-11-22)
User request: the harness presents a question; the user clicks an answer or types their own.
- [x] 6.1 `ask_user` tool (src/ask.ts): parks on the `app.answer` signal, keyed by a memoized id; answer or timeout (24 h) on wake. Tests in tests/ask.test.ts (end to end with the faux provider: park, deliver, model gets answer, second delivery refused).
- [x] 6.2 Server: pendingQuestions() in every view; WS `answer` message checked against the open chat's questions, then harness.signal; `answer-result` reply. Test in tests/http.test.ts.
- [x] 6.3 Browser: question cards above the transcript (option buttons, own-answer field, Enter to send), public/ask-view.js helpers.
- [x] 6.4 Live check with claude-haiku-5-5 at 100000 tokens (one question, click an option). Log cost in NOTES.md. Done via a WS script (not the browser UI): question seen, option Red sent, answer-result ok, model replied "You chose Red.". Three runs, about 3 short haiku calls each.
- [x] 6.5 Deploy: docker compose up -d --build, healthz ok.

## Goal 7: browser-entered Anthropic key (started 2026-11-22)
User decision (m00454): allow a key entered in the browser. Reuse pi-ai's CredentialStore and api_key login flow, as Pi does.
Storage: DATA_DIR/credentials.json, mode 600, owner the app user, inside the app-data volume. Stored key wins over the Docker secret; logout falls back to the secret.
- [x] 7.1 File-backed CredentialStore (src/credentials.ts) passed to createModels; pi-ai api_key login run with a browser prompt. Tests: store round trip, file mode 600, stored key used by resolve, logout falls back.
- [x] 7.2 WS messages `auth-status` (never returns the key, only "stored"/"secret"/"none" and last 4 chars), `auth-set` (validates sk-ant- prefix and length only; no live call, so setting a key costs nothing), `auth-clear`. Tests in tests/http.test.ts.
- [x] 7.3 Browser: settings panel shows key source, password field to enter/replace key, clear button.
- [x] 7.4 Docs: docs/NOTES.md decision (plaintext in volume vs encrypted), docs/PRODUCTION.md note; verify in dev.

## Goal 8: MCP servers (started 2026-11-22)
Architecture follows Pi: client library @earendil-works/pi-mcp@1.6.0 (pinned exact, same as pi-durable; deps: cross-spawn only). Config format like Pi's mcp.json (mcpServers map, command/args/env/cwd or url/headers). Stdio servers run in the RUNNER (no credentials, workspace only). HTTP servers run in the APP (needs internet). Tool names mcp__<server>__<tool>.
- [x] 8.1 Add pi-mcp dependency; config file DATA_DIR/mcp.json with validation (names [A-Za-z0-9_-], no duplicate names, exactly one of command/url). Tests for validation.
- [x] 8.2 Runner endpoints: POST /mcp/start, /mcp/stop, GET /mcp/tools, POST /mcp/call (bearer-protected, body capped), stdio via StdioTransport. Tests in tests/runner-mcp.test.ts with a tiny stdio MCP fixture server.
- [x] 8.3 App: HTTP servers via StreamableHttpTransport; tool adapter to pi-durable tool registry (exposure direct|hidden; deferred and codemode not in first pass). Tests with an in-process HTTP fixture.
- [x] 8.4 WS messages `mcp-list`, `mcp-add`, `mcp-remove`, `mcp-reconnect` with status (state, tool count, error). Browser panel to list/add/remove.
- [x] 8.5 Live check: one stdio fixture server (no internet needed) then a haiku call that uses its tool (dev only, haiku-5-5, 100000 limit). Log in NOTES.md.
- [x] 8.6 Not in first pass (record in NOTES): OAuth for remote servers, deferred/codemode exposure, project-level config, /login-style MCP sign-in.

## Goal 9: Single source for workspace rules (started 2026-11-23, user decision m01778: option 1)
Rules for a folder = its AGENTS.md file only. Remove the workspace-instructions box/store and the "Load AGENTS.md" copy buttons.
Chat box stays for per-chat notes. Model gets: AGENTS.md text, then chat text.
- [x] 9.1 src/folder-rules.ts: FolderRules (last-read text per folder, refresh() re-reads AGENTS.md, one-time migration of legacy workspace-instructions.json text into AGENTS.md). Tests: tests/folder-rules.test.ts (fake deps). Files: src/agents-md.ts (combineInstructions, stripLegacyBlock), delete src/workspace-settings.ts.
- [x] 9.2 server: refresh before each submit in a folder and when a folder's rules change (applyFolder); new chat reads rules; open message carries modelInstructions (resolved agent instructions) so tests can see what the model gets; startup strips old copied AGENTS block from chat-instructions.json. Remove workspace-get/save/load-agents and load-agents handlers. DONE.
- [x] 9.3 Browser: workspace dialog edits AGENTS.md (workspace-agents-get/save); remove wsLoad and chat loadagents buttons.
- [x] 9.4 Tests: replace tests/workspace-settings.test.ts and the copy tests in tests/chat-folder.test.ts with equivalents (reason in NOTES). Suite green. Commit, push origin. Prod deploy only after asking.

## Goal 10: OpenAI-compatible endpoint for Home Assistant voice (started 2026-11-24, user approved design m02035)
Design: Home Assistant's conversation agent calls `POST /v1/chat/completions` (OpenAI shape). The model name `pi/<folder>` picks the workspace. One voice chat per folder, created on first use. Only the last user message is used (the app keeps the history). Own API key, separate from the login token, stored hashed. Voice chats get no runner tools unless the folder's voice-tools switch is on (default off).
Bind stays 127.0.0.1 unless the user decides otherwise (open question in STATE.md).
- [x] 10.1 src/api-keys.ts: generate key (shown once), store SHA-256 hash in DATA_DIR/api-keys.json (mode 600), verify with timing-safe compare; revoke. Tests: tests/api-keys.test.ts.
- [x] 10.2 Server: GET /v1/models (list `pi/<folder>` for every folder a chat uses); POST /v1/chat/completions non-streaming (stream:true -> 400 for now); bearer key required; unknown model -> 404 OpenAI error "No workspace named ...". Tests: tests/openai-api.test.ts.
- [x] 10.3 Voice chat per folder: stored mapping folder -> conversation id (DATA_DIR/voice-chats.json); created with folder settings; last user message submitted, answer returned; busy -> 409/429 with clear message. Tests in same file.
- [x] 10.4 Voice-tools switch per folder: workspace-config field `voiceTools` (default false = voice chats have no runner tools); applied to voice chats. Tests in tests/workspace-config.test.ts.
- [x] 10.5 Browser: settings panel to create/revoke the Home Assistant key (show once), and the per-folder voice-tools checkbox in the workspace dialog. Browser check needs user sign-in (pending).
- [x] 10.6 Docs: NOTES (decisions), STATE (LAN reachability needs a decision), docs/HOME-ASSISTANT.md with the HA setup (Extended OpenAI Conversation base URL, model name per agent). Live check with claude-haiku-5-5 at 100000 limit, logged in NOTES.

## Goal 11: Keep-going loop (started 2026-11-24, user request m02031; design to confirm)
Idea: when the model gives a final answer, the run can continue on its own with "Keep going." until the work is done or a limit is hit. Off by default, switched on per chat.
Pi Durable mechanism (node_modules/@earendil-works/pi-durable/README.md ~line 771, 843-869): hook GenerationTask `onYield` returning `{ continue: "Keep going." }` continues the same run; a user message queued meanwhile wins; `run.turns` resets per continue, so the loop must bound itself (count continues per user request). Alternative: `settings.afterFailedRun` is not the right tool (it only handles failed runs).
Stop rules to implement: the model says DONE (marker agreed in the prompt), max continues per request (default 5, cap 20), turn limit still applies, user steer or message ends it, stop button ends it.
- [x] 11.1 Confirm design with user: exact meaning of "keep going", stop marker, default max continues. (Open question: original wording of m02031 is not in the notes; ask user to restate.)
- [x] 11.2 src/keep-going.ts: pure decision function (answer, continues so far, cap, done marker) -> continue text or stop reason. Tests: tests/keep-going.test.ts.
- [x] 11.3 Wire onYield hook per chat (workspace or chat setting); record stop reason in transcript. Tests with faux provider.
- [x] 11.4 Browser toggle + stop reason shown. Browser check by user.
- [x] 11.5 Live check claude-haiku-5-5 at 100000 limit; log cost in NOTES.
- [x] 11.6 Docs and deploy (dev first; prod only if user asks).

## Goal 12: web search tool, reusing Pi's pi-web-access (started 2026-11-25, user request m02581)
- [x] 12.1 Pin pi-web-access 0.48.0 (exact, --omit=peer), smoke-test its MCP server (4 tools, keyless exa search works).
- [x] 12.2 Built-in MCP server "web" in the app process (src/web-search.ts, src/mcp.ts builtin kind, src/harness.ts). Tools: mcp__web__web_search, fetch_content, get_search_content, source_check.
- [x] 12.3 Tests: tests/web-search.test.ts (3); mcp-ws list/remove expectations ignore built-ins.
- [x] 12.4 Docs: README config note, NOTES decisions. Commit.
- [x] 12.5 Dev deploy (docker compose up -d --build), healthz, one live Haiku check that uses web_search (haiku-5-5, ≤100000).
- [ ] 12.6 Prod only when user asks (deploy/production/deploy.sh).
