"""Call dispatchers: one interface, two transports.

`LiveCalleDispatcher` places real phone calls through the CALL-E Python
SDK (`calle-ai`), mirroring `client.calls.create_and_wait(**kwargs)`
exactly. `DemoCalleDispatcher` replays scripted calls shaped like real
terminal `call_task` objects (per the CALL-E OpenAPI spec), so the whole
product runs end-to-end with zero accounts or keys.

Live mode requires explicit operator approval, an authorized destination
allowlist, CALLE_API_KEY, and the `live` extra (`uv sync --extra live`).
Transport ambiguity stops the run for manual reconciliation.
"""

from __future__ import annotations

import re
import time
from collections.abc import Iterable
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
OFFICIAL_BASE_URL = "https://api.heycall-e.com"
_E164 = re.compile(r"\+[1-9][0-9]{7,14}")


class UnknownCallOutcome(RuntimeError):
    """The call may exist; stop dispatching until an operator reconciles it."""


class LiveCalleDispatcher:
    """One authorized call at a time; transport ambiguity stops the run.

    No transport retry is safe to infer from a timeout: the provider may
    already have placed the call. Never manufacture a no-answer result.
    Only operator-approved ASCII E.164 destinations are permitted.
    """

    streams_transcript = False

    def __init__(
        self,
        api_key: str,
        base_url: str = OFFICIAL_BASE_URL,
        call_timeout_seconds: float = 420.0,
        client: Any | None = None,  # trusted fake injection for offline tests
        *,
        authorized_phones: Iterable[str],
    ) -> None:
        # Validate before importing or creating a credential-bearing client.
        if base_url not in (OFFICIAL_BASE_URL, OFFICIAL_BASE_URL + "/"):
            raise ValueError("Live calls require the official CALL-E HTTPS origin.")
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("CALLE_API_KEY is required for live calls.")
        if isinstance(authorized_phones, (str, bytes)):
            raise ValueError("Provide an explicit collection of authorized phones.")
        phones = frozenset(authorized_phones)
        if not phones or any(
            not isinstance(phone, str) or not _E164.fullmatch(phone) for phone in phones
        ):
            raise ValueError("Authorized destinations must be ASCII E.164 phone numbers.")
        self._authorized_phones = phones
        self._call_timeout = call_timeout_seconds
        self._stopped = False
        self._http_client: Any | None = None
        if client is not None:
            self._client = client
            return
        try:
            import httpx
            from calle import CalleClient  # lazy: only needed in live mode
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "Live mode needs the CALL-E SDK. Install it with: uv sync --extra live"
            ) from exc
        # calle-ai 0.7.0 uses this client as-is and has no SDK retry loop.
        # Never follow redirects or inherit proxy configuration with credentials.
        self._http_client = httpx.Client(
            base_url=OFFICIAL_BASE_URL,
            headers={"Authorization": f"Bearer {api_key.strip()}"},
            timeout=30.0,
            transport=httpx.HTTPTransport(retries=0, trust_env=False),
            follow_redirects=False,
            trust_env=False,
        )
        try:
            self._client = CalleClient(
                api_key=api_key.strip(),
                base_url=OFFICIAL_BASE_URL,
                http_client=self._http_client,
            )
        except Exception:
            self._http_client.close()
            raise

    def close(self) -> None:
        if self._http_client is not None:
            self._http_client.close()

    def create_and_wait(self, **kwargs: Any) -> Call:
        if self._stopped:
            raise UnknownCallOutcome("Dispatch stopped; reconcile the previous call manually.")
        recipient = kwargs.get("recipient")
        # FieldLine dispatches exactly one phone, never a provider-side cascade.
        if (
            not isinstance(recipient, dict)
            or "phones" in recipient
            or "recipients" in kwargs
            or not isinstance(recipient.get("phone"), str)
            or not _E164.fullmatch(recipient["phone"])
            or recipient["phone"] not in self._authorized_phones
        ):
            raise ValueError("Each live call must target one explicitly authorized E.164 phone.")
        if kwargs.get("webhook_url") is not None:
            raise ValueError("FieldLine does not authorize external webhook destinations.")
        kwargs.setdefault("timeout_seconds", self._call_timeout)
        try:
            call = self._client.calls.create_and_wait(**kwargs)
            if not isinstance(call, dict) or call.get("status") not in {
                "completed", "failed", "canceled"
            }:
                raise ValueError("No terminal call result.")
            return call
        except Exception:
            self._stopped = True
            # Suppress raw exception details, which can contain credentials,
            # phone numbers, URLs or provider response bodies.
            raise UnknownCallOutcome(
                "Call outcome unknown; no automatic retry or escalation. "
                "Verify the provider's call state before any further call."
            ) from None


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
