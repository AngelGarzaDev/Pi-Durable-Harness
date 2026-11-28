# Design

This document records how pi-durable-web is built, the decisions behind it, and what is still open. It is the
reference for developers. For how to run the app, see the [README](../README.md). For the security model, see
[SECURITY.md](../SECURITY.md).

## Goals

A browser UI, served from this host in a Docker container, where you can:

1. Create and list chats, including forks.
2. Send messages and watch the answer stream in live.
3. See tool calls and their output as they run.
4. Steer a running answer, or queue a follow-up.
5. Reload the page or open it from another device and resume the same view.
6. Survive a container restart: unfinished work resumes from SQLite storage.

Non-goals: multi-user accounts, and mobile layout polish.

## Decisions

Each decision is stated with its reason.

- **Model provider: Claude through the Anthropic API.** The app uses pi-ai's `anthropicProvider()`. The default
  model is `claude-haiku-5-5` (set with `ANTHROPIC_MODEL`).
- **Credentials: an Anthropic API key read from a Docker secret file.** The key is read once at startup by
  `readApiKey` in `src/config.ts`, which requires the `sk-ant-` prefix. It is never an environment variable and
  never logged. A key saved in the browser is stored in `credentials.json` in the data volume (mode 600) and takes
  precedence over the Docker secret. A Claude Pro/Max OAuth login was considered and not used. Pi's own
  `~/.pi/agent/auth.json` must not be shared with a second client, because two clients rotating one refresh
  token can break each other.
- **Tools: `read`, `write`, `edit` and `bash`** from `@earendil-works/pi-durable/tools`. They run only in the
  `runner` container, which mounts only the `workspace` volume. The Docker socket and host paths are not mounted.
- **Runner internet access is on by default** (`egress` network). The model needs to fetch pages and install
  packages. Removing `egress` turns it off. The trade-off is listed under Accepted risks in
  [SECURITY.md](../SECURITY.md).
- **Front end: plain HTML and JavaScript in `public/`, with no build step.** This keeps the dependency count low.
  React was considered for a richer UI later and has not been started.
- **Transport: WebSocket for the live view.** The server pushes the full conversation view on each change. The
  browser sends `submit`, `steer`, `abort` and settings messages. HTTP serves static files, `/healthz`, and the
  OpenAI-compatible API under `/v1`.
- **Storage: `node:sqlite`** for the Pi Durable session. Chats, folders, settings and secrets are files under
  `DATA_DIR`. A Pi Durable `Harness` is opened on the session database and resumed on start.
- **Network exposure: plain HTTP on all host interfaces by default**, so devices on the LAN can reach it.
  `APP_BIND=127.0.0.1` restricts it to localhost. The app is not meant for the internet.
- **Port 8787** for the development stack. Port 8790 is used by the production copy (see
  [PRODUCTION.md](PRODUCTION.md)).
- **Pinned versions.** `@earendil-works/pi-durable` is pinned to `1.6.0` and not upgraded between releases. Pi
  Durable is experimental, and its API changes between releases.

## Architecture

```
browser (public/)  --WebSocket / HTTP-->  app container (src/)
                                              |  bearer token
                                              v
                                          runner container (runner/)  -->  /workspace (volume)
                                              |
                                          SQLite in DATA_DIR (volume app-data)
```

Server responsibilities (`src/`):

- Open one Pi Durable `Harness` on `DATA_DIR`, and call `harness.resume()` on start.
- Chat list and create (including fork), per-chat view, and settings.
- WebSocket `/ws` for live views, submit, steer and abort. The upgrade checks the session cookie and `Origin`.
- Sign-in with the app token, login rate limiting, and `GET /healthz`.
- OpenAI-compatible `GET /v1/models` and `POST /v1/chat/completions` for Home Assistant (see
  [HOME-ASSISTANT.md](HOME-ASSISTANT.md)).

Front end responsibilities (`public/`):

- Chat list, transcript with streaming answers and tool-call cards, input box with Send, Steer, Attach, Folder,
  Compact, New context and Abort.
- Reconnect after a dropped connection, then reload the view and subscribe again.

## Security model

Requirements:

1. The Anthropic key must not be reachable by the agent.
2. No process runs as root.
3. The agent can only touch its workspace directory.

Design: two containers, split by trust.

- **`app` container.** Runs the Pi Durable harness, the web UI, sign-in and model calls. Holds the Anthropic key and
  the app token. Has no shell tools and no workspace write access.
- **`runner` container.** Runs `bash`, `read`, `write` and `edit`. Holds the runner token only. Has no `/data`, and
  the only mount is `/workspace`. It exposes a small internal HTTP API (exec, read, write) that only `app` can reach,
  on the `tools` network.
- The harness uses a custom `ExecutionEnv` (the Pi Durable `env` option) that forwards tool calls to the runner. The
  agent's tools run in `runner`, and the app token never enters `runner`.

Hardening, for both containers:

