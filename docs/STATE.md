# STATE (handoff)

## Current task
Per-conversation workspace plan (user m01156/m01170). Step 1 (per-chat instructions, f05ab08) and step 2 (per-chat folder under /workspace, commit below) DONE. Step 3 (AGENTS.md from folder into instructions) DONE, on prod at 0a61619. Prod deployed c190f7c (steps 1+2+3 + sidebar grouping + autofill off), healthy, backup deploy/production/backup/app-data-pre-step2-2026-11-23.tgz.

## Done recently
- Step 2 per-chat folder: src/chat-folder.ts, harness env factory uses agent cwd, server "new" takes folder, mkdir on runner, UI folder box in sidebar. tests/chat-folder.test.ts. Dev live check: pwd in folder livecheck gave /workspace/livecheck.
- Step 1 per-chat instructions: src/chat-instructions.ts, src/harness.ts applySettings(..., chatInstructions), src/server.ts chat-instructions message, public/index.html #instr box, public/app.js. Tests 95/95.
- UI: markdown (55ef85e), restyle (378521f), chat list newest first (5185cc3), questions above composer (0cd84e0).
- Goal 8 MCP servers complete. Production on 5185cc3 (last redeploy); prod has NOT got step 1 yet.

## Next steps
1. Browser check of the instructions box and folder box on dev (sign in in the browser only).
2. Sidebar grouping on prod (06da1bc); browser check pending (needs user sign-in).
3. "+" per folder in sidebar built (dev only, not on prod yet).
4. Browser click-through of instructions, folder and Load AGENTS.md boxes (needs user sign-in).
4. Life-manager prompt: DROPPED by user (m01458). Not pending.

## How to test
- npm run typecheck && npm test (114 passing).
- Dev: docker compose up -d --build; curl -s http://127.0.0.1:8787/healthz → ok.

## Known gaps
- Browser click-through not done for goal 6/7/8 UI, restyle, chat order, or the new instructions box.
- Goal 5.2 (second real user check): PARKED by user (m01458), needs a second account. Revisit later.

## Needs you
- Test chats/files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt, /workspace/mcp-live) — do not delete without approval.
- Prod on f3fa285 (steps 1+2). Browser check of new boxes on prod not done (needs sign-in by user).
