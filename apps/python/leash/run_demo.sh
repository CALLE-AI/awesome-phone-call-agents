#!/bin/sh
# LEASH — reviewer entry point. One command, offline.
#
# It runs the unit tests, then five of the sixteen fake-server scenarios through
# `python3 -m leash demo`, checking each one against the exit code it should return.
#
# What it does not do: no API key is read, no phone call is placed, no credit is
# spent, and no Google credential is read, minted, refreshed or revoked — `demo`
# never opens the lease file and never contacts Google's token endpoint. Nothing
# leaves this machine: the only socket involved is a loopback one to the bundled
# fake CALL-E server in leash/fakecalle.py, which each run starts on 127.0.0.1 and
# stops again on the way out.
#
# What it writes, in full: each scenario appends to ./.leash/journal.jsonl — the
# dispatch journal, written before anything would be dialled — and pytest writes
# ./.pytest_cache. Both are gitignored. Nothing is installed and no virtualenv is
# created: if .venv already exists here it is used, otherwise python3 is used as
# found on PATH.
#
# The only subcommand run here is `demo`. The two subcommands that can dial a
# person or revoke a real credential (`live`, `prove`) are never invoked, and this
# script accepts no arguments, so nothing can be passed through to them. To run
# either one, read README.md and type the command yourself.
#
# This script's own exit codes: 0 every scenario returned the code named for it,
# 1 something did not match or the tests failed, 3 the script could not start.
# They are not the CLI's codes; those are printed at the end.

set -u

if [ "$#" -ne 0 ]; then
    echo "run_demo.sh takes no arguments; it only ever runs the offline demo." >&2
    exit 3
fi

cd "$(dirname "$0")" || exit 3

if [ -x ".venv/bin/python" ]; then
    PY=".venv/bin/python"
    echo "== Using the virtualenv already present here: $PY"
else
    PY="python3"
    if ! command -v "$PY" >/dev/null 2>&1; then
        echo "No python3 on PATH, and no .venv in this directory." >&2
        exit 3
    fi
    echo "== Using python3 from PATH. This script creates and installs nothing."
fi

if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
    echo "leash needs Python 3.11 or newer. Put one on PATH, or make a .venv here." >&2
    exit 3
fi

# leash itself imports nothing outside the standard library, so only the test
# suite needs a package installed. A missing pytest skips step 1 rather than
# stopping the run: installing it would need the network, and this script has none.
tests_ran=no
if "$PY" -c 'import pytest' >/dev/null 2>&1; then
    echo
    echo "== Step 1: the unit tests. They import leash.policy and leash.templates"
    echo "==         only: no server is started and no socket is opened."
    if ! "$PY" -m pytest -q; then
        echo "Tests failed. Stopping here." >&2
        exit 1
    fi
    tests_ran=yes
else
    echo
    echo "== Step 1 SKIPPED: pytest is not importable by $PY. Install it yourself"
    echo "==         and re-run; this script installs nothing, because installing"
    echo "==         would need the network."
fi

STEP=1
failed=0

run_scenario() {
    STEP=$((STEP + 1))
    echo
    echo "== Step $STEP: fake-server scenario '$1' — expecting exit $2 ($3)"
    "$PY" -m leash demo --scenario "$1"
    code=$?
    echo "-- '$1' exited $code, expected $2"
    if [ "$code" -ne "$2" ]; then
        echo "Unexpected exit code for '$1'." >&2
        failed=1
    fi
}

run_scenario continue_clean          0 "a person answers and confirms continue; twelve of twelve hold"
run_scenario no_answer               2 "status failed, free-form failure_code, nobody ever spoke"
run_scenario voicemail_as_completed  2 "status completed and task_completed true, with a recorded greeting where the conversation should be"
run_scenario null_extraction         2 "structured_result null for the whole object; the transcript survives it"
run_scenario contradiction           2 "eleven of twelve hold; the reason given reads as stop while the decision says continue"

echo
echo "== The CLI's exit codes: 0 the lease continues, 2 the lease was released,"
echo "== 3 operator error. Those are the CLI's, not this script's."
echo "== One of the five kept the lease: continue_clean, the only fixture in the"
echo "== set where every condition holds. The other four released it - two because"
echo "== no person was ever reached, one because extraction came back null while"
echo "== the transcript survived, and one because the caller's own reason"
echo "== disagreed with the caller's own choice."
echo "== The other eleven fixtures: $PY -m leash demo --list-scenarios"
echo "== Nothing above dialled anyone, contacted Google, or spent a credit."
if [ "$tests_ran" = no ]; then
    echo "== The test suite did not run, so nothing above says anything about it."
fi

exit "$failed"
