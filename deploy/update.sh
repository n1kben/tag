#!/usr/bin/env bash
# Pull, build and (re)start the game on the VPS. Run from the checkout: deploy/update.sh
# Restarting ends matches in progress (rooms live in memory).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

git pull --ff-only
npm ci --no-audit --no-fund
npm run build

mkdir -p ~/.config/systemd/user
cp deploy/rooftop-fu.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable rooftop-fu >/dev/null 2>&1
systemctl --user restart rooftop-fu
sleep 1
systemctl --user --no-pager --lines=3 status rooftop-fu | head -8
