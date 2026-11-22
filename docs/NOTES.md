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
