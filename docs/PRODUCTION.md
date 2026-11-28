# Production runbook

This runbook covers deploying and rolling back the production copy of pi-durable-web. The production copy is a
live app in daily use. Do not modify, restart or wipe it unless the owner asks you to. The development stack (the
repository root `compose.yaml`, port 8787) is separate and can be rebuilt freely.

## Stacks

| | Production | Development |
|---|---|---|
| Compose file | `deploy/production/compose.yaml` | `compose.yaml` (repository root) |
| Compose project | `pi-durable-prod` | `pi-durable-web` |
| URL | `http://<host-ip>:8790` | `http://127.0.0.1:8787` |
| Containers | `pi-durable-prod-app-1`, `pi-durable-prod-runner-1` | `pi-durable-web-app-1`, `pi-durable-web-runner-1` |
| Chat data (volume) | `pi-durable-prod_app-data` | `pi-durable-web_app-data` |
| Workspace (volume) | `pi-durable-prod_workspace` | `pi-durable-web_workspace` |
| Secrets | `deploy/production/secrets/` | `secrets/` |
| Model | `claude-haiku-5-5` (set in compose) | Any model, for development |

Production has its own secrets, separate from development: `anthropic_api_key`, `app_token` and `runner_token`, all
mode 600. `deploy/production/.env` holds `HOST_UID` and `HOST_GID`, so the containers run as your user.

## Rules

1. Never run `docker compose down -v`, `docker volume rm` or `docker system prune --volumes` on either stack.
2. Never edit or print the files under `deploy/production/secrets/` or `deploy/production/.env`.
3. Deploy production only with `deploy/production/deploy.sh`. It refuses a dirty working tree, so the commit is what
   runs. Run `docker compose up` by hand in production only if the script cannot be used.
4. Do not send test traffic to production. Use the development stack for tests.
5. Do not delete chat or workspace data without the owner's approval.

## Deploy a new version

1. Commit the change. `deploy.sh` refuses a dirty tree.
2. Back up the production data first (see [Backup](#backup)).
3. Run the deploy script:

   ```sh
   deploy/production/deploy.sh
   ```

   It builds and starts the stack, waits for `/healthz` on port 8790, and writes `deploy/production/.deployed-commit`
   with the commit that is running.
4. Verify:

   ```sh
   curl -s http://<host-ip>:8790/healthz        # prints: ok
   cat deploy/production/.deployed-commit      # the commit you deployed
   cd deploy/production && docker compose ps   # all containers are up
   ```

   Open the UI in a browser and sign in. Send a message only when the owner asks for a model call.
5. Record the deployment in [docs/NOTES.md](NOTES.md#production-deployment-history): the commit range, the backup file
   name and the checks. Do not put tokens in the record.

## Backup

Back up the chat data to a file on the host before any change:

```sh
mkdir -p deploy/production/backup
docker run --rm -v pi-durable-prod_app-data:/data:ro alpine tar czf - -C /data . > deploy/production/backup/app-data-$(date +%F-%H%M).tgz
```

The backup directory is ignored by git. Keep backups out of git.

On SELinux hosts, a bind mount of a host directory into the backup container can fail with `Permission denied`. For
that reason the command above streams the archive to a host file instead.

## Roll back

1. Find the commit to return to: `git log --oneline`.
2. Check it out in a separate worktree, and run `deploy/production/deploy.sh` from there.
3. Restore the backup only if the data itself was damaged.

## Logs and stop

```sh
cd deploy/production
docker compose logs --tail 100 app runner
docker compose stop        # pause only; data is kept
docker compose up -d       # start again
```

Never run `docker compose down -v` on production.

## Troubleshooting

- **`EACCES: permission denied, open '/run/secrets/runner_token'`** on an SELinux Enforcing host: the secret files
  need the `container_file_t` label. `deploy.sh` sets it. Run `chcon -t container_file_t deploy/production/secrets/*`
  if the label is missing.
