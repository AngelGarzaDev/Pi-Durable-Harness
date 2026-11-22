# pi-durable-web

A single-user browser chat for Claude. The model can run shell, read, write and edit tools,
but only inside a separate runner container that has no credentials. Built on
[Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable) (experimental).

Features: login with an access token (lockout after repeated failures), dark UI, several chats in a
sidebar, model and context-limit settings, manual and automatic compaction, steer (joins after the
current tool step), fork ("branch from here"), reset with optional handoff, a turn limit per run,
and an optional **answer review**: a second model call that checks each answer and retries once.

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Tests and checks](#tests-and-checks)
- [Security](SECURITY.md)
- More: [docs/DESIGN.md](docs/DESIGN.md) (design and decisions), [docs/NOTES.md](docs/NOTES.md) (log of decisions and Pi Durable quirks)

## Quick start

You need Docker with Compose, and an Anthropic API key. This setup is for a trusted single user on
your own machine. It serves plain HTTP on `127.0.0.1` only.

```sh
git clone <this repo> pi-durable-web && cd pi-durable-web
mkdir -p secrets

# 1. Your Anthropic API key (must start with sk-ant-)
printf '%s\n' 'sk-ant-...your key...' > secrets/anthropic_api_key

# 2. A login token for the browser (32+ characters)
openssl rand -hex 32 > secrets/app_token

# 3. A shared secret between the app and the runner (32+ characters)
openssl rand -hex 32 > secrets/runner_token

chmod 600 secrets/*
# The runner runs as a different user (uid 10001) and must read runner_token.
chmod 644 secrets/runner_token
# On SELinux hosts (Fedora, Bazzite, RHEL) also label it for containers; harmless elsewhere when it fails:
chcon -t container_file_t secrets/runner_token 2>/dev/null || true

# 4. Build and start
docker compose up -d --build
curl -s http://127.0.0.1:8787/healthz   # prints: ok
```

Open <http://127.0.0.1:8787>, and sign in with the contents of `secrets/app_token`.

Stop with `docker compose down`. Chats are kept in the `app-data` volume. Files the model writes are in the
`workspace` volume. Deleting a volume deletes its data.

### Running without Docker (development only)

```sh
npm ci
export ANTHROPIC_API_KEY_FILE=secrets/anthropic_api_key APP_TOKEN_FILE=secrets/app_token \
       RUNNER_TOKEN_FILE=secrets/runner_token DATA_DIR=./data
RUNNER_HOST=127.0.0.1 RUNNER_TOKEN_FILE=secrets/runner_token WORKSPACE_DIR=./workspace node --import tsx runner/server.ts &
npm start
```

Without Docker the runner runs on your machine with your permissions. Only do this for development.

### Allowing the runner to reach the internet

By default the runner has no internet access (its network is internal). To let the model fetch
URLs or install packages:

```sh
docker compose -f compose.yaml -f compose.internet.yaml up -d --build
```

## Architecture

| Part | Where | Holds |
|---|---|---|
| `app` (`src/`, `public/`) | web UI, login, model calls, chat storage (`node:sqlite`) | Anthropic key, login token |
| `runner` (`runner/`) | shell, file tools inside `/workspace` | runner token only |

The app talks to the runner over HTTP with a bearer token. The runner refuses any path that
resolves outside `/workspace`, including through symlinks.

## Configuration

Settings come from environment variables. Defaults are in `src/config.ts` and `runner/server.ts`.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8787` | app listen address |
| `DATA_DIR` | `./data` | chats, settings, session database |
| `ANTHROPIC_API_KEY_FILE` | `/run/secrets/anthropic_api_key` | key file (never an env var) |
| `APP_TOKEN_FILE` | `/run/secrets/app_token` | login token file |
| `RUNNER_URL` | `http://127.0.0.1:7000` | runner base URL |
| `RUNNER_TOKEN_FILE` | `/run/secrets/runner_token` | shared app/runner token |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | default model |
| `SECURE_COOKIES` | off | set to `1` behind HTTPS to add the `Secure` cookie flag |
| `RUNNER_HOST` / `RUNNER_PORT` / `WORKSPACE_DIR` | `0.0.0.0` / `7000` / `/workspace` | runner settings (the container uses these defaults; the local dev command below binds `127.0.0.1`) |

## Tests and checks

```sh
npm run typecheck
npm test
```

`npm test` runs unit tests and HTTP tests that start the real app and runner as child processes.
No test calls a paid model. Live checks that do call the model are in `scripts/` and are run by hand
(see the header of each file).

## Licence

Copyright (C) the authors. Licensed under the GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later), see [LICENSE](LICENSE). If you run a modified version as a network service,
you must offer its source to its users.
