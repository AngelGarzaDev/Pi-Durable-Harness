#!/usr/bin/env bash
# Creates the secret files and the .env that makes the containers run as YOUR uid/gid.
# Safe to re-run: existing secret files are never overwritten.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(id -u)" -eq 0 ]; then
  echo "Do not run this as root: the containers would then run as root. Run it as your normal user." >&2
  exit 1
fi

umask 077
mkdir -p secrets

if [ ! -s secrets/anthropic_api_key ]; then
  read -rsp "Anthropic API key (starts with sk-ant-, input hidden): " key; echo
  case "$key" in sk-ant-*) ;; *) echo "Key must start with sk-ant-" >&2; exit 1 ;; esac
  printf '%s\n' "$key" > secrets/anthropic_api_key
  unset key
fi
[ -s secrets/app_token ]    || openssl rand -hex 32 > secrets/app_token
[ -s secrets/runner_token ] || openssl rand -hex 32 > secrets/runner_token

# Files are owned by you, mode 600. The containers run as your uid (below), so they can read them.
chmod 600 secrets/*

# .env holds only uid/gid numbers, no secrets. Compose reads it for the image build args.
printf 'HOST_UID=%s\nHOST_GID=%s\n' "$(id -u)" "$(id -g)" > .env

# SELinux (Fedora, Bazzite, RHEL): containers may be denied access to files in your home directory.
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ] && command -v chcon >/dev/null 2>&1; then
  chcon -t container_file_t secrets/* || echo "warning: could not relabel secrets for SELinux" >&2
fi

echo "Secrets ready in ./secrets (mode 600, owner $(id -un)). Containers will run as uid $(id -u), gid $(id -g)."
echo "Next: docker compose up -d --build"
