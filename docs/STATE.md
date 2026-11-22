# STATE (handoff)

!! PRODUCTION is running at http://127.0.0.1:8790 (personal use). Read docs/PRODUCTION.md before touching any docker or deploy command. Do not change production without the user's request.

## Summary
pi-durable-web: browser chat for Claude on Pi Durable, with a sandboxed runner.
- Goals 1-5 done (turn-limit notice, steer timing, answer review, production hardening, README audit). 5.2 blocked (needs second account).
- Goal 6 (ask the user a question: option buttons plus own answer) is built, tested, live-checked and deployed: tool `ask_user` parks on a signal (src/ask.ts), WS `answer` message (src/server.ts), question cards (public/app.js, public/ask-view.js). Suite: 56 tests pass.
- Live check (haiku-5-5) passed; see docs/NOTES.md.

## Current task
- Goal 6 done: 6.4 live WS check passed, 6.5 deployed (healthz ok). Only the push to origin is left.

## Next step
1. Push main to origin (see AGENTS.md; token file durable-web/secrets/github_repo_api_key, never print).
2. Optional: click the question card in the real browser UI (not done; needs a login).

## How to run and test
- Typecheck: `npm run typecheck`. Tests: `npm test` (node:test, spawns real server on random port).
- Dev without Docker: see README (ports 8788 / 7101 to avoid the Docker stack on 8787).

## Known failures / watch
- Browser question card not clicked in a real browser (only WS path live-tested).
- Old test chats and files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt) still exist; do not delete without approval.
- Goal 5.2 needs a second user account (not possible here).

## Needs you
- Delete test chats/workspace files (listed above) if you want them gone.
- Second account for goal 5.2 if you want that check.

## Decisions
- Question timeout 24 h; after it the tool returns an error result ("did not answer in time").
- Only a question open in the chat on the sending socket can be answered.
