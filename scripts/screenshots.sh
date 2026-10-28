#!/usr/bin/env bash
# Screenshots of the app + its real print output (Chrome --print-to-pdf -> pdftoppm).
# Usage: scripts/screenshots.sh [BASE_URL] [OUT_DIR] [PREFIX]
set -euo pipefail
BASE="${1:-http://localhost:4173/}"
OUT="${2:-docs}"
PFX="${3:-}"
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$OUT"
PROF="$(mktemp -d)"
trap 'rm -rf "$PROF"' EXIT
run() { "$CH" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$PROF/$RANDOM" --virtual-time-budget=4000 "$@" 2>/dev/null; }

run --window-size=1700,1150 --screenshot="$OUT/${PFX}app.png" "${BASE}#ex=house&view=card"
run --window-size=1700,1000 --screenshot="$OUT/${PFX}loading.png" "${BASE}#ex=house&view=load"
run --window-size=430,1400 --screenshot="$OUT/${PFX}phone.png" "${BASE}#ex=house&view=card"
for v in card labels; do
  run --no-pdf-header-footer --print-to-pdf="$PROF/$v.pdf" "${BASE}#ex=house&view=$v"
  pdftoppm -png -r 110 -f 1 -l 1 -singlefile "$PROF/$v.pdf" "$OUT/${PFX}print-$v"
done
run --no-pdf-header-footer --print-to-pdf="$PROF/gen.pdf" "${BASE}#ex=house&view=card&panel=2&size=half"
pdftoppm -png -r 110 -singlefile "$PROF/gen.pdf" "$OUT/${PFX}print-card-half-gen"
ls -la "$OUT"/${PFX}*.png
