# STATE (handoff)

## Current task
Settings pages (user m01522): DONE, on prod at 908b2df. Browser click-through still pending (user sign-in).

## Done recently
- Settings: "Settings" button in #top opens #globaldlg (model/limit/max rounds, Anthropic key, MCP servers). Each folder row has a gear button (.folder-gear) that opens #wsdlg for /workspace/<folder>: workspace instructions, "Load AGENTS.md from folder".
- Workspace instructions: src/workspace-settings.ts (<DATA_DIR>/workspace-instructions.json). Effective chat instructions = workspace text, then chat text (combineInstructions). src/server.ts effectiveInstructions(); applyFolder() re-applies to every chat in the folder on save/load.
- WS: workspace-get / workspace-save / workspace-load-agents -> reply "workspace" {folder, instructions, chats}. Folder must be one a chat uses.
- Tests: tests/workspace-settings.test.ts (8). Suite 122/122.
- Earlier: per-chat instructions (step 1), per-chat folder (step 2), AGENTS.md copy (step 3), sidebar grouping, autofill off, "+" per folder.

## Next steps
1. Done: pushed 908b2df; prod deployed 908b2df (backup app-data-pre-settings-2026-11-23.tgz).
2. Done (see NOTES).
3. Browser click-through of Settings dialog and gear dialog on dev and prod (needs user sign-in; not done by agent).

## How to test
- npm run typecheck && npm test (122 passing).
- Dev: docker compose up -d --build; curl -s http://127.0.0.1:8787/healthz -> ok. curl to 8787 returns 302 (login), so check served files via docker compose exec -T app grep.

## Known gaps
- Browser click-through not done for: settings dialogs, gear, "+", autofill, instructions and folder boxes, restyle, chat order.
- Chat "Load AGENTS.md" and workspace "Load AGENTS.md" insert the same block; a chat that has both gets it twice (documented in NOTES).
- Goal 5.2 (second real user check): PARKED (m01458).

## Needs you
- Test chats/files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt, /workspace/mcp-live): do not delete without approval.
