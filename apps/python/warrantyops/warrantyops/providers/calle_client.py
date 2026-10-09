"""The real CALL-E provider, written against the installed ``calle-ai`` SDK.

Every external fact used here was read from the source of ``calle-ai``
0.7.0 installed in the isolated live environment (not from prose docs
alone):

* ``CalleClient(api_key=..., base_url=..., timeout=...)`` is a context
  manager that closes its connection pool on exit;
* ``client.calls.create(*, task, recipients, result_schema, metadata,
  idempotency_key, ...)`` returns a plain ``dict`` and sends the
  idempotency key as the ``Idempotency-Key`` header;
* ``client.calls.get(call_id)`` returns a plain ``dict`` whose ``status``
  is one of ``queued``, ``in_progress``, ``completed``, ``failed``,
  ``canceled``;
* transcripts live at ``recipients[].attempts[].transcript_turns`` with
  ``speaker`` one of ``bot``, ``user``, ``unknown`` (all three appear in
  the SDK's own ``TranscriptSpeaker`` type);
* errors raised by the SDK are ``CalleAPIError`` (with ``code`` and
  ``status_code``), ``CalleTimeoutError`` and ``CalleConnectionError``.

The SDK also ships ``calls.wait_for_result``, but it sleeps on the real
clock; this adapter polls ``calls.get`` itself with an injectable clock and
sleeper, a configurable wall-clock deadline, and no invented cancellation
(no cancel operation is documented). Uncertainty — deadline, connection
failure, unrecognised status — is reported as a non-terminal transport so
the workflow marks the attempt ``UNKNOWN``; nothing here is ever retried.

The SDK requires Python 3.11+; it is imported lazily so the pure core of
this application keeps running on 3.9. The API key is read only from
``CALLE_API_KEY`` via the supplied configuration and never appears in any
error, diagnostic or log line this module produces.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from ..authorization import AuthorizationDecision
from ..config import ConfigError, RuntimeConfig, live_call_refusals
from ..identifiers import TranscriptTurn
from ..outcome import TransportOutcome, TransportState
from .base import CallRequest, ProviderCall

#: Statuses the SDK's ``CallStatus`` type treats as terminal. Polling stops
#: only on these; everything else is still in flight as far as we know.
TERMINAL_SDK_STATUSES = frozenset({"completed", "failed", "canceled"})


class LiveCallRefused(RuntimeError):
    """Raised instead of placing a call that has not cleared every gate."""


class CallCreationIncomplete(RuntimeError):
    """Creation returned no usable call id, so nothing can be tracked."""


@dataclass(frozen=True)
class PollingConfig:
    """Bounded waiting, injectable so tests run without real time.

    ``deadline_seconds`` is a wall-clock budget across the whole wait, not a
    per-request timeout; the HTTP timeout is configured on the client. When
    the deadline passes the attempt is reported non-terminal (the workflow
    marks it UNKNOWN) — the call is never cancelled, because no cancel
    operation exists.
    """

    deadline_seconds: float = 600.0
    interval_seconds: float = 3.0
    clock: Callable[[], float] = field(default_factory=lambda: _monotonic)
    sleeper: Callable[[float], None] = field(default_factory=lambda: _sleep)


def _monotonic() -> float:
    import time

    return time.monotonic()


def _sleep(seconds: float) -> None:
    import time

    time.sleep(seconds)


def _safe_diagnostics(error: BaseException) -> tuple[str, str]:
    """Diagnostic code and summary from an error, without its body.

    Uses only the exception class name and, when present, the SDK's own
    ``code`` and ``status_code`` attributes — never ``str(error)`` or
    response details, which could echo request content.
    """

    name = type(error).__name__
    code = getattr(error, "code", None)
    status = getattr(error, "status_code", None)
    label = name if not isinstance(code, str) else f"{name}:{code}"
    summary = f"call status could not be read ({label})"
    if isinstance(status, int):
        summary += f" [http {status}]"
    return label, summary


def attempt_transcript(
    payload: dict[str, Any], recipient_e164: str
) -> tuple[TranscriptTurn, ...]:
    """Return the ordered turns of the attempt on the number we dialled.

    Reading ``recipients[0]`` would be wrong for a task with several
    recipients, so this filters on the dialled number. Agent turns are kept:
    the read-back is half of the exchange a confirmation has to bind to, and
    dropping it would leave a bare "correct" attached to nothing.
    """

    turns: list[TranscriptTurn] = []
    for recipient in payload.get("recipients") or []:
        phones = recipient.get("phones") or []
        for attempt in recipient.get("attempts") or []:
            attempt_phone = attempt.get("phone")
            if attempt_phone is not None:
                if attempt_phone != recipient_e164:
                    continue
            elif recipient_e164 not in phones:
                continue
            for turn in attempt.get("transcript_turns") or []:
                text = (turn.get("text") or "").strip()
                if text:
                    turns.append(
                        TranscriptTurn(
                            speaker=turn.get("speaker") or "unknown", text=text
                        )
                    )
    return tuple(turns)


@dataclass
class CalleCallProvider:
    config: RuntimeConfig
    authorization: AuthorizationDecision
    name: str = "calle"
    calls_placed: int = 0
    #: Places real calls. The workflow refuses to run this provider against
    #: a non-durable attempt ledger: suppression that dies with the process
    #: would leave a crash followed by a second dial.
    requires_durable_ledger: bool = True
    #: Bounded waiting over ``calls.get``. Inject clock and sleeper in tests.
    polling: PollingConfig = field(default_factory=PollingConfig)
    #: Explicit per-request HTTP timeout handed to the SDK client.
    http_timeout: float = 30.0
    #: Factory used instead of constructing the SDK client (tests only).
    client_factory: Callable[[], Any] | None = None

    def _require_gates(self) -> None:
        refusals = live_call_refusals(self.config)
        if refusals:
            raise ConfigError(refusals)
        if not self.authorization.allowed:
            raise LiveCallRefused(
                "authorization gate refused: "
                + ", ".join(r.value for r in self.authorization.refusals)
            )

    def _open_client(self) -> Any:
        if self.client_factory is not None:
            return self.client_factory()
        # Imported late: the SDK needs Python 3.11+, the core does not, and
        # nothing should require it until a live call is actually attempted.
        from calle import CalleClient

        return CalleClient(
            api_key=self.config.api_key or "",
            base_url=self.config.base_url,
            timeout=self.http_timeout,
        )

    def place_call(
        self,
        request: CallRequest,
        on_call_created: Optional[Callable[[str], None]] = None,
    ) -> ProviderCall:
        self._require_gates()
        with self._open_client() as client:
            try:
                created = client.calls.create(
                    task=request.task,
                    recipients=[
                        {
                            "phones": [request.recipient_e164],
                            "locale": request.locale,
                            "region": request.region,
                        }
                    ],
                    result_schema=request.result_schema,
                    metadata=request.metadata,
                    idempotency_key=request.idempotency_key,
                )
            except Exception as error:
                # Surface only the error class, its documented code and its
                # HTTP status; the API's message body is not carried into
                # anything this application prints or stores.
                _, summary = _safe_diagnostics(error)
                raise CallCreationIncomplete(f"call creation failed: {summary}") from error
            self.calls_placed += 1
            call_id = created.get("id") if isinstance(created, dict) else None
            if not isinstance(call_id, str) or not call_id.strip():
                raise CallCreationIncomplete(
                    "CALL-E call creation returned no usable call id; the "
                    "attempt cannot be tracked or reconciled"
                )
            # Persist the correlation before the first status read, so a
            # crash from here on still leaves the id next to the durable
            # reservation.
            if on_call_created is not None:
                on_call_created(call_id)
            payload, transport = self._wait_terminal(client, call_id)
        return ProviderCall(
            transport=transport,
            structured_result=(
                payload.get("structured_result") if isinstance(payload, dict) else None
            ),
            transcript=attempt_transcript(payload, request.recipient_e164)
            if isinstance(payload, dict)
            else (),
            raw={},
        )

    def _wait_terminal(
        self, client: Any, call_id: str
    ) -> tuple[dict[str, Any] | None, TransportOutcome]:
        """Poll ``calls.get`` until a terminal status or the deadline.

        Returns ``(payload, transport)``. Every uncertain outcome — deadline
        exceeded, status read failing, a status the SDK does not document —
        returns a non-terminal transport with safe diagnostics, which the
        workflow records as an UNKNOWN attempt. Nothing is retried here
        beyond the polling itself, and creation is never repeated.
        """

        started = self.polling.clock()
        while True:
            try:
                payload = client.calls.get(call_id)
            except Exception as error:  # SDK/http errors: diagnose, stay uncertain
                code, message = _safe_diagnostics(error)
                return None, TransportOutcome(
                    state=TransportState.IN_PROGRESS,
                    call_id=call_id,
                    diagnostic_failure_code=code,
                    diagnostic_failure_message=message,
                )
            status = payload.get("status") if isinstance(payload, dict) else None
            if status in TERMINAL_SDK_STATUSES:
                return payload, TransportOutcome(
                    state=TransportState(status),
                    call_id=call_id,
                    diagnostic_failure_code=payload.get("failure_code"),
                    diagnostic_failure_message=payload.get("failure_message"),
                )
            if self.polling.clock() - started >= self.polling.deadline_seconds:
                return None, TransportOutcome(
                    state=TransportState.IN_PROGRESS,
                    call_id=call_id,
                    diagnostic_failure_code="wait_deadline_exceeded",
                    diagnostic_failure_message=(
                        f"no terminal status within {self.polling.deadline_seconds} "
                        "seconds; manual reconciliation required"
                    ),
                )
            if not isinstance(status, str) or status not in KNOWN_SDK_STATUSES:
                return None, TransportOutcome(
                    state=TransportState.IN_PROGRESS,
                    call_id=call_id,
                    diagnostic_failure_code="unrecognized_status",
                    diagnostic_failure_message=(
                        "call status read returned a value the SDK does not "
                        "document; manual reconciliation required"
                    ),
                )
            self.polling.sleeper(self.polling.interval_seconds)


#: Every status value the SDK's ``CallStatus`` type admits, terminal or not.
#: Public because the contract check reads it: it is the documented status
#: vocabulary a ``calls.get`` payload is validated against.
KNOWN_SDK_STATUSES = frozenset(
    {"queued", "in_progress", "completed", "failed", "canceled"}
)
