#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this script as your normal Ubuntu user, not as root."
  exit 1
fi

export PATH="$HOME/.local/bin:$PATH"

if ! command -v pm2 >/dev/null 2>&1; then
  bash ops/ubuntu/install-pm2-user.sh
fi

if [[ ! -f apps/server/dist/index.js || ! -f apps/web/dist/index.html ]]; then
  echo "Build output was not found. Run npm run build before installing the PM2 service."
  exit 1
fi

sudo env PATH="$PATH" PM2_HOME="$HOME/.pm2" pm2 startup systemd -u "$(whoami)" --hp "$HOME"
npm run start:prod
pm2 save

echo "PM2 process installed and saved."
echo "Check it with: pm2 status video-catalog"
echo "Check boot integration with: systemctl status pm2-$(whoami).service"
