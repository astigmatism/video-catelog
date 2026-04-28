#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this bootstrap as your normal Ubuntu user, not as root."
  exit 1
fi

bash ops/ubuntu/install-system-packages.sh
bash ops/ubuntu/install-node-user.sh
bash ops/ubuntu/install-pm2-user.sh
bash ops/ubuntu/install-yt-dlp-user.sh
bash ops/ubuntu/setup-postgres-local.sh
APP_PASSWORD="${APP_PASSWORD:-}" bash ops/ubuntu/create-env.sh

export PATH="$HOME/.local/bin:$PATH"
mkdir -p storage/uploads/incoming storage/uploads/tmp storage/media storage/thumbs storage/previews storage/catalog
if [[ ! -f storage/catalog/items.json ]]; then
  printf '[]\n' > storage/catalog/items.json
fi

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build
bash ops/ubuntu/install-user-service.sh

echo
echo "Bootstrap complete."
echo "Use: pm2 status video-catalog"
echo "Logs: pm2 logs video-catalog"
echo "Boot service: systemctl status pm2-$(whoami).service"
