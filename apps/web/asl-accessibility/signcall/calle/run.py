"""
The CALL-E adapter. `call_and_wait()` is the only function in this package that
reaches CALL-E's API; everything in workflow/ goes through it.

The SDK's `calls.create()` creates and dispatches a call in one request, so
there is no separate plan/run step. The SDK's own `wait_for_result()` treats
only {"completed", "failed", "canceled"} as terminal, which would make a call
that hits voicemail or goes unanswered poll for the full default timeout, so
`call_and_wait()` polls against a wider, case-insensitive terminal set.

Real mode needs `CALLE_API_KEY` and `SIGNCALL_TEST_LINES` (see below).
"""

from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

from . import MOCK_MODE


class CallPurpose(str, Enum):
    """What a call is for. Mock resolvers dispatch on this, never on the
    wording of the task, so a prompt can be rewritten without breaking them."""

    CLINIC_SEARCH = "clinic_search"
    CLINIC_BOOK = "clinic_book"
    CLINIC_CANCEL = "clinic_cancel"
    FAMILY_AVAILABILITY = "family_availability"
    FAMILY_CONFIRM = "family_confirm"
    FAMILY_RELEASE = "family_release"
    INTERPRETER_AVAILABILITY = "interpreter_availability"
    INTERPRETER_CONFIRM = "interpreter_confirm"
    INTERPRETER_RELEASE = "interpreter_release"


# These ring the family member's own number, as entered in the user's profile.
_FAMILY_PURPOSES = frozenset({
    CallPurpose.FAMILY_AVAILABILITY, CallPurpose.FAMILY_CONFIRM, CallPurpose.FAMILY_RELEASE,
})

# A superset of the statuses the SDK documents; extras are harmless if never returned.
TERMINAL_STATUSES = {
    "COMPLETED", "FAILED", "NO_ANSWER", "DECLINED",
    "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED",
}


@dataclass
class CallResult:
    status: str
    task_completed: bool
    completion_confidence: float
    structured_result: dict = field(default_factory=dict)
    evidence: list[str] = field(default_factory=list)
    transcript_turns: list[dict] = field(default_factory=list)


_client = None
_client_lock = threading.Lock()


def _get_client():
    global _client
    with _client_lock:  # calls can start on several threads at once
        if _client is None:
            # Imported here, not at module level: this must resolve to the real
            # SDK, which only works when the app is run as `signcall.*` from the
            # directory above signcall/ (see README, "Running the code").
            import calle as calle_sdk

            api_key = os.environ.get("CALLE_API_KEY")
            if not api_key:
                raise RuntimeError(
                    "CALLE_API_KEY is not set. Create a key in your CALL-E account "
                    "dashboard and set it before running in real mode."
                )
            _client = calle_sdk.CalleClient(api_key=api_key)
        return _client


def _extract_confidence(raw_value) -> float:
    """The live API returns {"score": ...}; accept a plain number too."""
    if isinstance(raw_value, dict):
        score = raw_value.get("score", 0.0)
        return float(score) if score is not None else 0.0
    return float(raw_value or 0.0)


def _extract_transcript_turns(raw: dict) -> list[dict]:
    """Turns live under recipients[0].attempts[-1]; empty if that path is absent."""
    recipients = raw.get("recipients") or []
    if not recipients or not isinstance(recipients[0], dict):
        return []
    attempts = recipients[0].get("attempts") or []
    if not isinstance(attempts, list) or not attempts or not isinstance(attempts[-1], dict):
        return []
    return attempts[-1].get("transcript_turns") or []


def _map_result(raw: dict) -> CallResult:
    return CallResult(
        status=str(raw.get("status", "")),
        task_completed=bool(raw.get("task_completed", False)),
        completion_confidence=_extract_confidence(raw.get("completion_confidence")),
        structured_result=raw.get("structured_result") or {},
        evidence=raw.get("evidence") or [],
        transcript_turns=_extract_transcript_turns(raw),
    )


def _poll_until_terminal(client, call_id: str, timeout_seconds: float = 600.0) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while True:
        call = client.calls.get(call_id)
        if str(call.get("status", "")).upper() in TERMINAL_STATUSES:
            return call
        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"Timed out waiting for CALL-E call {call_id} to reach a "
                f"terminal status (last seen: {call.get('status')!r})."
            )
        time.sleep(2.0)


# An account without a dedicated outbound number runs one call at a time, so
# parallel calls past the first hit CALL-E's concurrency limit. Waiting and
# retrying runs the same calls staggered instead of failing them.
CONCURRENCY_RETRY_INTERVAL_SECONDS = 10.0
CONCURRENCY_RETRY_DEADLINE_SECONDS = float(
    os.environ.get("CALLE_CONCURRENCY_RETRY_DEADLINE_SECONDS", "300")
)


def _is_concurrency_limit_error(exc: Exception) -> bool:
    # Matched on CALL-E's message text; no stable error code is documented.
    message = getattr(exc, "message", None)
    return isinstance(message, str) and "concurrency limit" in message.lower()


def _create_call_with_concurrency_retry(client, **kwargs) -> dict:
    """`calls.create()`, retrying only on the concurrency-limit error."""
    import calle as calle_sdk  # see _get_client()

    deadline = time.monotonic() + CONCURRENCY_RETRY_DEADLINE_SECONDS
    while True:
        try:
            return client.calls.create(**kwargs)
        except calle_sdk.CalleAPIError as exc:
            if not _is_concurrency_limit_error(exc) or time.monotonic() >= deadline:
                raise
            time.sleep(CONCURRENCY_RETRY_INTERVAL_SECONDS)


