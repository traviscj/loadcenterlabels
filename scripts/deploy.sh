#!/usr/bin/env bash
# Test, build and publish to https://tcj.io/loadcenterlabels/ (static files on noether).
# Usage: scripts/deploy.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="traviscj@tcj.io:/var/www/tcj.io/loadcenterlabels/"
RSYNC_FLAGS=(-avz --delete --exclude '*.map')
[[ "${1:-}" == "--dry-run" ]] && RSYNC_FLAGS+=(--dry-run)

npm test
npm run build
rsync "${RSYNC_FLAGS[@]}" dist/ "$DEST"
echo "→ https://tcj.io/loadcenterlabels/"
