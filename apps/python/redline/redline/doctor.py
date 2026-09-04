"""Check the credential setup without spending anything.

The command this backs exists because of a specific, expensive mistake: finding
out your API key is wrong by placing a call. On CALL-E that costs five credits
and rings somebody's phone, and you learn nothing you could not have learned
for free.

So every check here is free, and the one that touches the network is opt-in and
read-only. Nothing in this module can place a call. There is no code path from
here to :class:`~redline.transport.live.LiveTransport`, which is checked by a
test rather than asserted in a comment.

The key itself is never printed, logged, or written to a report. Only its
prefix and last two characters appear, which is enough to tell a live key
from a test key and a stale one from a fresh one.
"""

from __future__ import annotations

import os
import re
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from redline.env import DOTENV_FILENAME, find_dotenv, load_dotenv
from redline.scope import (
    SCOPE_EXAMPLE_FILENAME,
    SCOPE_FILENAME,
    ScopeError,
    find_scope,
    load_scope,
)
from redline.transport.live import (
    API_KEY_VARIABLE,
    API_ORIGIN,
)

__all__ = ["Check", "CheckStatus", "Diagnosis", "mask_secret", "run_diagnostics"]

#: CALL-E issues keys with this shape. Checked so a typo, a truncated paste or
#: a key from another service is caught before it costs anything.
CALLE_KEY = re.compile(r"^iams_(live|test|sk)_[A-Za-z0-9_-]{8,}$")

BUDGET_VARIABLE = "REDLINE_MAX_REAL_CALLS"


class CheckStatus(StrEnum):
    OK = "ok"
    WARN = "warn"
    FAIL = "fail"


@dataclass(frozen=True, slots=True)
class Check:
    """One diagnostic, and what to do if it is unhappy."""

    name: str
    status: CheckStatus
    detail: str
    remedy: str = ""

    @property
    def failed(self) -> bool:
        return self.status is CheckStatus.FAIL


@dataclass(frozen=True, slots=True)
class Diagnosis:
    """Everything `redline doctor` found."""

    checks: tuple[Check, ...]
    dotenv_path: Path | None = None
    online: bool = False

    @property
    def failures(self) -> tuple[Check, ...]:
        return tuple(check for check in self.checks if check.failed)

    @property
    def warnings(self) -> tuple[Check, ...]:
        return tuple(c for c in self.checks if c.status is CheckStatus.WARN)

    @property
    def is_ready_for_live(self) -> bool:
        """Whether a live run could be attempted at all.

        Not a promise that one *should* be: that decision needs a budget, a
        recipient and a person.
        """
        return not self.failures


def mask_secret(value: str) -> str:
    """Show enough of a credential to recognise it, and not enough to use it.

    A live key becomes ``iams_live_...6c``. The prefix matters:
    a live key and a test key are different mistakes.
    """
    if not value:
        return "(not set)"
    prefix, separator, remainder = value.partition("_")
    if separator and "_" in remainder:
        kind, _, tail = remainder.partition("_")
        head = f"{prefix}_{kind}_"
    else:
        head, tail = "", value
    return f"{head}...{tail[-2:]}" if len(tail) >= 2 else f"{head}..."


def run_diagnostics(
    *,
    start: Path | None = None,
    online: bool = False,
) -> Diagnosis:
    """Run every check. Places no calls, spends no credits."""
    # Resolve first, then load only what was resolved. Passing None through to
    # load_dotenv would make it search again from the current directory, which
    # silently ignores `start` and can pick up an unrelated project's
    # credentials -- a test caught exactly that.
    found = find_dotenv(start)
    dotenv_path, file_values = load_dotenv(found) if found is not None else (None, {})

    checks: list[Check] = [
        _check_dotenv_present(dotenv_path, start),
        _check_dotenv_ignored(dotenv_path),
    ]

    key = os.environ.get(API_KEY_VARIABLE, "")
    checks.append(_check_key_present(key, dotenv_path, file_values))
    if key:
        checks.append(_check_key_shape(key))
        checks.append(_check_shell_override(key, file_values))

    checks.append(_check_scope(start))
    checks.append(_check_budget())

    if online and key:
        checks.append(_check_authentication(key))

    return Diagnosis(checks=tuple(checks), dotenv_path=dotenv_path, online=online)


# --- The file ----------------------------------------------------------------


