# STATE (handoff)

## Current task
Goal 9 (user m01778, option 1): single source for workspace rules. DONE, committed 3090ef5, pushed origin main. Dev rebuilt (healthz ok). PROD NOT DEPLOYED: ask user first.

## Done recently
- Goal 9 (3090ef5): src/folder-rules.ts (FolderRules, legacy migration); src/agents-md.ts (combineInstructions, stripLegacyBlock); src/workspace-settings.ts deleted; src/server.ts reads AGENTS.md before each submit in a folder; UI: workspace dialog edits AGENTS.md only, both Load AGENTS.md buttons removed (public/index.html, public/app.js). Tests: tests/folder-rules.test.ts (new), tests/chat-folder.test.ts (copy tests replaced), tests/workspace-settings.test.ts deleted.
- Workspace defaults (fc4efe4): src/workspace-config.ts; prod e30c0b7 (backup deploy/production/backup/app-data-pre-workspace-defaults-2026-11-23.tgz).
- Earlier: per-chat instructions, per-chat folder, sidebar grouping, autofill off, "+" per folder, settings dialogs.

## Next steps
1. Done: committed 3090ef5, pushed (askpass script in /tmp using secrets/github_repo_api_key, deleted after).
2. Ask user: deploy goal 9 to prod (docker compose -f deploy/production/compose.yaml up -d --build, backup first). Dev rebuild is allowed.
3. Browser click-through of dialogs (needs user sign-in).

## How to test
- npm run typecheck && npm test (135 passing).
- Served files: curl to 8787 returns 302 (login), so check with docker compose exec -T app grep.

## Known gaps
- Chat view does not say a folder overrides global settings (from workspace defaults).
- MCP off per folder: configure accepts it; tool list effect not verified with a live model call.
- Browser click-through not done for settings dialogs, gear dialog, "+", autofill, AGENTS.md editor.
- Goal 5.2 (second real user check): PARKED (m01458).

## Needs you
- Approve prod deploy of goal 9 (it changes how folder rules reach the model).
- Test chats/files (s1.txt–s3.txt, turnlimit.txt, turn-test.txt, /workspace/mcp-live): do not delete without approval.
