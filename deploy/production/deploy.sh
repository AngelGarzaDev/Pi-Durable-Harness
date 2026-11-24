#!/usr/bin/env bash
# Deploys the production stack from the committed code on the current branch.
# Usage: deploy/production/deploy.sh          (refuses a dirty tree; builds from the working tree, which is clean)
# See docs/PRODUCTION.md. Only run this when you intend to change production.
set -euo pipefail
cd "$(dirname "$0")"
repo="$(git rev-parse --show-toplevel)"
cd "$repo"
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to deploy: the working tree has uncommitted changes. Commit first." >&2
  exit 1
fi
[ -s deploy/production/secrets/app_token ] || { echo "Missing deploy/production/secrets. See docs/PRODUCTION.md." >&2; exit 1; }
cd deploy/production
# SELinux (Enforcing here): secret files need the container label, or the containers get EACCES on /run/secrets.
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  chcon -t container_file_t secrets/* || echo "warning: could not relabel production secrets" >&2
fi
docker compose up -d --build
commit="$(git -C ../.. rev-parse --short HEAD)"
echo "$commit" > .deployed-commit
for i in $(seq 1 30); do
  if curl -fsS http://192.168.1.30:8790/healthz >/dev/null 2>&1; then
    echo "production healthy at 192.168.1.30:8790 (commit $commit)"
    exit 0
  fi
  sleep 2
done
echo "production did not answer /healthz on 192.168.1.30:8790 in time; check: docker compose logs app" >&2
exit 1
