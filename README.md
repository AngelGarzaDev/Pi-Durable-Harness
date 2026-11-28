# pi-durable-web

A single-user browser chat for Claude. The model can run shell, read, write and edit tools,
but only inside a separate runner container that has no credentials. Built on
[Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable) (experimental).

Features: login with an access token (lockout after repeated failures), dark UI, several chats in a
sidebar, model and context-limit settings, manual and automatic compaction, steer (joins after the
current tool step), fork ("branch from here"), reset with optional handoff, a turn limit per run, and an
optional **answer review**: a second model call checks each answer and retries once. Review is off by
default and is switched on per chat.

- [Quick start](#quick-start)
- [Running without Docker](#running-without-docker-development-only)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Tests and checks](#tests-and-checks)
- [Security](SECURITY.md)
- More: [docs/DESIGN.md](docs/DESIGN.md) (design and decisions), [docs/NOTES.md](docs/NOTES.md) (log of decisions and Pi Durable quirks)

## Quick start

You need Docker with Compose and an Anthropic API key. This is for a trusted single user on your own
machine. It serves plain HTTP on port 8787 on all host interfaces, so other devices on your LAN can open it. Do not expose it to the internet, and put HTTPS in front of it before using it outside a trusted network. Set `APP_BIND=127.0.0.1` to keep it local only.

```sh
git clone https://github.com/AngelGarzaDev/Pi-Durable-Harness.git
cd Pi-Durable-Harness

# Creates secrets/ (mode 600, owned by you), asks for your Anthropic key (input hidden),
# and writes .env with your uid/gid so the containers can read the secrets.
# Run it as your normal user, not as root. Safe to re-run: existing secrets are kept.
./scripts/setup-secrets.sh

docker compose up -d --build
curl -s http://127.0.0.1:8787/healthz   # prints: ok
```

Then open <http://127.0.0.1:8787> and sign in with the contents of `secrets/app_token`
(`cat secrets/app_token` prints it).

Manual alternative to `setup-secrets.sh`, same result:

```sh
# Run from the repo root, as your normal user (not root).
umask 077                                    # files you create are readable only by you
mkdir -p secrets

read -rsp "Anthropic API key: " key; echo    # input hidden; must start with sk-ant-
printf '%s\n' "$key" > secrets/anthropic_api_key && unset key
openssl rand -hex 32 > secrets/app_token     # the login token you type in the browser
openssl rand -hex 32 > secrets/runner_token  # shared by app and runner; never typed in

chmod 600 secrets/*
printf 'HOST_UID=%s\nHOST_GID=%s\n' "$(id -u)" "$(id -g)" > .env   # containers run as your uid/gid

# Only on SELinux Enforcing systems (Fedora, Bazzite, RHEL), otherwise skip:
# chcon -t container_file_t secrets/*

docker compose up -d --build
curl -s http://127.0.0.1:8787/healthz        # prints: ok
```

The containers run as your uid and gid, so the secret files must be owned by you. If you ran an
earlier version that used another runner uid, see "Upgrading" below.

Stop with `docker compose down`. Chats are kept in the `app-data` volume and files the model writes are in
the `workspace` volume. `docker compose down -v` deletes both volumes.

### Allowing the runner to reach the internet

By default the runner has no internet access (its network is internal). To let the model fetch
URLs or install packages:

```sh
docker compose -f compose.yaml -f compose.internet.yaml up -d --build
```

## Running without Docker (development only)

Needs Node 22.19 or newer. Without Docker the runner runs on your machine with your permissions,
so only do this for development. Stop the Docker stack first (`docker compose down`), because both use port 8787.

```sh
npm ci
mkdir -p data workspace

# App settings. Paths are relative to the repo root.
export ANTHROPIC_API_KEY_FILE=secrets/anthropic_api_key APP_TOKEN_FILE=secrets/app_token \
       RUNNER_TOKEN_FILE=secrets/runner_token DATA_DIR=./data

# Terminal 1: the runner (shell and file tools), bound to localhost, working in ./workspace
RUNNER_HOST=127.0.0.1 WORKSPACE_DIR=./workspace node --import tsx runner/server.ts

# Terminal 2: the app, then open http://127.0.0.1:8787
npm start
```

## Architecture

| Part | Where | Holds |
|---|---|---|
| `app` (`src/`, `public/`) | web UI, login, model calls, chat storage (`node:sqlite`) | Anthropic key, login token |
| `runner` (`runner/`) | shell and file tools inside `/workspace` | runner token only |

The app talks to the runner over HTTP with a bearer token. The runner refuses any path that
resolves outside `/workspace`, including through symlinks, and refuses dangling symlinks.

## Configuration

Settings come from environment variables. Defaults are in `src/config.ts` and `runner/server.ts`. The
Anthropic key is always read from a file, never from an environment variable.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8787` | app listen address (the container sets `0.0.0.0`; Compose publishes it on `${APP_BIND:-0.0.0.0}`, set `APP_BIND=127.0.0.1` for local only) |
| `DATA_DIR` | `./data` | chats, settings, session database |
| `ANTHROPIC_API_KEY_FILE` | `/run/secrets/anthropic_api_key` | Anthropic key file |
| `APP_TOKEN_FILE` | `/run/secrets/app_token` | login token file |
| `RUNNER_URL` | `http://127.0.0.1:7000` | runner base URL |
| `RUNNER_TOKEN_FILE` | `/run/secrets/runner_token` | shared app/runner token file |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | default model for new chats |
| `SECURE_COOKIES` | off | set to `1` when served over HTTPS (adds the `Secure` cookie flag) |
| `RUNNER_HOST` / `RUNNER_PORT` / `WORKSPACE_DIR` | `0.0.0.0` / `7000` / `/workspace` | runner listen address, port and workspace directory |

Chat settings (model, context limit, maximum tool rounds, review) are changed in the browser and saved in
`DATA_DIR/settings.json`. The default context limit is 100,000 tokens.

### Uploading files and folders
In a chat, the **Attach** button uploads files and **Folder** uploads a whole folder; the saved paths are added to your message. In the workspace dialog, the file and folder pickers save into that workspace's folder. Folders keep their structure (up to 8 levels) and may be up to 2 GB in total. Each file is limited to 15 MB; "Cancel upload" stops a folder after the current file, and a name that is taken gets `-2`, `-3` and so on. A chat with no folder uploads to `/workspace/uploads`. Names are cleaned: leading dots are dropped, so `.github` is saved as `github`.

### Web search

The model has `web_search`, `fetch_content`, `get_search_content` and `source_check` (as `mcp__web__*`). They come
from Pi's `pi-web-access` package (pinned in `package.json`), which runs inside the app container. Without any
configuration it searches with a keyless provider. To change providers or add API keys, put a `web-search.json`
in `DATA_DIR/web-access/` (for example `searxngBaseUrl`). Keys live only in that file on the data volume and are
never printed. The runner still has no internet access. The name `web` is reserved in `mcp.json`.

### Keep going

Off by default, per chat ("Keep going" checkbox, rounds picker: 3/5/10/20, default 5). When on, the system
prompt asks the model to end its final message with a line containing only `DONE`. If an answer does not end
with `DONE`, the app sends "[Keep going] ..." and the model continues, up to the rounds limit. The loop stops
when the answer ends with `DONE` (reason `done`), when the limit is reached (`cap`), or when the answer is
empty (`empty`). The transcript shows a "Keep going stopped" line with the reason. The cap
counts continues since your last message, so a new message starts a fresh count. The `maxTurns` limit still applies on top.

## Upgrading

Earlier versions ran the runner as uid 10001, so the `workspace` volume may be owned by that uid and the
runner cannot write to it. Fix it once, keeping your files (replace `1000` with your uid if different):

```sh
docker run --rm --user 0 --entrypoint sh -v pi-durable-web_workspace:/workspace pi-durable-web-runner:local -c 'chown -R 1000:1000 /workspace'
docker compose up -d --build
```

Fresh installs do not need this.

### Updating an install

Your chats, folders, settings and keys live in the `app-data` volume, and workspace files in `workspace`. An update
rebuilds the containers and keeps both volumes, so nothing is lost. Before updating, back up the app data:

```sh
docker run --rm -v pi-durable-web_app-data:/data:ro alpine tar czf - -C /data . > app-data-$(date +%F).tgz
```

Then update the code and redeploy:

```sh
git pull --ff-only origin main        # or copy the new files over your checkout
docker compose up -d --build          # rebuilds the app and runner images and restarts them
curl -s http://127.0.0.1:8787/healthz # should print: ok
```

If the new version needs a change to the Upgrading steps above, follow those first. Check the commit with
`git log --oneline -1`. To go back, check out the previous commit and run the same `docker compose up -d --build`.
Your data stays, but a schema change in a newer version may not work on an older one, so take the backup first.
Secret files (`secrets/`) are not touched by an update.

## Tests and checks

```sh
npm run typecheck
npm test
```

`npm test` runs unit tests and HTTP tests that start the real app and runner as child processes.
No test calls a paid model. The live checks in `scripts/` do call the model and are run by hand
(see the header of each file). They need a running app.

## License

Copyright (C) the authors. Licensed under the GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later), see [LICENSE](LICENSE). If you run a modified version as a network service,
you must offer its source to its users.

### Giving the runner access to the LAN

`compose.lan.yaml` puts the runner on a normal bridge network, so it can reach the LAN and the internet:

```sh
docker compose -f compose.yaml -f compose.lan.yaml up -d --build
```

This also lets the agent reach host services (for example SSH on the host) and LAN devices. Compose cannot limit it to the LAN only.
