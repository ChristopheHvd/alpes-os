#!/usr/bin/env bash
# Render an HTML file to PDF with headless Chrome. Usage: scripts/html2pdf.sh in.html out.pdf
set -euo pipefail
IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="$2"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || true)"
[ -n "$CHROME" ] || { echo "Chrome introuvable" >&2; exit 1; }
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT" "file://$IN" 2>/dev/null
echo "OUTPUT: $OUT"
