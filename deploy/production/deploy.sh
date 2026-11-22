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
docker compose up -d --build
commit="$(git -C ../.. rev-parse --short HEAD)"
echo "$commit" > .deployed-commit
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8790/healthz >/dev/null 2>&1; then
    echo "production healthy at 127.0.0.1:8790 (commit $commit)"
    exit 0
  fi
  sleep 2
done
echo "production did not answer /healthz on 127.0.0.1:8790 in time; check: docker compose logs app" >&2
exit 1
