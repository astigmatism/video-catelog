#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(pwd)"
DEST_DIR="${1:-$ROOT_DIR}"

SERVER_DIR="$ROOT_DIR/apps/server"
WEB_DIR="$ROOT_DIR/apps/web"

if [ ! -d "$SERVER_DIR" ]; then
  echo "Missing expected directory: $SERVER_DIR"
  exit 1
fi

if [ ! -d "$WEB_DIR" ]; then
  echo "Missing expected directory: $WEB_DIR"
  exit 1
fi

mkdir -p "$DEST_DIR"

rm -f "$DEST_DIR/server.zip" "$DEST_DIR/web.zip"

cd "$SERVER_DIR"
zip -r "$DEST_DIR/server.zip" . \
  -x "dist/*"

cd "$WEB_DIR"
zip -r "$DEST_DIR/web.zip" . \
  -x "dist/*" \
  -x "node_modules/*"

cd "$ROOT_DIR"

echo "Created:"
echo "  $DEST_DIR/server.zip"
echo "  $DEST_DIR/web.zip"