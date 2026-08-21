#!/usr/bin/env bash
# Deploy the Maravilla front desk and prove it is up. Never `shipway deploy`
# on its own: a green deploy with a dead site is the failure mode this file
# exists to make impossible.
set -euo pipefail
cd "$(dirname "$0")"

SITE="${1:-https://maravilla.bernardocastro.dev}"

echo "→ shipway deploy"
shipway deploy

echo
echo "→ smoke · $SITE"
node smoke.mjs "$SITE"

# React Router logs a 404 for every URL a scanner invents; that is the internet,
# not a broken deploy. Anything else in the error log is ours.
echo "→ pm2 error log"
errors=$(shipway exec 'tail -n 200 ~/.pm2/logs/maravilla-error.log 2>/dev/null' \
  | grep -E '^(Error|TypeError|ReferenceError|SyntaxError):' \
  | grep -v 'No route matches URL' || true)
if [ -n "$errors" ]; then
  echo "$errors"
  echo "  ✗ the process is writing real errors"
  exit 1
fi
echo "  ✓ nothing but 404 noise in the error log"