- Non-root: both containers run as the invoking host user's uid and gid (build args `APP_UID` and `APP_GID`, from
  `.env`, written by `scripts/setup-secrets.sh`). Secret files stay mode 600 and owned by that user. Isolation between
  `app` and `runner` comes from separate containers, not from separate uids. No `privileged`, no `--pid=host`, no
  `--network=host`.
- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, and a read-only root filesystem. Only `/tmp` and the
  volumes are writable.
- No Docker socket and no host paths, apart from the named volumes. Membership of the host `docker` group is
  equivalent to root on the host, so the socket is never mounted.
- Runner path checks: every path is resolved and anything outside `/workspace` is refused. Symbolic links are
  followed.
- The `app` port is published on `${APP_BIND:-0.0.0.0}`.

Known limits:

- The app token is in `app`'s process memory while it makes requests. A bug in `app`, or a future shell tool added to
  it, could leak it. Keep `app` free of general-purpose tools.
- The runner can reach the internet by default. The token is not in the runner, so it cannot be sent out, but
  workspace contents could be. An allowlist proxy is not built.
- Anything written to `/workspace` is visible to any later process that mounts that volume.

## Feature status

Done:

- Model and context-limit settings.
- Manual and automatic compaction.
- Steer (`whenBusy: "steer"`), which joins after the current tool step.
- Fork from a message ("branch from here").
- Reset with optional handoff ("New context").
- Multiple chats, with a sidebar, newest first.
- Maximum tool rounds per run (`maxTurns`, default 50, range 1 to 500).
- Folder uploads, with all-or-nothing staging (see [README](../README.md#folders-and-uploads)).
- Keep going: a per-chat loop that continues until the answer ends with `DONE`.
- Answer review: an optional second model check per chat, with at most one retry.
- Web search through the `pi-web-access` package, inside the app container.
- MCP servers from `DATA_DIR/mcp.json`. Local programs run in the runner. Remote URLs are reached from the app.
- Encrypted secret store with a browser panel (see [README](../README.md#encrypted-secret-store)).
- OpenAI-compatible API for Home Assistant voice, with API keys created in the web app. Voice tool use is off by default.

Known gaps:

- A run stopped by the turn limit is stored as submission status `unanswered` with reason `turn_limit`. The browser
  does not yet show a notice for it.
- Steer is verified as accepted, but a steer sent during a multi-step run is not yet covered by an automated test.

## Open questions

1. **Rootless Podman instead of Docker.** Rootless Podman would also remove the root-equivalence risk of the `docker`
   group. Podman is installed on the development host. Not yet chosen.
2. **Notice for the turn limit in the browser.** Planned. See Known gaps.

## Planned: approval-gated git push

Status: design only, not built. The app is reachable only on the LAN.

- The runner gets a `git_push` tool and never sees a credential. It runs `git bundle create` over the requested refs in
  `/workspace`, and sends the bundle to the app over the internal `tools` network.
- The app holds the GitHub token (in the secret store), has `git`, and has egress through `edge`. It does not mount
  `/workspace`. The bundle is the only thing that crosses the boundary.
- Policy, enforced by the app: one configured repository (`origin`), branch `main` by default, no force-push, no
  deletes, and no tag or branch creation unless listed.
- Approval page: the app shows the commit list (hash, subject, author), the changed file names (added, modified,
  deleted) and the target branch. The user clicks Approve or Reject. Nothing is pushed without that click.
- On approval, the app unpacks the bundle into a scratch directory, runs `git push origin <branch>` with the token,
  and deletes the scratch copy. It returns the result to the runner and the chat. The token is never written to the
  bundle, the logs or the transcript.
- Failures (authentication, rejected non-fast-forward) are reported as they are. Nothing is retried automatically.

## Planned: moving secrets out of Docker secret files

Status: the encrypted secret store and its browser panel are built. The browser-entered Anthropic key is now kept
in the store (`LayeredCredentialStore` in `src/credentials.ts`); older plaintext keys are still read and are
replaced on the next save. Not yet done:

- The Docker secret stays as the fallback until the store has been verified on each host.
- Removing the Docker secret files from `compose.yaml` after that.

The store encrypts each value with AES-256-GCM, using a 32-byte master key on the host (`secrets/master_key`, mode 600).
The master key protects backups and copies of the volume. It does not protect against code running inside the app,
which needs the key anyway. Changing a secret requires re-entering the app token within the last 5 minutes. Every
change is logged (name, time and outcome), never the value.

## Answer review

Implemented in `src/review.ts`, with `src/keep-going-hook.ts` as the hook point.

- The check uses Pi Durable's `onYield` hook on the generation task. If the reviewer rejects the answer, the model
  gets the reviewer's notes and answers again.
- The reviewer is a separate call. It returns `PASS` or `FAIL` with notes. The verdict is read from the first word.
- Settings are per chat: review on or off, and an optional reviewer model. When no reviewer model is set, the chat's
  own model is used.
- The review result appears in the transcript.
- At most one retry per user message. The retry is not reviewed again. Reviewer tokens count toward cost, and
  `maxTurns` still applies.
