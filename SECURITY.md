# Security

## Scope

pi-durable-web is built for one trusted user on their own machine. The default install serves plain
HTTP on all host interfaces (LAN by default; `APP_BIND=127.0.0.1` restricts it to localhost) and uses a shared login token. It is not hardened for multiple users or for
exposure to the internet.

## Design

- The API key is read from a file (Docker secret), never from an environment variable, and it is not logged.
- The app and the runner are separate containers. The runner holds no API key. The runner has no internet
  access unless you opt in with `compose.internet.yaml`.
- The runner needs a bearer token (`secrets/runner_token`). Paths outside `/workspace` are refused, including
  symlinks that point outside, and dangling symlinks.
- The WebSocket upgrade rejects any `Origin` that is not the app's own `Host` (src/server.ts). The session cookie is `HttpOnly; SameSite=Strict`, so cross-site pages cannot send it.
- Login attempts are limited per client address. Responses carry `Content-Security-Policy`,
  `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`.
- Containers run as non-root, with read-only root filesystems, `cap_drop: ALL` and `no-new-privileges`.

## Accepted risks (known, not fixed)

- **Sessions do not expire, and logout does not revoke them.** The session cookie is derived from the
  login token. The only way to revoke access is to change `secrets/app_token` and restart the app.
- **The model can run any shell command inside the runner.** That is the purpose of the app. Its reach is
  limited to the runner container and `/workspace`, plus the internet only if you enable it.
- **Plain HTTP by default.** Use HTTPS in front of the app (and set `SECURE_COOKIES=1`) before exposing it
  beyond localhost.
- **Prompt injection.** Text the model reads (web pages, files) can instruct it to run commands. Review
  what you let it do.

## Reporting a problem

Open a private security advisory on the repository. Please do not post exploit
details in a public issue before a fix is available.

The review that led to the hardening in this release is in [docs/REVIEW-2026-11-22.md](docs/REVIEW-2026-11-22.md).

## Container user
Both containers run as the uid/gid of the account that ran `scripts/setup-secrets.sh` (from `.env`), not a fixed uid.
This keeps the secret files mode 600 and owned by you. The runner therefore shares your uid, so a compromised runner
has the same file access as you inside the workspace volume and the container. Its isolation comes from the container
boundary (read-only root, no capabilities, no credentials, internal network), not from a separate uid.
Do not run the setup as root.

