#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export PATH="$HOME/.local/bin:$PATH"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build
npm run restart:prod
pm2 save

echo "Rebuilt and restarted video-catalog with PM2."
