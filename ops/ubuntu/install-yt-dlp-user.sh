#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "$BIN_DIR/yt-dlp"
chmod 755 "$BIN_DIR/yt-dlp"

echo "yt-dlp installed to $BIN_DIR/yt-dlp"
