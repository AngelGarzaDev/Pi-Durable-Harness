# Pi Durable Web GUI: plan

Status: Phase 0 done (scaffold, deps installed, `tsc` clean, harness opens). Not deployed. Phases 1-5 pending.

## Decisions (confirmed by user, m00046)

- **Model:** Claude via pi-ai `anthropicProvider()` (`@earendil-works/pi-ai/providers/anthropic`). Default model `claude-sonnet-5` (configurable). Auth: user asked for OAuth instead of an API key (m00076). Plan: pi-ai `anthropicProvider()` OAuth (Claude Pro/Max) via the app's own login page, using the copy-code flow (no callback port needed in the container). Credentials go to a `CredentialStore` file under `/data` (0600), refreshed by pi-ai `Models`. API key remains a fallback via `ANTHROPIC_API_KEY`. Pi's own `~/.pi/agent/auth.json` login is NOT shared (two clients rotating one refresh token can break each other).
- **Tools:** full `read`, `write`, `edit`, `bash` (`@earendil-works/pi-durable/tools`). Write scope is limited by Docker: the container is the sandbox, and only a dedicated workspace volume is mounted. The Docker socket and host paths are NOT mounted.
- **Network:** LAN/localhost only for now. Bind `127.0.0.1:8787` first; LAN binding later if wanted.
- **Front end:** modern stack. Plan: React + TypeScript + Vite (`react`, `react-dom`, `vite` already installed as dev deps).

Available Claude model ids in pi-ai 1.6-era catalog include claude-sonnet-5, claude-sonnet-5-5, claude-opus-5, claude-opus-5-5, claude-haiku-5-5, claude-sonnet-4-6, claude-opus-4-8.

## Phase 0 record

- Project: `<repo>/` (`package.json` type=module, `tsconfig.json`, `src/check.ts` smoke check, `public/`).
- Deps: `@earendil-works/pi-durable@1.6.0`, `@earendil-works/pi-ai`, `@earendil-works/chord`, `ws`; dev: typescript, tsx, @types/node, @types/ws, vite, react, react-dom, @types/react, @types/react-dom.
- Verified: `npx tsc --noEmit` passes; `npx tsx src/check.ts` opens a Harness (`MemoryStorage`, anthropic provider).
- Note: npm warned about install scripts (protobufjs postinstall) and was not approved; harmless for now.

## Goal

A browser UI served from this host (the host) in a Docker container. From a web page you can:

1. Create and list conversations (root and forks).
2. Send messages and watch the answer stream in live.
3. See tool calls and their output as they run.
4. Steer a running agent or queue a follow-up.
5. Reopen the page after a reload or from another device and resume the same view.
6. Survive a container restart: unfinished work resumes from SQLite storage.

Non-goals for v1: multi-user accounts, a full coding-agent toolset on the host (see Decisions), mobile layout polish.

## Host facts that shape the plan (checked read-only)

- Docker is running. Only `llama_cpp` is a container, on `0.0.0.0:9931 -> 8080`. Do not touch it.
- Node v24.22.1 on the host. `@earendil-works/pi-durable` 1.6.0 on npm needs Node >= 22.19.0.
- Ports 8080 is in use by nothing listed, but 9931 is taken. Proposed app port: **8787** (confirm it is free at deploy time).
- `/var` has 323 GiB free.
- Storage for the app: a named Docker volume, or a bind mount under `<repo>/data`. Proposed: bind mount, so the SQLite file is easy to back up.

## Decisions to confirm (open questions)

1. **Model provider.** Options:
   - (a) The local `llama_cpp` server at `http://<lan-ip>:9931/v1` (OpenAI-compatible, free, private). I need to confirm the loaded model name and that it supports tool calls.
   - (b) OpenAI or another hosted provider, using an API key you provide via an env file. Not stored in git.
   - Recommendation: (a) with (b) as an option.
