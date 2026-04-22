#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  echo ".env already exists at $ENV_FILE"
  exit 0
fi

if [[ -z "${APP_PASSWORD:-}" ]]; then
  read -r -s -p "Set the application password: " APP_PASSWORD
  echo
fi

if [[ -z "$APP_PASSWORD" ]]; then
  echo "APP_PASSWORD cannot be empty."
  exit 1
fi

cat > "$ENV_FILE" <<CONFIG
APP_PASSWORD=$APP_PASSWORD
PORT=3000
HOST=0.0.0.0
COOKIE_NAME=video_catalog_session
SESSION_TTL_MINUTES=720
IDLE_LOCK_MINUTES=30
MEDIA_ROOT=./storage
DB_HOST=/var/run/postgresql
DB_PORT=5432
DB_NAME=video_catalog
DB_USER=$(whoami)
TRUST_PROXY=true
WS_HEARTBEAT_MS=30000
CONFIG

chmod 600 "$ENV_FILE"
echo "Created $ENV_FILE"
