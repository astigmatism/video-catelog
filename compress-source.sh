#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(pwd)"
DEST_DIR="${1:-$ROOT_DIR}"

if [ ! -f "$ROOT_DIR/package.json" ]; then
  echo "Missing expected Node.js project file: $ROOT_DIR/package.json"
  echo "Run this script from the base folder of the project."
  exit 1
fi

mkdir -p "$DEST_DIR"

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
ZIP_NAME="video-catalog-${TIMESTAMP}.zip"
ZIP_PATH="$DEST_DIR/$ZIP_NAME"

rm -f "$ZIP_PATH"

cd "$ROOT_DIR"

zip -r "$ZIP_PATH" . \
  -x "storage/*" \
  -x ".git/*" \
  -x "node_modules/*" \
  -x "*/node_modules/*" \
  -x "dist/*" \
  -x "*/dist/*" \
  -x "build/*" \
  -x "*/build/*" \
  -x ".next/*" \
  -x "*/.next/*" \
  -x "coverage/*" \
  -x "*/coverage/*" \
  -x ".turbo/*" \
  -x "*/.turbo/*" \
  -x ".cache/*" \
  -x "*/.cache/*" \
  -x ".vite/*" \
  -x "*/.vite/*" \
  -x "*.log" \
  -x "*/.DS_Store"

echo "Created:"
echo "  $ZIP_PATH"
