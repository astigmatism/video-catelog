#!/usr/bin/env bash
set -euo pipefail

DB_ROLE="${DB_ROLE:-$(whoami)}"
DB_NAME="${DB_NAME:-video_catalog}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this script as your normal Ubuntu user, not as root."
  exit 1
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}'" | grep -q 1; then
  sudo -u postgres createuser --login "$DB_ROLE"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_ROLE" "$DB_NAME"
fi

echo "PostgreSQL role '$DB_ROLE' and database '$DB_NAME' are ready."