def _check_dotenv_present(path: Path | None, start: Path | None) -> Check:
    if path is not None:
        return Check(
            name="env file",
            status=CheckStatus.OK,
            detail=f"read {path}",
        )
    where = (start or Path.cwd()).resolve()
    return Check(
        name="env file",
        status=CheckStatus.WARN,
        detail=f"no {DOTENV_FILENAME} found at or above {where}",
        remedy=(
            f"cp .env.example {DOTENV_FILENAME} and fill in "
            f"{API_KEY_VARIABLE}. Not needed for the default static transport."
        ),
    )


def _check_dotenv_ignored(path: Path | None) -> Check:
    """Ask git, rather than reading .gitignore and hoping.

    The question that matters is not "does a rule exist" but "would this exact
    file be committed", and only git can answer that.
    """
    if path is None:
        return Check(
            name="env file ignored",
            status=CheckStatus.OK,
            detail="no env file to protect",
        )

    try:
        result = subprocess.run(
            ["git", "check-ignore", "-q", str(path)],
            cwd=path.parent,
            capture_output=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return Check(
            name="env file ignored",
            status=CheckStatus.WARN,
            detail="could not ask git whether the file is ignored",
            remedy=f"Check by hand: git check-ignore -v {path.name}",
        )

    if result.returncode == 0:
        return Check(
            name="env file ignored",
            status=CheckStatus.OK,
            detail=f"git ignores {path.name}, and the pre-commit hook "
            "refuses it by name",
        )
    return Check(
        name="env file ignored",
        status=CheckStatus.FAIL,
        detail=f"git does NOT ignore {path}",
        remedy=(
            f"Add {DOTENV_FILENAME} to .gitignore before doing anything else. "
            "A credential in the history needs a history rewrite."
        ),
    )


# --- The key ------------------------------------------------------------------


def _check_key_present(
    key: str, dotenv_path: Path | None, file_values: dict[str, str] | object
) -> Check:
    if key:
        return Check(
            name="api key",
            status=CheckStatus.OK,
            detail=f"{API_KEY_VARIABLE} is set ({mask_secret(key)})",
        )

    if isinstance(file_values, dict) and API_KEY_VARIABLE in file_values:
        return Check(
            name="api key",
            status=CheckStatus.FAIL,
            detail=f"{API_KEY_VARIABLE} is present in {dotenv_path} but empty",
            remedy="Paste the key after the '=' with no quotes and no spaces.",
        )

    return Check(
        name="api key",
        status=CheckStatus.FAIL,
        detail=f"{API_KEY_VARIABLE} is not set",
        remedy=(
            f"Add {API_KEY_VARIABLE}=... to {DOTENV_FILENAME}. "
            "Only --live needs it; static and replay do not."
        ),
    )


def _check_key_shape(key: str) -> Check:
    if CALLE_KEY.match(key):
        kind = key.split("_")[1]
        return Check(
            name="api key format",
            status=CheckStatus.OK,
            detail=f"looks like a CALL-E {kind} key",
        )
    if key.startswith(("sk-", "pk_", "AKIA")):
        return Check(
            name="api key format",
            status=CheckStatus.FAIL,
            detail="that looks like a key for a different service",
            remedy="CALL-E keys start with iams_live_ or iams_test_.",
        )
    return Check(
        name="api key format",
        status=CheckStatus.WARN,
        detail="does not match the expected iams_live_/iams_test_ shape",
        remedy=(
            "Check for a truncated paste or a stray quote. Run with --online "
            "to find out whether CALL-E accepts it."
        ),
    )


def _check_shell_override(key: str, file_values: object) -> Check:
    """Catch the genuinely baffling case: right file, wrong value in use."""
    if not isinstance(file_values, dict):
        return Check(name="key source", status=CheckStatus.OK, detail="")
    from_file = file_values.get(API_KEY_VARIABLE)
    if from_file and from_file != key:
        return Check(
            name="key source",
            status=CheckStatus.WARN,
            detail=(
                "your shell already exports a different "
                f"{API_KEY_VARIABLE}, and it wins over the file"
            ),
            remedy=f"unset {API_KEY_VARIABLE} to use the value in your .env",
        )
    return Check(
        name="key source",
        status=CheckStatus.OK,
        detail="the value in use is the one in your env file"
        if from_file
        else "taken from the shell environment",
    )


# --- The guard rails ----------------------------------------------------------


def _check_scope(start: Path | None) -> Check:
    """Report on the written authorisation, without reading a number aloud.

    Absent is a warning rather than a failure: the offline path is the normal
    path, and most people running `doctor` have no intention of dialling
    anything. Present-but-invalid is a failure, because a file that looks like
    an authorisation and is not one is worse than no file.
    """
    path = find_scope(start or Path.cwd())
    if path is None:
        return Check(
            name="call scope",
            status=CheckStatus.WARN,
            detail=f"no {SCOPE_FILENAME}",
            remedy=(
                f"Needed only for --live. Copy {SCOPE_EXAMPLE_FILENAME} and "
                "fill it in: who authorised the test, how to reach them, when "
                "it expires, and the exact numbers."
            ),
        )

    try:
        scope = load_scope(path)
    except ScopeError as error:
        return Check(
            name="call scope",
            status=CheckStatus.FAIL,
            detail=str(error).replace(chr(10), " "),
            remedy=f"Fix {path.name}. Until then --live will refuse to dial.",
        )

    # Numbers are never printed, not even masked -- the count and the owners
    # are what a reader needs, and the file is on their disk if they want more.
    return Check(
        name="call scope",
        status=CheckStatus.OK,
        detail=(
            f"{len(scope.targets)} number(s), authorised by "
            f"{scope.authorised_by}, until {scope.expires.isoformat()}"
        ),
    )


def _check_budget() -> Check:
    raw = os.environ.get(BUDGET_VARIABLE, "0")
    try:
        budget = int(raw)
    except ValueError:
        return Check(
            name="call budget",
            status=CheckStatus.FAIL,
            detail=f"{BUDGET_VARIABLE}={raw!r} is not a number",
            remedy=f"Set {BUDGET_VARIABLE} to an integer, or remove it.",
        )

    if budget <= 0:
        return Check(
            name="call budget",
            status=CheckStatus.OK,
            detail="no real calls permitted (this is the safe default)",
        )
    return Check(
        name="call budget",
        status=CheckStatus.WARN,
        detail=f"up to {budget} real call(s) permitted, at 5 credits each",
        remedy=(
            "Each live run still needs --budget and --recipient on the command "
            "line, and confirms before every single call."
        ),
    )


# --- The one check that touches the network ----------------------------------


def _check_authentication(key: str) -> Check:
    """Ask CALL-E whether the key works, without asking it to do anything.

    ``GET /v1/goals`` is a read. It places no call, consumes no credits, and
    nobody's phone rings. It is the cheapest possible question that
    distinguishes "this key is wrong" from "this key is fine".
    """
    try:
        from calle import CalleClient
    except ImportError:  # pragma: no cover - the SDK is a declared dependency
        return Check(
            name="authentication",
            status=CheckStatus.WARN,
            detail="the calle-ai SDK is not installed",
            remedy="pip install -e .",
        )

    # No `base_url`: the key can only ever travel to the official origin.
    client = CalleClient(api_key=key)
    try:
        client.goals.list(limit=1)
    except Exception as error:
        return _authentication_failure(error)
    finally:
        client.close()

    return Check(
        name="authentication",
        status=CheckStatus.OK,
        detail=f"{API_ORIGIN} accepted the key (read-only, no call placed)",
    )


def _authentication_failure(error: Exception) -> Check:
    from redline.redact import redact

    message = redact(str(error))
    lowered = message.lower()

    if "401" in message or "unauthor" in lowered:
        return Check(
            name="authentication",
            status=CheckStatus.FAIL,
            detail="CALL-E rejected the key",
            remedy=(
                "Check for a truncated paste. Generate a fresh key at "
                "https://dashboard.heycall-e.com/ if in doubt."
            ),
        )
    if "403" in message or "forbidden" in lowered:
        return Check(
            name="authentication",
            status=CheckStatus.FAIL,
            detail="the key authenticated but is not allowed to list goals",
            remedy="Check the key's scope in the dashboard.",
        )
    return Check(
        name="authentication",
        status=CheckStatus.WARN,
        detail=f"could not reach CALL-E: {message}",
        remedy="This may be a network problem rather than a key problem.",
    )


def summarise(checks: Sequence[Check]) -> str:
    failed = sum(1 for check in checks if check.failed)
    warned = sum(1 for c in checks if c.status is CheckStatus.WARN)
    parts = [f"{len(checks) - failed - warned}/{len(checks)} ok"]
    if warned:
        parts.append(f"{warned} to look at")
    if failed:
        parts.append(f"{failed} to fix")
    return " - ".join(parts)
