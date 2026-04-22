#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
TEMPLATE="$ROOT_DIR/ops/systemd/video-catalog.service.template"
TARGET="$SYSTEMD_USER_DIR/video-catalog.service"

mkdir -p "$SYSTEMD_USER_DIR"
sed "s|__WORKING_DIRECTORY__|$ROOT_DIR|g" "$TEMPLATE" > "$TARGET"

if command -v loginctl >/dev/null 2>&1; then
  sudo loginctl enable-linger "$(whoami)"
fi

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user daemon-reload
systemctl --user enable --now video-catalog.service
systemctl --user restart video-catalog.service

echo "User service installed and started: $TARGET"
