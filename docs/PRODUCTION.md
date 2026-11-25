# PRODUCTION: pi-durable-web for personal use

**This is the live app that the user uses every day. Do not modify, restart, or wipe it without the user's explicit request.**
The development stack (repo root `compose.yaml`, port 8787) is separate and may be rebuilt freely.

## What is what
| | Production | Development |
|---|---|---|
| Compose file | `deploy/production/compose.yaml` | `compose.yaml` (repo root) |
| Compose project | `pi-durable-prod` | `pi-durable-web` |
| URL | http://192.168.1.30:8790 | http://127.0.0.1:8787 |
| Containers | `pi-durable-prod-app-1`, `pi-durable-prod-runner-1` | `pi-durable-web-app-1`, `pi-durable-web-runner-1` |
| Chat data (volume) | `pi-durable-prod_app-data` | `pi-durable-web_app-data` (old test chats) |
| Workspace (volume) | `pi-durable-prod_workspace` | `pi-durable-web_workspace` (old test files) |
| Secrets | `deploy/production/secrets/` | `secrets/` |
| Model | `claude-haiku-5-5` (set in compose) | any, for tests |

Production has its own secrets: the Anthropic key was copied from dev; the app token and runner token were generated new.

## Rules for the agent
1. Never run `docker compose down -v`, `docker volume rm`, or `docker system prune --volumes` on either stack.
2. Never edit files under `deploy/production/secrets/` or `deploy/production/.env`, and never print them.
3. Deploy production only with `deploy/production/deploy.sh`. It refuses a dirty tree, so the commit is what runs. Do not run `docker compose up` by hand in production unless the script cannot be used.
4. Do not point live tests at production. Live tests use the dev stack (8787) with `claude-haiku-5-5` and a 100000 token limit.
5. Do not touch the `llama_cpp` container.
6. Do not delete chat or workspace data without the user's approval.

## Deploy a new version
```
git status                       # must be clean; commit first
deploy/production/deploy.sh      # builds, starts, waits for /healthz on 8790, writes deploy/production/.deployed-commit
```
`deploy/production/.deployed-commit` records the commit that is running. Check with:
```
curl -s http://192.168.1.30:8790/healthz      # prints ok
cat deploy/production/.deployed-commit
cd deploy/production && docker compose ps
```

## First-time setup (already done, for reference)
- `deploy/production/secrets/{anthropic_api_key,app_token,runner_token}`, mode 600.
- `deploy/production/.env` with `HOST_UID` and `HOST_GID` (the containers run as this uid).
- SELinux (Enforcing on this host): secrets must carry `container_file_t`. `deploy.sh` does this. Without it the runner fails with `EACCES: permission denied, open '/run/secrets/runner_token'`.

## Backup
Pre-deploy backup for d54cb01: deploy/production/backup/app-data-pre-goal8-2026-11-22-1725.tgz (ignored by git).
Note: `-v "$PWD/...:/backup"` bind mounts fail with Permission denied here (SELinux). Stream to a host file instead:
`docker run --rm -v pi-durable-prod_app-data:/data:ro alpine tar czf - -C /data . > backup/app-data-DATE.tgz`
Chat data is in `pi-durable-prod_app-data` (SQLite). Back up before any risky change:
```
docker run --rm -v pi-durable-prod_app-data:/data:ro -v "$PWD/deploy/production/backup:/backup" alpine \
  tar czf /backup/app-data-$(date +%F).tgz -C /data .
```
Keep backups out of git (`deploy/production/backup/` is ignored).

## Logs and stop
```
cd deploy/production
docker compose logs --tail 100 app runner
docker compose stop        # pause only; data kept
docker compose up -d       # start again
```
Never `down -v`.

## Change log
- 2026-11-22: production created on port 8790, from commit 2d95ba3 (ask_user feature included). Login verified (correct token 200, wrong 401). Model claude-haiku-5-5.
- 2026-11-22: production updated fb098e2 → d54cb01 (goal 7 browser key, goal 8 MCP servers, docs). Backup taken first. Checks: healthz ok, all containers up, auth-status source "secret", mcp-list 0 servers, chats kept.

## Browser-entered key and MCP servers (live since d54cb01)
- Anthropic key: a key saved in the browser is stored in the app-data volume at credentials.json (mode 600, plaintext). It wins over the Docker secret. Decision and reasoning in docs/NOTES.md (goal 7).
- MCP servers: DATA_DIR/mcp.json in the app-data volume. Local programs run inside the runner (no credentials).
- 2026-11-22: production updated d54cb01 → a329be2 (edit an MCP server). Backup first: deploy/production/backup/app-data-pre-edit-2026-11-22-1738.tgz (ignored by git). Checks: healthz ok, WS auth-status and mcp-list answer.
- 2026-11-22: production updated a329be2 → 2a08cad (markdown, UI restyle, chat bubbles, chronological chat list). Backup first: deploy/production/backup/app-data-pre-chatorder-2026-11-22-1755.tgz (git-ignored). Checks: healthz ok, WS auth-status and mcp-list answer. No model call.
- 2026-11-22: production updated 2a08cad → 5185cc3 (chat list newest first, per user m01121). Backup: deploy/production/backup/app-data-pre-chatorder-rev-2026-11-22-*.tgz (git-ignored). healthz ok.
- 2026-11-25: production updated 3ade10a → 72bb123 (keep-going loop, per-chat, off by default; browser toggle; README section). Backup first: deploy/production/backup/app-data-pre-keepgoing-2026-11-25-0024.tgz (git-ignored). Checks: healthz ok, both containers healthy, .deployed-commit 72bb123. No model call; prod chats untouched.
- 2026-11-25: production updated 72bb123 → 5c6bd6d (web search: pi-web-access built-in MCP server "web" in the app). Backup first: deploy/production/backup/app-data-pre-websearch-2026-11-25-0051.tgz (git-ignored). Checks: healthz ok, both containers healthy, pi-web-access present in app image. No model call.