2. **Tools the agent gets.** The `@earendil-works/pi-durable/tools` package gives `read`, `write`, `edit`, and `bash`. On a container, `bash` and `write` act on the container filesystem. Recommendation: start with no tools, or only read-only tools, mounting a single read-only workspace. Enable write/bash only after you approve it.
3. **Network exposure.** Recommendation: bind to the LAN address `<lan-ip>` only, not `0.0.0.0`, and require a shared access token (set in an env file, sent as a cookie or header). Nothing is exposed to the internet, and no firewall rule is added without your approval.
4. **Front end.** Recommendation: a single-page app with plain HTML/JS and no build step, served by the same server. Keeps the dependency count low. Alternative: React + Vite if you want a richer UI later.
5. **Transport.** Recommendation: WebSocket. The server sends the `conversation.watch()` operations to the browser, and the browser sends submit/steer/queue messages back. Server-Sent Events are a simpler fallback if WebSocket causes trouble.

## Architecture

```
browser (SPA)  <--WebSocket / HTTP-->  server (Node, Express-free http + ws)
                                          |
                                     Harness (pi-durable)
                                          |
                                  SQLite file in /data  (volume)
                                          |
                              model: llama_cpp or OpenAI-compatible
```

Server responsibilities:
- Open one `Harness` with `openNodeSqliteStorage("/data/session.sqlite")` and `harness.resume()` on start.
- `GET /api/conversations`, `POST /api/conversations` (create or fork), `GET /api/conversations/:id/view` (current view via `viewState`).
- WebSocket `/ws`: per-conversation subscribe (`watch` / `viewState` with live updates), submit input (with `requestId` for retries), steer (`whenBusy: "steer"`), and abort.
- Auth check on every HTTP route and on the WebSocket upgrade.
- Health route `GET /healthz` for Docker.

Front end responsibilities:
- Conversation list, transcript pane, streaming answer, tool-call cards with live output, input box with send/steer/queue, abort button.
- Reconnect with backoff; on reconnect, reload the view and re-subscribe.

## Phases

### Phase 0: Scaffold (no deployment)
- Create the project in `<repo>/`: `package.json` (ESM, Node 22+), `tsconfig.json`, `src/server.ts`, `public/index.html`, `public/app.js`, `public/style.css`.
- Install `@earendil-works/pi-durable`, `@earendil-works/pi-ai`, `@earendil-works/chord`, `ws`.
- Verify: `npm run build` and `npm start` on the host, from a shell, with the faux provider (no model needed).

### Phase 1: Core server
- Harness open/resume, conversation CRUD, view/watch over WebSocket, submit/steer/abort, token auth, `/healthz`.
- Verify: a test script submits a message through the WebSocket with the faux provider and sees the streamed result.

### Phase 2: Browser UI
- Build the SPA against the Phase 1 API. Test in a browser on the LAN.
- Verify: send a message, reload the page mid-answer, and see the same transcript resume.

### Phase 3: Model wiring
- Wire the chosen provider (llama_cpp or hosted), chosen with you in the open questions.
- Verify: a real answer from the model; check that `llama_cpp` is still healthy.

### Phase 4: Docker
- `Dockerfile` (node:24-slim, non-root user, multi-stage build), `docker-compose.yml` (port bound to `<lan-ip>:8787:8787`, volume `./data:/data`, env file `./.env`, `restart: unless-stopped`, healthcheck on `/healthz`).
- `.env.example` committed; real `.env` git-ignored and never printed.
- Build and run with `docker compose up -d --build`. Confirm with `docker ps` that `llama_cpp` is unaffected.
- Verify: restart the container mid-run and confirm the work resumes (this tests the durable part).

### Phase 5: Operations
- Backup note: copy `data/session.sqlite` while stopped, or use the SQLite `.backup` command.
- Add a README with run, stop, logs, and rotate-token steps.
- Optional: a systemd user unit or Docker's restart policy handles boot. Lingering is off per AGENTS.md, so the container only comes up when Docker itself starts (Docker is a system service, so this works without login).

## Risks

- **Experimental library.** The API can change between releases. Pin exact versions in `package.json` and record the pin in the README.
- **Node version.** Requires Node >= 22.19. The Docker image uses Node 24, so the host and container match.
- **Crash loops.** The library caps restarts (`settings.restartLimit`, default 5), so a bad request should not loop forever. Still, watch the logs after the first deploy.
- **Exposure.** Even on the LAN, the agent can act if tools are enabled. Token auth and the default no-tools setting are the main guards.
- **AGENTS.md rules.** Any host change (firewall rule, system service, port use) needs your confirmation. Container changes to `llama_cpp` need confirmation too; this plan does not touch it.

