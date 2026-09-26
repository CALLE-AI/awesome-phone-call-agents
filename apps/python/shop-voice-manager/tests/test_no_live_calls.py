"""Guard: nothing in the test suite may place a real phone call.

Repository rule, and a practical one — the account has a hard call budget and a
live call reaches a real person. A test that dials would burn both silently.

Refs #19.
"""

from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
TESTS = APP_ROOT / "tests"

# Constructing a client or invoking a call. Never permitted in a test, no
# exceptions, no marker.
DIALS = re.compile(
    r"\bCalleClient\b|\bcreate_and_wait\b|\brun_call\b"
    r"|calle\s+call\s+(start|run)|--execute\b",
)

# Naming the CALL-E host. Usually a smell, but the R5 allowlist tests have to
# name it to prove untrusted hosts are refused. Those lines must say so
# explicitly with `# allow-host-literal`, which keeps the exception visible to
# a reviewer instead of silently widening the guard for everyone.
HOST = re.compile(r"api\.heycall-e\.com")
ALLOW_HOST = re.compile(r"#\s*allow-host-literal\b")


def test_no_test_file_can_place_a_call():
    offenders = []
    for path in sorted(TESTS.glob("*.py")):
        if path.name == Path(__file__).name:
            continue  # this file defines the patterns, so it always contains them
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            if DIALS.search(line):
                offenders.append(f"{path.name}:{n}: {line.strip()}")
            elif HOST.search(line) and not ALLOW_HOST.search(line):
                offenders.append(
                    f"{path.name}:{n}: names the CALL-E host without "
                    f"`# allow-host-literal`: {line.strip()}")
    assert not offenders, "tests must never place a call:\n" + "\n".join(offenders)


def test_suite_declares_no_network_dependency():
    """The app itself must stay installable and runnable with nothing extra."""
    pyproject = (APP_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "dependencies = []" in pyproject
