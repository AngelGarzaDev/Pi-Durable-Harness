# STATE (handoff)

## Current task
Per-conversation workspace plan (user m01156/m01170). Step 1 DONE in working tree: per-chat "Chat instructions" (appended after base prompt, stored in chat-instructions.json). Steps 2 and 3 not started.

## Done recently
- Step 1 per-chat instructions: src/chat-instructions.ts, src/harness.ts applySettings(..., chatInstructions), src/server.ts chat-instructions message, public/index.html #instr box, public/app.js. Tests 95/95.
- UI: markdown (55ef85e), restyle (378521f), chat list newest first (5185cc3), questions above composer (0cd84e0).
- Goal 8 MCP servers complete. Production on 5185cc3 (last redeploy); prod has NOT got step 1 yet.

## Next steps
1. Browser check of the chat instructions box on dev (sign in in the browser only; never put the token in tool calls).
2. Step 2: per-chat folder under /workspace (new chat asks for folder; runner guard allows subfolders; RemoteExecutionEnv cwd per conversation).
3. Step 3: read AGENTS.md from the chat's folder via the runner, add to that chat's instructions.
4. Life-manager prompt: waiting on user (what to manage, m01158).

## How to test
- npm run typecheck && npm test (95 passing).
- Dev: docker compose up -d --build; curl -s http://127.0.0.1:8787/healthz → ok.

## Known gaps
- Browser click-through not done for goal 6/7/8 UI, restyle, chat order, or the new instructions box.
- Goal 5.2 blocked (second account).

## Needs you
- Test chats/files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt, /workspace/mcp-live) — do not delete without approval.
- Production redeploy for step 1 only when you ask (back up app-data first).