## Open items

1. User to provide `ANTHROPIC_API_KEY` (put in `durable-web/.env`, never printed or committed).
2. Confirm Phase 1 (core server) start.
3. Auth for the web page: even on localhost, a token is still recommended before LAN exposure.

## Security model (user requirements, m00102)

Requirements: (1) the Anthropic token must not be reachable by the agent; (2) no process runs as root; (3) the agent can only touch its workspace directory.

Design: two containers, split by trust.

- **`app` container (harness):** runs the Pi Durable Harness, the web UI, the login flow, and the model calls. Holds the OAuth credential file (`/data/credentials.json`, 0600, owned by its UID). Has NO shell tools and NO workspace write access. Its API is not reachable from the runner.
- **`runner` container (tools):** runs `bash`, `read`, `write`, `edit` only. Has NO credentials, NO `/data`, and no mount except `/workspace` (named volume). It exposes a small internal HTTP API (exec/read/write), reachable only from `app` on an internal Docker network.
- The harness uses a custom `ExecutionEnv` (pi-durable `env` option, see README "Environment") that forwards tool calls to the runner. So the agent's tools run in `runner`, and the token never enters `runner`'s memory, filesystem, or environment.

Hardening for both containers:
- Non-root: both containers run as the invoking host user's uid and gid (build args `APP_UID`/`APP_GID` from `.env`, written by `scripts/setup-secrets.sh`). The secrets stay mode 600 and owned by that user. Isolation between app and runner comes from separate containers, not from separate uids. No `privileged`, no `--pid=host`, no `--network=host`.
- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, read-only root filesystem (writable only `/tmp` and the volume it needs).
- No docker socket, no host paths except the named volumes. The Docker group membership of the host user is root-equivalent on the host, so nothing mounts the socket.
- Runner path checks: resolve every path and reject anything outside `/workspace` (symlink-aware).
- `app` port published on `127.0.0.1:8787` only.

Known limits (be explicit):
- The token is in `app`'s process memory while it makes requests. Anything that can read that process (a bug in `app`, or a future shell tool added to it) could leak it. Keep `app` free of general-purpose tools.
- Runner network egress: the agent can reach the internet if the runner has it. The token is not in the runner, so it cannot be sent out, but workspace contents could be. DECIDED 2026-11-28 (user m00826): the runner has internet access by default (`egress` network). Mitigation: no credentials in the runner; removing `egress` cuts it off. Open risk: injected tool output could steer exfiltration of workspace files; an allowlist proxy is not built.
- Anything the agent writes into `/workspace` is visible to any later process that mounts that volume.
- Rootless Docker or Podman (podman is already installed on this host) would also remove the root-equivalence risk of the docker group. Option to consider.

Open decisions:
1. Runner internet access: DECIDED yes, by default (user m00826, 2026-11-28).
2. Rootless Podman instead of Docker: yes or no.

## Phase 1 record (in progress)

- Auth decision (m00128): Anthropic API key, delivered as a Docker secret file. Compose will mount `./secrets/anthropic_api_key` at `/run/secrets/anthropic_api_key`. The app reads it once at startup (`src/config.ts` `readApiKey`, which requires an `sk-ant-` prefix) and sets it in process memory only. The key is never an env var in compose and never logged.
- Secret file ownership: compose bind-mounts the host file, so it must be readable by the container UID. Plan: `app` runs as UID 1000 (the usual first host user) with the file mode 0400. Note: this UID is non-root but not separate from the host user; the runner container must use a different UID with no secret access.
- Files: `src/config.ts`, `src/harness.ts` (opens Harness over `data/session.sqlite`, root conversation, `harness.resume()`), `src/server.ts` (HTTP static + `/healthz`, WebSocket `/ws`: server pushes full `ConversationView` on each change; client sends `submit` (whenBusy steer|followUp) and `abort`), `public/` (plain test page; React UI in Phase 2).
- Not yet done: auth token on WebSocket (planned), tool environment and runner container (Phase 1b / 4), real key, typecheck of runtime behaviour.
- Open: rootless Podman vs Docker (runner internet access decided 2026-11-28).

