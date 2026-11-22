# NOTES (append-only)

- 2026-11-22: Default model set to claude-haiku-5-5 (src/config.ts) and default limit 100000 (src/settings.ts DEFAULT_CONTEXT_LIMIT, min with window-16384). Saved settings.json already had haiku/100000. Redeployed. Reason: user instruction.
- 2026-11-22: Repo git-initialised; baseline commit 1d673d8. secrets/, data/, node_modules/ gitignored.
- 2026-11-22: Live test rule: claude-haiku-5-5 only, context <= 100000. Paid APIs allowed (user instruction m01192).
- Pi Durable quirk: maxTurns stop => submission status "unanswered", reason "turn_limit", detail "N turns" (seen in DB, submissions table).
- Pi Durable quirk: steer (whenBusy:"steer") is recorded as a pi.user entry after the current tool results; it does not stop tool calls already issued (s3.txt still created in test).
- Earlier test helper scripts live in /tmp (not in repo); move to tests/ when creating `npm test`.
