"""CALL-E integration using the official ``calle-ai`` Python SDK.

This module replaces the earlier raw-HTTP client with the official CALL-E SDK.
Authentication is handled by the SDK via ``CalleClient(api_key=...)``, which
reads the key from the ``CALLE_API_KEY`` environment variable.

The core call is placed with::

    call = client.calls.create_and_wait(
        task=task_prompt,          # built from prompts.py TASK_TEMPLATE
        result_schema=RESULT_SCHEMA,
    )

The returned ``call`` dict exposes (among others):
    call["status"]                 # e.g. "completed", "failed", "no_answer"
    call["structured_result"]      # the parsed JSON per result_schema
    call["task_completed"]         # bool
    call["completion_confidence"]  # float
    call["evidence"]               # transcript / supporting detail

We map ``call["structured_result"]`` onto our :class:`CallOutcome` the same way
the old code mapped the raw API response, so ``db.py`` / ``scheduler.py`` /
``report.py`` are unaffected.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional

try:
    from calle import CalleClient
except ImportError:  # pragma: no cover - surfaced clearly at runtime
    CalleClient = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Call statuses returned by the SDK. A call is "final" once it reaches one of
# these and ``create_and_wait`` has returned.
# ---------------------------------------------------------------------------
CALL_COMPLETED = "completed"
CALL_FAILED = "failed"
CALL_NO_ANSWER = "no_answer"

FINAL_STATUSES = {CALL_COMPLETED, CALL_FAILED, CALL_NO_ANSWER}


class CallError(Exception):
    """Raised when CALL-E rejects or fails a call request."""


class CallTimeoutError(CallError):
    """Raised when a call does not yield a usable result in time."""


@dataclass
class CallOutcome:
    """The parsed, structured result of a single confirmation call.

    Mirrors the fields the rest of the app expects (unchanged from before), so
    ``db.py`` / ``scheduler.py`` / ``report.py`` need no changes.
    """

    outcome: str = "unknown"  # confirmed | rescheduled | cancelled | no_answer | unknown
    new_datetime: Optional[str] = None
    cancel_reason: Optional[str] = None
    call_id: str = ""
    status: str = ""
    raw_result: dict = field(default_factory=dict)

    @classmethod
    def from_sdk(cls, call: dict) -> "CallOutcome":
        """Build a :class:`CallOutcome` from the SDK's ``call`` dict.

        Args:
            call: The dict returned by ``client.calls.create_and_wait(...)``.

        Returns:
            A normalised :class:`CallOutcome`. If the call never connected
            (no answer / failed) or the structured result is missing, sensible
            defaults are used so downstream code never has to handle ``None``.
        """
        status = str(call.get("status", "")).lower()
        result = call.get("structured_result") or {}

        if isinstance(result, str):  # tolerate a JSON-encoded result string
            try:
                result = json.loads(result)
            except (ValueError, TypeError):
                result = {}

        norm = result.get("outcome") or "unknown"

        # If the call never connected, force the outcome to something useful.
        if status in (CALL_NO_ANSWER, CALL_FAILED):
            norm = "no_answer"

        return cls(
            outcome=norm,
            new_datetime=result.get("new_datetime"),
            cancel_reason=result.get("cancel_reason"),
            call_id=str(call.get("call_id") or call.get("id") or ""),
            status=status,
            raw_result=dict(result),
        )


class CallAgent:
    """Thin wrapper around the official :class:`CalleClient`.

    Args:
        api_key: Optional CALL-E API key. Defaults to the ``CALLE_API_KEY``
            environment variable (which the SDK also reads directly).
    """

    def __init__(self, api_key: Optional[str] = None):
        if CalleClient is None:
            raise CallError(
                "The `calle` SDK is not installed. Run `pip install calle-ai`."
            )
        key = api_key or os.environ.get("CALLE_API_KEY", "")
        if not key:
            raise CallError(
                "CALLE_API_KEY is required. Set it in your .env file or export it."
            )
        self.api_key = key
        self.client = CalleClient(api_key=key)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def create_and_wait(
        self,
        task: str,
        result_schema: dict | None = None,
        *,
        recipient: dict | None = None,
        metadata: dict | None = None,
        webhook_url: str | None = None,
        idempotency_key: str | None = None,
    ) -> CallOutcome:
        """Create a confirmation call and block until the result is ready.

        All keyword arguments are forwarded to the SDK's
        ``client.calls.create_and_wait(...)`` (which passes them to ``create``),
        so recipient, metadata, webhook and idempotency are used when the SDK
        supports them.

        Args:
            task: The rendered agent prompt for this call (from ``prompts.py``).
            result_schema: Optional JSON schema for the structured result.
                Defaults to :data:`prompts.RESULT_SCHEMA`.
            recipient: Recipient dict (e.g. ``{"phone": ...}``).
            metadata: App metadata (e.g. appointment id).
            webhook_url: Optional result webhook.
            idempotency_key: Optional idempotency key.

        Returns:
            A parsed :class:`CallOutcome`.

        Raises:
            CallError: On any SDK/API failure.
        """
        from . import prompts

        schema = result_schema or prompts.RESULT_SCHEMA
        kwargs: dict = {"task": task, "result_schema": schema}
        if recipient:
            kwargs["recipient"] = recipient
        if metadata:
            kwargs["metadata"] = metadata
        if webhook_url:
            kwargs["webhook_url"] = webhook_url
        if idempotency_key:
            kwargs["idempotency_key"] = idempotency_key

        try:
            call = self.client.calls.create_and_wait(**kwargs)
        except Exception as exc:  # SDK/network/API errors
            raise CallError(f"CALL-E SDK call failed: {exc}") from exc

        if not isinstance(call, dict):
            raise CallError(f"CALL-E returned an unexpected payload: {call!r}")

        return CallOutcome.from_sdk(call)


# ---------------------------------------------------------------------------
# Convenience wrapper used by the CLI.
# ---------------------------------------------------------------------------
def place_confirmation_call(
    phone: str,
    date: str,
    time: str,
    service: str,
    appointment_id: str,
    settings: Any = None,
    idempotency_key: Optional[str] = None,
) -> CallOutcome:
    """Place a confirmation call via the SDK and wait for its structured result.

    Args:
        phone: Recipient phone number (kept for traceability/metadata).
        date / time / service: Appointment details used to render the task prompt.
        appointment_id: Stable identifier used for logging.
        settings: Optional :class:`Settings` (only used for the API key).
        idempotency_key: Optional explicit key (informational; the SDK manages
            idempotency per call).

    Returns:
        The parsed :class:`CallOutcome`.
    """
    from . import prompts

    api_key = None
    if settings is not None:
        api_key = getattr(settings, "calle_api_key", None)
    agent = CallAgent(api_key=api_key)
    task = prompts.build_task(date, time, service)
    return agent.create_and_wait(
        task=task,
        result_schema=prompts.RESULT_SCHEMA,
        recipient={"phone": phone},
        metadata={"appointment_id": appointment_id},
        idempotency_key=idempotency_key or f"apt-{appointment_id}",
    )