# --- Real-mode call routing -------------------------------------------------
#
# Clinic and interpreter numbers are never dialled directly. In real mode each
# is mapped onto one of the phones listed in SIGNCALL_TEST_LINES, which the
# operator owns. The logical recipient still drives the task text, the mock
# lookup and the evidence trail; only the number handed to the SDK changes.
# Family numbers were entered by the user in their own profile and are dialled
# as given.
#
# A recipient's line is chosen by its position within the group being called
# (the clinic list or an interpreter batch) and is then sticky, so a clinic
# searched on line 2 is booked on line 2.

TEST_LINES_ENV = "SIGNCALL_TEST_LINES"
_E164 = re.compile(r"^\+[1-9]\d{6,14}$")

_line_assignments: dict[str, str] = {}
_routing_lock = threading.Lock()

# One phone can't take two calls at once: calls to the same number queue,
# calls to different numbers run in parallel.
_dial_locks: dict[str, threading.Lock] = {}
_dial_locks_guard = threading.Lock()


class CallRoutingError(RuntimeError):
    """Raised instead of guessing a line, so a missing or malformed setting
    can't silently send calls somewhere unintended."""


def test_lines() -> tuple[str, ...]:
    """The phones real-mode calls are routed to, from SIGNCALL_TEST_LINES
    (comma-separated E.164 numbers). Read on every call so tests can change it."""
    lines = tuple(n.strip() for n in os.environ.get(TEST_LINES_ENV, "").split(",") if n.strip())
    bad = [n for n in lines if not _E164.match(n)]
    if bad:
        raise CallRoutingError(f"{TEST_LINES_ENV} has entries that are not E.164 numbers: {bad}")
    return lines


def _dial_lock(dial_target: str) -> threading.Lock:
    with _dial_locks_guard:
        return _dial_locks.setdefault(dial_target, threading.Lock())


def reset_call_routing() -> None:
    """Clears line assignments. Called at the start of every run."""
    with _routing_lock:
        _line_assignments.clear()


def resolve_dial_target(logical_phone: str, batch_position: int | None = None) -> str:
    """The number actually dialled for a clinic or interpreter: always one of
    the configured test lines, never `logical_phone`. Pure and independent of
    mock mode, so it can be tested directly."""
    with _routing_lock:
        assigned = _line_assignments.get(logical_phone)
        if assigned is not None:
            return assigned
        lines = test_lines()
        if not lines:
            raise CallRoutingError(
                f"{TEST_LINES_ENV} is not set. Real-mode clinic and interpreter calls "
                f"are only placed to phones you own: set it to one or more "
                f"comma-separated E.164 numbers."
            )
        if batch_position is None:
            raise CallRoutingError(
                f"No test line assigned for {logical_phone!r} and no batch_position "
                f"given. Every call site must pass the recipient's index within the "
                f"group it is calling the first time it reaches them."
            )
        line = lines[batch_position % len(lines)]
        _line_assignments[logical_phone] = line
        return line


def resolve_call_target(
    logical_phone: str, purpose: CallPurpose, batch_position: int | None = None
) -> str:
    """The number a real-mode call dials: the family member's own number for
    family calls, a test line for everything else."""
    if purpose in _FAMILY_PURPOSES:
        return logical_phone
    return resolve_dial_target(logical_phone, batch_position)


# --- Mock mode ----------------------------------------------------------------

MockResolver = Callable[[str, str, CallPurpose], CallResult]  # (task, phone, purpose)

_mock_resolvers: dict[str, MockResolver] = {}
_default_mock: MockResolver | None = None


def register_default_mock(resolver: MockResolver) -> None:
    """A catch-all used only when no per-number mock matches. It is registered
    per run and cleared afterwards, never at import: tests deliberately leave
    some numbers unmocked so that reaching them raises KeyError."""
    global _default_mock
    _default_mock = resolver


def clear_default_mock() -> None:
    global _default_mock
    _default_mock = None


def register_mock(phone: str, resolver: MockResolver) -> None:
    """Scripts what `phone` says when called. This is how the test harness
    exercises every workflow path without spending credits."""
    _mock_resolvers[phone] = resolver


# Appended to every call's task. Calls are billed per second and a voice agent
# left alone pads: restating questions, long thanks, small talk.
CALL_STYLE = (
    "Be brief: short sentences, no small talk, no repeating yourself. Once you "
    "have the answers asked for, thank them once and end the call immediately. "
    "Only discuss scheduling and logistics: give no medical, legal or financial "
    "advice. If the other person describes an emergency, tell them to call 911 "
    "and end the call."
)


def call_and_wait(
    task: str,
    phone: str,
    result_schema: dict | None = None,
    batch_position: int | None = None,
    *,
    purpose: CallPurpose,
) -> CallResult:
    """Place one call and block until it finishes. `phone` is the LOGICAL
    recipient (clinic, interpreter or family member). In mock mode it selects
    the scripted response; in real mode it is mapped to the number to dial by
    resolve_call_target(). `batch_position` is the recipient's index within
    its group and is required the first time they are reached.

    Safe to call from several threads: calls to different numbers run in
    parallel, calls to the same number queue."""
    task = f"{task} {CALL_STYLE}"
    if MOCK_MODE:
        resolver = _mock_resolvers.get(phone) or _default_mock
        if resolver is None:
            raise KeyError(
                f"No mock registered for {phone!r}. Call "
                f"register_mock({phone!r}, ...) in the test harness first."
            )
        return resolver(task, phone, purpose)

    client = _get_client()
    dial_target = resolve_call_target(phone, purpose, batch_position)
    with _dial_lock(dial_target):
        created = _create_call_with_concurrency_retry(
            client, task=task, recipient={"phone": dial_target}, result_schema=result_schema,
        )
        call_id = str(created["id"])
        final = _poll_until_terminal(client, call_id)
    return _map_result(final)