## Feature status (2026-11-22)
- Done: model and context-limit settings; manual and automatic compaction; steer (`whenBusy: "steer"`); fork from a message ("branch from here"); reset with optional handoff ("New context"); multiple chats (sidebar, `chats.json` titles); max tool rounds per answer (`maxTurns`, default 50, range 1–500).
- Known gaps: a run stopped by the turn limit ends as submission status `unanswered`, reason `turn_limit` (verified in DB), but the browser shows no notice. Steer verified only as accepted, not as a mid-answer change. Test chats remain in the data volume.

## Plan: review tasks (second check on answers)
Goal: optional automatic reviewer that checks each answer before it is final and sends Claude back to fix problems.
1. Use Pi Durable `onYield` hook on the generation task (`defineExtension` + `hook(GenerationTask, { onYield })`, `hookTask`). Pi Durable returns the answer to the agent if the hook rejects it.
2. Reviewer is a separate `defineTask` that calls the model with the answer and the user's request, returns pass or a list of issues.
3. Setting per chat: review on/off, reviewer model (default: same as chat). Store in `settings.json`.
4. Show review result in the transcript as a `review` entry (pass, or issues found and the retry).
5. Limits: cap retries at 1 to avoid loops; count reviewer tokens against cost; respect `maxTurns`.
6. Test: a prompt with a deliberate mistake (e.g. wrong arithmetic) should be flagged and corrected; a clean answer should pass without retry.

## Plan: approval-gated push and GUI secrets (decided 2026-11-28, user m00702, m00705)

Status: design only. No code written yet. Scope: the app is reachable only on the LAN.

### Approval-gated git push
- The runner gets a git tool (`git_push`) and never sees a credential. It runs `git bundle create` over the requested refs in `/workspace` and sends the bundle to the app over the internal `tools` network.
- The app holds the GitHub token (in the secret store below), has `git` and egress through `edge`, and does not mount `/workspace`. The bundle is the only thing that crosses the boundary.
- Policy, enforced by the app: one configured repo (`origin` = the repo in `AGENTS.md`), branch `main` by default, no force-push, no deletes, no tag or branch creation unless listed.
- Approval page: the app shows the commit list (hash, subject, author) and the file names changed (added, modified, deleted), plus the target branch. The user clicks Approve or Reject. Nothing is pushed without that click.
- On approval, the app unpacks the bundle into a scratch directory, runs `git push origin <branch>` with the token, deletes the scratch copy, and returns the result to the runner and the chat. The token is never written to the bundle, logs, or the transcript.
- Failures (auth, rejected non-fast-forward) are reported as-is; nothing is retried automatically.

### Encrypted secret store with GUI
- Secrets move from Docker secret files into an encrypted store in the `app-data` volume. The app reads them at runtime, so a new key takes effect without a restart.
- Encryption: AES-256-GCM per value. The master key is a 32-byte file on the host, set once per install (`secrets/master_key`, mode 600). It protects backups and copies of the volume; it does not protect against code running in the app, which needs the key anyway.
- GUI: list of secret names with a masked value and last-changed time. Add, replace, and delete. Values are write-only: the value is never shown or returned after saving.
- Changing or adding a secret requires re-entering the app token within the last 5 minutes. Every change is logged (name, time, outcome; never the value).
- Bootstrap on a new host: one SSH step to place `master_key` and `app_token`. After that, all keys are set from the browser.
- Secrets in the store: `anthropic_api_key`, `github_repo_token`, `app_token` (may be changed from the GUI, which logs out other sessions). `runner_token` stays a Docker secret: it is internal and never edited by hand.
- Migration: the existing Docker secret files stay until the store is working and verified on dev. Only then are they removed from compose.

### Order of work
1. Secret store + GUI, with tests (encrypt/decrypt round trip, masked output, re-auth, audit log).
2. Move `anthropic_api_key` to the store; keep the Docker secret as fallback until verified.
3. Bundle push tool: runner side, app side, approval page, policy tests.
4. Deploy to dev, then prod (new host), with a backup of `app-data` first.
