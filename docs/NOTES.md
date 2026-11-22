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
