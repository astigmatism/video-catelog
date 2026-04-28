#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-video_catalog}"
DB_USER="${DB_USER:-$USER}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
MIGRATION_FILE="${MIGRATION_FILE:-apps/server/migrations/001_catalog_state.sql}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATION_PATH="${REPO_ROOT}/${MIGRATION_FILE}"
STORAGE_DIR="${REPO_ROOT}/storage"

if [[ ! -f "${MIGRATION_PATH}" ]]; then
  echo "Migration file not found: ${MIGRATION_PATH}" >&2
  exit 1
fi

echo "Resetting database '${DB_NAME}' as user '${DB_USER}' on ${DB_HOST}:${DB_PORT}"
echo "Using migration: ${MIGRATION_PATH}"
echo "Cleaning storage directory: ${STORAGE_DIR}"

echo "Terminating active connections..."
psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null

echo "Dropping database if it exists..."
dropdb \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  --if-exists \
  "${DB_NAME}"

echo "Creating database..."
createdb \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  "${DB_NAME}"

echo "Running migration..."
psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -v ON_ERROR_STOP=1 \
  -f "${MIGRATION_PATH}"

echo "Removing storage directory contents..."
rm -rf "${STORAGE_DIR}"

echo "Done."
psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  -c '\dt'