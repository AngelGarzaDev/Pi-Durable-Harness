# pi-durable-web

A single-user browser chat for Claude. The model can run shell, read, write and edit tools, but only inside
a separate runner container that holds no credentials. Built on
[Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable), which is experimental.

## Features

- Sign in with an access token. Repeated failed logins lock the client out for a while.
- Dark browser UI with several chats in a sidebar.
- Per-chat model and context-limit settings, with manual and automatic compaction.
- Steer a running answer, branch a chat from any message ("fork"), or reset with an optional handoff.
- Folders (workspaces) with file and folder uploads.
- Keep going: the model continues an answer until it reports the task as done.
- Optional answer review: a second model call checks each answer and retries once.
- A turn limit for each run and optional web search.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Using the app](#using-the-app)
- [Configuration](#configuration)
- [Networking](#networking)
- [Secrets](#secrets)
- [Updating](#updating)
- [Running without Docker](#running-without-docker)
- [Architecture](#architecture)
- [Tests and checks](#tests-and-checks)
- [Documentation](#documentation)
- [License](#license)

## Requirements

- Docker with Docker Compose (`docker compose`).
- An Anthropic API key.
- For development without Docker: Node.js 22.19 or newer.

> **Warning:** The app serves plain HTTP. Use it only for yourself on a trusted network, and do not expose
> it to the internet. Put HTTPS in front of it, and set `SECURE_COOKIES=1`, before using it beyond localhost.
> See [SECURITY.md](SECURITY.md).

## Quick start

Run these commands from the repository root, as your normal user (not root):

```sh
git clone https://github.com/AngelGarzaDev/Pi-Durable-Harness.git
cd Pi-Durable-Harness

./scripts/setup-secrets.sh          # asks for your Anthropic key (input hidden) and creates the secrets
docker compose up -d --build        # builds the images and starts both containers
curl -s http://127.0.0.1:8787/healthz   # prints: ok
```

Then open <http://127.0.0.1:8787> and sign in with the access token, which is the contents of
`secrets/app_token`:

```sh
cat secrets/app_token
```

By default the app listens on all host interfaces, so other devices on your network can reach it at
`http://<your-host-ip>:8787`. To keep it on this machine only, set `APP_BIND=127.0.0.1` before you run
`docker compose up`.

To stop the stack, run `docker compose down`. Chats are kept in the `app-data` volume and files written by
the model are kept in the `workspace` volume. `docker compose down -v` deletes both volumes.

## Using the app

### Chats

- **+ New chat** starts a chat in the sidebar. Chats are listed newest first.
- Each chat has its own model, context limit, maximum tool rounds and review setting.
- **Steer** adds your message to an answer that is still in progress. It joins after the current tool step
  finishes; the answer does not stop. The button's tooltip says the same.
- **Fork** ("branch from here") creates a new chat from an earlier message, leaving the original unchanged.
- **New context** starts a fresh context. Earlier messages stay visible, but the model stops seeing them. You can
  include a handoff summary.
- **Compact** summarizes older messages to free room in the context. Compaction also runs automatically when the
  context nears its limit.
- **Abort** stops the current run.

### Folders and uploads

Each chat works in a folder (workspace). The model reads and writes files there.

- **Attach** uploads a file into the chat's folder. The saved path is added to your message.
- **Folder** uploads a whole folder and keeps its structure (up to 8 levels deep). The uploaded folder's
  total size may be up to 2 GB. Each file may be up to 15 MB.
- A folder upload is all or nothing. Files are first written to a hidden `.staging/<id>` folder and the
  whole folder is moved into place only when every file has arrived. A cancelled or failed upload is removed,
  so the model never sees a partial folder. Staging folders older than 24 hours are removed by the runner.
- If a name is already taken, the upload is saved with a suffix such as `-2` or `-3`. Existing folders are
  never merged.
- Leading dots are removed from names, so `.github` is saved as `github`.
- A chat with no folder uploads to `/workspace/uploads`.

### Keep going

Keep going is off by default. Turn it on for a chat with the **Keep going** checkbox and choose a limit
of 3, 5, 10 or 20 rounds (default 5). When it is on, the model ends its final message with a line that
contains only `DONE`. If an answer does not end with `DONE`, the app sends a "[Keep going]" message and the
model continues, up to the limit. The loop stops when:

| Reason | Meaning |
|---|---|
| `done` | The answer ends with `DONE`. |
| `cap` | The limit was reached. Send a message to continue. |
| `empty` | The last answer was empty. |

The transcript shows a "Keep going stopped" line with the reason. The count starts again each time you send a
message. The maximum tool rounds limit still applies to each run.

### Answer review

Review is off by default and is turned on per chat. When it is on, a second model call checks each answer
before it is final. If the reviewer finds a problem, the model gets one retry. The review result is shown
in the transcript.

### Turn limit

A run may use at most a set number of tool rounds, the **maximum tool rounds** setting (default 50, from 1
to 500). When a run reaches the limit, it stops. The answer is recorded as unanswered with reason
`turn_limit`.

### Web search

The model has four web tools: `web_search`, `fetch_content`, `get_search_content` and `source_check`. They
come from the [pi-web-access](https://www.npmjs.com/package/pi-web-access) package and run inside the app
container. Without any configuration, search uses a provider that needs no API key.

To use other providers or add API keys, create `web-search.json` in `DATA_DIR/web-access/` (for example,
with a `searxngBaseUrl` value). Keys are read only from that file and are never printed.

The runner has internet access by default, so the model can also fetch pages directly. See
[Networking](#networking).

## Configuration

Settings come from environment variables. Defaults are in `src/config.ts` and `runner/server.ts`. The
Anthropic key is always read from a file, never from an environment variable.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | App listen address. The container sets `0.0.0.0`. |
| `PORT` | `8787` | App listen port. |
| `APP_BIND` | `0.0.0.0` | Compose only: host address the app port is published on. Set `127.0.0.1` to keep it local. |
| `DATA_DIR` | `./data` | Chats, settings, secrets, API keys, MCP configuration and the session database. |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Default model for new chats. |
| `ANTHROPIC_API_KEY_FILE` | `/run/secrets/anthropic_api_key` | File that holds the Anthropic key. |
| `APP_TOKEN_FILE` | `/run/secrets/app_token` | File that holds the sign-in token. |
| `RUNNER_TOKEN_FILE` | `/run/secrets/runner_token` | File that holds the token shared by the app and the runner. |
| `MASTER_KEY_FILE` | `/run/secrets/master_key` | File that holds the master key for the encrypted secret store. |
| `RUNNER_URL` | `http://127.0.0.1:7000` | Base URL of the runner, as seen by the app. |
| `RUNNER_HOST` | `0.0.0.0` | Runner listen address. |
| `RUNNER_PORT` | `7000` | Runner listen port. |
| `WORKSPACE_DIR` | `/workspace` | Directory the runner's tools may use. |
| `SECURE_COOKIES` | off | Set to `1` when the app is served over HTTPS. This adds the `Secure` flag to the session cookie. |

The default context limit for chats is 100,000 tokens.

Global settings (model, context limit, maximum tool rounds) are changed in the browser and saved in
`DATA_DIR/settings.json`. Keep going, review and voice tool use are set per chat or per folder in the browser.

## Networking

Docker Compose creates three networks:

| Network | Purpose |
|---|---|
| `edge` | Normal bridge. The app reaches the Anthropic API through it. |
| `tools` | Internal (no route outside). The app and the runner talk to each other through it. |
| `egress` | Normal bridge. The runner reaches the internet through it. |

**Runner internet access is on by default.** The runner has no credentials and cannot reach the app's
secrets, but the model can fetch URLs and install packages. To turn it off, remove `egress` from the runner's
`networks:` list in `compose.yaml`, then run `docker compose up -d --build`.

`compose.internet.yaml` is a no-op kept for compatibility. It adds nothing.

### Giving the runner access to your LAN

`compose.lan.yaml` adds a `lan` network so the runner can reach devices on your local network:

```sh
docker compose -f compose.yaml -f compose.lan.yaml up -d --build
```

Compose cannot limit this network to the LAN. It also lets the model reach services on the host, such as SSH,
and devices on your LAN. Use it only when you need it. A host firewall rule is needed to restrict it further.

## Secrets

`./scripts/setup-secrets.sh` creates these files in `secrets/`:

| File | Contents |
|---|---|
| `anthropic_api_key` | Your Anthropic key. The script refuses any value that does not start with `sk-ant-`. |
| `app_token` | The sign-in token, 64 hex characters. |
| `runner_token` | The token shared by the app and the runner. You never type it. |
| `master_key` | The master key for the encrypted secret store, 64 hex characters. |

The script also writes `.env` with your user ID and group ID. The containers run as that user, so they can
read the files. The files are mode 600 and owned by you. The script never overwrites an existing secret, so
it is safe to run again.

The script is the recommended way to create secrets. To create them by hand, run these commands from the repo
root, as your normal user:

```sh
umask 077 && mkdir -p secrets
read -rsp "Anthropic API key: " key; echo && printf '%s\n' "$key" > secrets/anthropic_api_key && unset key
openssl rand -hex 32 > secrets/app_token
openssl rand -hex 32 > secrets/runner_token
openssl rand -hex 32 > secrets/master_key
chmod 600 secrets/*
printf 'HOST_UID=%s\nHOST_GID=%s\n' "$(id -u)" "$(id -g)" > .env
```

On systems with SELinux in enforcing mode (Fedora, Bazzite, RHEL), also run `chcon -t container_file_t secrets/*`.

### Encrypted secret store

Secrets you enter in the browser, such as a GitHub token, are stored in `DATA_DIR/secrets.json`. Each value is
encrypted with AES-256-GCM using `secrets/master_key`. Values are write-only: once saved, they are never shown
again. Each change is recorded in `DATA_DIR/secrets-audit.log`, without the value.

To change a secret, open the Secrets panel in the global settings and enter the app token. Changes are allowed
for 5 minutes after you enter it.

**Keep a copy of `secrets/master_key` somewhere off this machine.** Without it, the stored secrets cannot be
decrypted. Anyone who has both the master key and a copy of `app-data` can read the stored secrets.

## Updating

Your chats, folders, settings and keys are kept in the `app-data` volume. Workspace files are kept in the
`workspace` volume. Updating rebuilds the containers and keeps both volumes. Secret files are not changed.

Back up the app data before you update:

```sh
docker run --rm -v pi-durable-web_app-data:/data:ro alpine tar czf - -C /data . > app-data-$(date +%F).tgz
```

Update the code and redeploy:

```sh
git pull --ff-only origin main          # or copy the new files over your checkout
docker compose up -d --build            # rebuilds the images and restarts the containers
curl -s http://127.0.0.1:8787/healthz   # prints: ok
```

Check the running commit with `git log --oneline -1`.

To roll back, check out the previous commit and run `docker compose up -d --build` again. Volumes are kept, but a
newer version may change the data format in a way an older version cannot read. Always take the backup first.

## Running without Docker

Use this only for development. Without Docker, the runner runs on your machine with your permissions. Stop the
Docker stack first (`docker compose down`), because both use port 8787.

```sh
npm ci
mkdir -p data workspace

# App settings. Paths are relative to the repo root.
export ANTHROPIC_API_KEY_FILE=secrets/anthropic_api_key APP_TOKEN_FILE=secrets/app_token \
       RUNNER_TOKEN_FILE=secrets/runner_token MASTER_KEY_FILE=secrets/master_key DATA_DIR=./data

# Terminal 1: the runner (shell and file tools), on localhost, working in ./workspace
RUNNER_HOST=127.0.0.1 WORKSPACE_DIR=./workspace npm run start:runner

# Terminal 2: the app, then open http://127.0.0.1:8787
npm start
```

`MASTER_KEY_FILE` must be set so the app can open the secret store. Generate the four files in `secrets/` as
described in [Secrets](#secrets).

## Architecture

| Part | Location | Holds |
|---|---|---|
| `app` | `src/`, `public/` | Web UI, sign-in, model calls, chat storage (`node:sqlite`). Holds the Anthropic key and the app token. |
| `runner` | `runner/` | Shell and file tools inside `/workspace`. Holds the runner token only. |

The app calls the runner over HTTP with a bearer token. The runner refuses any path that resolves outside
`/workspace`, including paths that go through symbolic links, and refuses dangling symbolic links.

Both containers run as your user ID and group ID. Compose runs them with a read-only root filesystem, no Linux
capabilities and `no-new-privileges`.

## Tests and checks

```sh
npm run typecheck
npm test
```

`npm test` runs unit tests and HTTP tests. The HTTP tests start the real app and runner as child processes.
No test calls a paid model. The live checks in `scripts/` do call the model. Run them by hand, and read the
header of each file first. They need a running app.

## Documentation

| Document | For |
|---|---|
| [SECURITY.md](SECURITY.md) | Security model, accepted risks, how to report a problem. |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | Operators: deploying and rolling back a production copy. |
| [docs/DESIGN.md](docs/DESIGN.md) | Developers: design, decisions and open questions. |
| [docs/HOME-ASSISTANT.md](docs/HOME-ASSISTANT.md) | Home Assistant voice integration through the OpenAI-compatible API. |

The full index is in [docs/README.md](docs/README.md).

## License

Copyright (C) the authors. Licensed under the GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later). See [LICENSE](LICENSE). If you run a modified version as a network service, you must offer
its source code to its users.
