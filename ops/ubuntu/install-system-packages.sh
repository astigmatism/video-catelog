#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this script as your normal Ubuntu user, not as root."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  ffmpeg \
  git \
  postgresql \
  postgresql-client \
  unzip \
  xz-utils
