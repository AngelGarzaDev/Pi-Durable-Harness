# Security

## Scope

pi-durable-web is built for one trusted user on their own machine. By default the app serves plain HTTP on all
host interfaces, so it is reachable from your local network. Set `APP_BIND=127.0.0.1` to restrict it to
localhost. It uses a shared sign-in token. It is not hardened for multiple users or for exposure to the internet.

## Design

- The Anthropic API key is read from a file (a Docker secret), never from an environment variable, and it is
  not logged.
- The app and the runner are separate containers. The runner holds no API key.
- The runner has internet access by default. To cut it off, remove `egress` from the runner's networks in
  `compose.yaml`.
- The runner requires a bearer token (`secrets/runner_token`). Paths outside `/workspace` are refused, including
  symbolic links that point outside it and dangling symbolic links.
- The WebSocket upgrade rejects any `Origin` that is not the app's own `Host` (`src/server.ts`). The session
  cookie is `HttpOnly; SameSite=Strict`, so cross-site pages cannot send it.
- Login attempts are limited per client address. Responses carry `Content-Security-Policy`,
  `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`.
- Containers run as your non-root user ID, with read-only root filesystems, `cap_drop: ALL` and
  `no-new-privileges`.
- Values in the encrypted secret store are encrypted with AES-256-GCM and are never shown again after saving.

## Accepted risks

These are known and not fixed.

- **Sessions do not expire, and signing out does not revoke them.** The session cookie is derived from the
  sign-in token. The only way to revoke access is to change `secrets/app_token` and restart the app.
- **The model can run any shell command inside the runner.** That is the purpose of the app. Its reach is limited
  to the runner container and `/workspace`, plus the internet (on by default; see the runner networks in
  `compose.yaml`).
- **Plain HTTP by default.** Put HTTPS in front of the app and set `SECURE_COOKIES=1` before you expose it beyond
  localhost.
- **Prompt injection.** Text the model reads (web pages, files) can instruct it to run commands. Review what you
  let it do.
- **Runner network access can move data out.** The runner has no credentials, so the token cannot be sent out. Its
  workspace files can still be sent to the internet. No allowlist proxy is in place.

## Reporting a problem

Open a private security advisory on the repository. Please do not post exploit details in a public issue before a
fix is available.

A review of the security hardening is in [docs/REVIEW-2026-11-22.md](docs/REVIEW-2026-11-22.md) (Security review, 2026-11-22).

## Container user

Both containers run as the user ID and group ID of the account that ran `scripts/setup-secrets.sh` (recorded in
`.env`), not a fixed ID. This keeps the secret files mode 600 and owned by you. The runner therefore shares your
user ID, so a compromised runner has the same file access as you inside the workspace volume and the container.
Its isolation comes from the container boundary (read-only root, no capabilities, no credentials, internal
network), not from a separate user ID. Do not run the setup script as root.
