#!/usr/bin/env sh
# Everything that must be green before pushing. No credentials, no calls, no network.
#
#   ./check.sh
#   ln -s ../../check.sh .git/hooks/pre-push
#
# Refs #24.
set -e

APP=apps/python/shop-voice-manager

# Prefer a local virtualenv so the hook works whether or not it is activated.
if [ -n "$PYTHON" ]; then       PY="$PYTHON"
elif [ -x .venv/bin/python ]; then  PY=.venv/bin/python
else                            PY=python3
fi

echo "1/3  repository validation"
$PY scripts/validate_repository.py

echo "2/3  fixture validation"
$PY $APP/fixtures/validate_fixtures.py

echo "3/3  tests"
if $PY -c "import pytest" 2>/dev/null; then
  $PY -m pytest $APP/tests
else
  echo "     pytest not installed — skipping."
  echo "     pip install -r $APP/requirements-dev.txt"
  exit 1
fi

echo
echo "All green."
