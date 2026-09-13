"""The boundary between this app and any phone provider.

Everything above this line reasons about invoices and promises. Everything below
it reasons about calls. The engine depends on `CallPort`, so the same run works
against CALL-E or against the local simulator without changing a decision.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from kept.models import CallCycle

AMBIGUOUS_CODES = frozenset({"timeout", "connection_error"})
"""Failures that leave the provider's state unknown rather than known-bad."""

VOLATILE_METADATA_KEYS = frozenset({"run_id"})
"""Metadata that changes between runs and so cannot bind an idempotency key."""


class CallPlacementError(RuntimeError):
    """Raised when a call could not be placed or its result could not be read."""

    def __init__(self, message: str, *, code: str = "call_failed") -> None:
        super().__init__(message)
        self.code = code

    @property
    def is_ambiguous(self) -> bool:
        """True when nobody can say whether the customer's phone rang.

        A rejected request is a fact. A timeout or a dropped connection is not:
        the call may be live, so the only safe next action is to stop rather
        than start another one on top of it.
        """
        return self.code in AMBIGUOUS_CODES


@dataclass(frozen=True, slots=True)
class CallRequest:
    task: str
    phone: str
    region: str
    locale: str
    result_schema: dict[str, Any]
    idempotency_key: str
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PlacedCall:
    """The provider's terminal answer, still free of any business meaning."""

    call_id: str
    status: str
    task_completed: bool | None
    confidence: float
    structured_result: dict[str, Any] | None
    summary: str | None
    failure_code: str | None = None
    transcript: tuple[tuple[str, str], ...] = ()
    task: str = ""
    metadata: dict[str, str] = field(default_factory=dict)
    phones: tuple[str, ...] = ()

    @property
    def is_terminal_success(self) -> bool:
        """A finished call is not a done job; CALL-E reports the two separately."""
        return self.status == "completed" and self.task_completed is True


class CallPort(Protocol):
    def dispatch(self, request: CallRequest) -> str:
        """Start the call and return its id without waiting for the outcome."""
        ...

    def await_result(self, call_id: str) -> PlacedCall:
        """Poll an already-started call until it reaches a terminal state."""
        ...


def idempotency_key(
    *, invoice_id: str, cycle: CallCycle, attempt: int, payload_digest: str
) -> str:
    """Stable across retries and restarts, so a crash never dials twice.

    The key is derived from durable business identity rather than from run time,
    which is what makes replaying an interrupted run safe. The payload digest is
    part of it so a reused key can only ever return a call placed with exactly
    the instructions, recipient and schema being asked for now.
    """
    return f"kept:{invoice_id}:{cycle.value}:{attempt}:{payload_digest}"


def payload_digest(
    *,
    task: str,
    phone: str,
    region: str,
    locale: str,
    result_schema: dict[str, Any],
    metadata: dict[str, str],
) -> str:
    """Short hash of everything CALL-E will act on, minus what varies per run.

    `run_id` is excluded deliberately: it changes on every invocation, and a key
    that changes with it would stop deduplicating the crash it exists to cover.
    """
    durable = {
        key: value for key, value in metadata.items() if key not in VOLATILE_METADATA_KEYS
    }
    canonical = json.dumps(
        {
            "task": task,
            "phone": phone,
            "region": region,
            "locale": locale,
            "result_schema": result_schema,
            "metadata": durable,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def task_digest(task: str) -> str:
    """Short hash of the instructions a call was given.

    The ledger records this rather than the text, so a result recovered after
    a crash can still be proved to answer the task that was actually sent.
    """
    return hashlib.sha256(task.encode("utf-8")).hexdigest()[:16]
