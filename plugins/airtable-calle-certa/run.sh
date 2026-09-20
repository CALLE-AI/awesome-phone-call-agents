#!/usr/bin/env bash
# Start Certa. No arguments, no environment variables, no install.
#
# With no credentials it opens on bundled sample data and places no calls, so
# the first thing you see is the product working. Enter your Airtable and
# CALL-E keys in the panel's Setup when you are ready to use your own table.
set -euo pipefail
cd "$(dirname "$0")"

PY=""
for candidate in python3.13 python3.12 python3.11 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    PY="$candidate"; break
  fi
done

if [ -z "$PY" ]; then
  echo "Certa needs Python 3.11 or newer." >&2
  echo "macOS:  brew install python@3.12" >&2
  echo "Ubuntu: sudo apt install python3.12" >&2
  exit 1
fi

exec "$PY" -u -m certa serve --open "$@"
