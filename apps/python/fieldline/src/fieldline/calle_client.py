"""Call dispatchers: one interface, two transports.

`LiveCalleDispatcher` places real phone calls through the CALL-E Python
SDK (`calle-ai`), mirroring `client.calls.create_and_wait(**kwargs)`
exactly. `DemoCalleDispatcher` replays scripted calls shaped like real
terminal `call_task` objects (per the CALL-E OpenAPI spec), so the whole
product runs end-to-end with zero accounts or keys.

Going live is a transport swap only: set CALLE_API_KEY in .env, install
the `live` extra (`uv sync --extra live`), and the engine code above this
layer does not change.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

Call = dict[str, Any]
TurnCallback = Callable[[str, str], None]  # (speaker, text)


class CallDispatcher(Protocol):
    streams_transcript: bool

    def create_and_wait(self, **kwargs: Any) -> Call: ...


# ---------------------------------------------------------------------
# Live transport — the real CALL-E SDK
# ---------------------------------------------------------------------
class LiveCalleDispatcher:
    """Real calls via `calle-ai`, with timeout + one safe retry + fail-soft.

    Retries reuse the caller's `idempotency_key`, so a retried create can
    never double-dial a worker or a contact. If the platform stays
    unreachable, a synthetic `failed` call_task is returned: the protocol
    layer treats that as "could not reach" and keeps the safety cascade
    moving instead of crashing the monitor loop.
    """

    streams_transcript = False  # transcript arrives with the terminal result

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.heycall-e.com",
        call_timeout_seconds: float = 420.0,
        client: Any | None = None,  # injectable for tests
    ) -> None:
        if client is not None:
            self._client = client
            self._errors: tuple[type[Exception], ...] = (Exception,)
            return
        try:
            from calle import (  # lazy: only needed in live mode
                CalleClient,
                CalleConnectionError,
                CalleRateLimitError,
                CalleTimeoutError,
            )
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "Live mode needs the CALL-E SDK. Install it with: uv sync --extra live"
            ) from exc
        self._client = CalleClient(api_key=api_key, base_url=base_url)
        self._errors = (CalleConnectionError, CalleTimeoutError, CalleRateLimitError)
        self._call_timeout = call_timeout_seconds

    def create_and_wait(self, **kwargs: Any) -> Call:
        kwargs.setdefault("timeout_seconds", getattr(self, "_call_timeout", 420.0))
        last_error: Exception | None = None
        for attempt in (1, 2):  # one retry, made safe by the idempotency key
            try:
                return self._client.calls.create_and_wait(**kwargs)
            except self._errors as exc:
                last_error = exc
                if attempt == 1:
                    time.sleep(2.0)
        return _synthetic_failure(kwargs, last_error)


def _synthetic_failure(kwargs: dict[str, Any], error: Exception | None) -> Call:
    """Fail-soft terminal state when CALL-E is unreachable."""
    return {
        "object": "call_task",
        "id": "call_unavailable",
        "status": "failed",
        "task": kwargs.get("task", ""),
        "recipients": [],
        "structured_result": None,
        "summary": "CALL-E platform unreachable; call was not completed.",
        "task_completed": False,
        "completion_confidence": None,
        "evidence": [],
        "metadata": kwargs.get("metadata") or {},
        "failure_code": "client_unreachable",
        "failure_message": f"{type(error).__name__}: {error}" if error else "unknown error",
    }


# ---------------------------------------------------------------------
# DEMO transport — scripted calls, zero network
# ---------------------------------------------------------------------
# DEMO: everything below simulates the CALL-E platform for the offline
# demo. The dicts it returns follow the real `call_task` schema from
# https://docs.heycall-e.com/openapi/calle.openapi.yaml so the rest of
# FieldLine cannot tell the difference.
@dataclass
class DemoCallScript:
    kind: str  # "checkin" | "escalation"
    at: str  # display clock label, e.g. "14:00"
    answered: bool
    turns: list[tuple[str, str]] = field(default_factory=list)  # (speaker, text)
    structured_result: dict | None = None
    summary: str = ""
    task_completed: bool | None = None
    confidence: float | None = None
    confidence_label: str = ""
    evidence: list[str] = field(default_factory=list)


class ScriptExhaustedError(RuntimeError):
    pass


class DemoCalleDispatcher:
    """DEMO: replays scripted calls in order, streaming transcript turns."""

    streams_transcript = True

    def __init__(
        self,
        scripts: list[DemoCallScript],
        on_turn: TurnCallback | None = None,
        turn_delay: float = 1.15,
        date: str = "2026-09-05",
    ) -> None:
        self._scripts = list(scripts)
        self._cursor = 0
        self._on_turn = on_turn
        self._delay = turn_delay
        self._date = date

    def create_and_wait(self, **kwargs: Any) -> Call:
        if self._cursor >= len(self._scripts):
            raise ScriptExhaustedError("DEMO scenario has no script for this call.")
        script = self._scripts[self._cursor]
        self._cursor += 1

        # DEMO: stream the conversation for the live-demo feel.
        for speaker, text in script.turns:
            if self._on_turn:
                self._on_turn(speaker, text)
            if self._delay:
                time.sleep(self._delay)

        return self._build_call(script, kwargs)

    def _build_call(self, script: DemoCallScript, kwargs: dict[str, Any]) -> Call:
        recipient_req = kwargs.get("recipient") or {}
        phone = recipient_req.get("phone") or (recipient_req.get("phones") or ["+00000000000"])[0]
        started = f"{self._date}T{script.at}:04+03:00"
        attempt: dict[str, Any] = {
            "id": f"attempt_demo_{self._cursor:02d}",
            "phone": phone,
            "status": "completed" if script.answered else "no_answer",
            "started_at": started,
            "completed_at": f"{self._date}T{script.at}:59+03:00",
            "summary": script.summary or None,
            "transcript_turns": [
                {"offset_seconds": i * 7, "speaker": ("bot" if s == "bot" else "user"), "text": t}
                for i, (s, t) in enumerate(script.turns)
            ],
            "provider_call_id": f"demo_provider_{self._cursor:02d}",
            "failure_code": None if script.answered else "no_answer",
            "failure_message": None if script.answered else "Recipient did not answer before ring-out.",
        }
        return {
            "object": "call_task",
            "id": f"call_demo_{self._cursor:02d}",
            "status": "completed",
            "task": kwargs.get("task", ""),
            "recipients": [
                {
                    "id": f"rcpt_demo_{self._cursor:02d}",
                    "phones": [phone],
                    "locale": recipient_req.get("locale"),
                    "region": recipient_req.get("region"),
                    "status": "completed" if script.answered else "no_answer",
                    "structured_result": script.structured_result,
                    "summary": script.summary or None,
                    "attempts": [attempt],
                }
            ],
            "structured_result": script.structured_result,
            "summary": script.summary or None,
            "task_completed": script.task_completed,
            "completion_confidence": (
                {"score": script.confidence, "label": script.confidence_label or "high"}
                if script.confidence is not None
                else None
            ),
            "evidence": list(script.evidence),
            "metadata": kwargs.get("metadata") or {},
            "failure_code": None,
            "failure_message": None,
            "created_at": started,
            "completed_at": f"{self._date}T{script.at}:59+03:00",
        }
