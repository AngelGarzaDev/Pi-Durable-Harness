# STATE (handoff)

## Summary
pi-durable-web: browser chat for Claude on Pi Durable, with a sandboxed runner.
- Goals 1-5 done (turn-limit notice, steer timing, answer review, production hardening, README audit). 5.2 blocked (needs second account).
- Goal 6 (ask the user a question: option buttons plus own answer) is built and tested: tool `ask_user` parks on a signal (src/ask.ts), WS `answer` message (src/server.ts), question cards (public/app.js, public/ask-view.js). Suite: 56 tests pass.

## Current task
- Goal 6, steps 6.4 (live check with claude-haiku-5-5, 100000 token limit, one question, click an option; log cost in NOTES) and 6.5 (docker compose up -d --build, healthz ok).

## Next step
1. Docker redeploy: `docker compose up -d --build` in durable-web/, then `curl -s http://127.0.0.1:8787/healthz` should print ok.
2. Live check in browser (agent_browser or manual): new chat, ask the model to ask a question with options, click an option, confirm the answer appears and the model replies. Record in docs/NOTES.md.
3. Tick 6.4 and 6.5 in docs/PLAN.md.

## How to run and test
- Typecheck: `npm run typecheck`. Tests: `npm test` (node:test, spawns real server on random port).
- Dev without Docker: see README (ports 8788 / 7101 to avoid the Docker stack on 8787).

## Known failures / watch
- Old test chats and files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt) still exist; do not delete without approval.
- Goal 5.2 needs a second user account (not possible here).

## Needs you
- Delete test chats/workspace files (listed above) if you want them gone.
- Second account for goal 5.2 if you want that check.

## Decisions
- Question timeout 24 h; after it the tool returns an error result ("did not answer in time").
- Only a question open in the chat on the sending socket can be answered.
