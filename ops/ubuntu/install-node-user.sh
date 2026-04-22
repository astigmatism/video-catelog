#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-24.14.1}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)
    NODE_ARCH="x64"
    ;;
  aarch64)
    NODE_ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

INSTALL_ROOT="$HOME/.local"
BIN_DIR="$HOME/.local/bin"
TMP_DIR="$(mktemp -d)"
TARBALL="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"
curl -fsSL "$URL" -o "$TMP_DIR/$TARBALL"
tar -xJf "$TMP_DIR/$TARBALL" -C "$INSTALL_ROOT"
ln -sfn "$INSTALL_ROOT/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node" "$BIN_DIR/node"
ln -sfn "$INSTALL_ROOT/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/npm" "$BIN_DIR/npm"
ln -sfn "$INSTALL_ROOT/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/npx" "$BIN_DIR/npx"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.profile" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.profile"
fi

rm -rf "$TMP_DIR"

echo "Node.js installed to $INSTALL_ROOT and linked into $BIN_DIR"
