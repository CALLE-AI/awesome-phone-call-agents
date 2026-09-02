"""The real CALL-E provider.

It is written, it is not exercised by the test suite, and it refuses to run
until every gate in :mod:`warrantyops.config` and
:mod:`warrantyops.authorization` has passed. The SDK import happens inside the
call so that installing this application never requires it.

Verified against the CALL-E Developer API reference: ``POST /v1/calls`` with an
``Idempotency-Key`` header, ``result_schema`` validated server-side before a
terminal call is returned, ``structured_result`` null when no schema-valid
result could be produced, ``failure_code`` a nullable string with no published
enum, and attempt transcripts at
``recipients[].attempts[].transcript_turns`` whose turns carry ``speaker``
values of ``bot``, ``user`` or ``unknown``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..authorization import AuthorizationDecision
from ..config import ConfigError, RuntimeConfig, live_call_refusals
from ..identifiers import TranscriptTurn
from ..outcome import TransportOutcome, TransportState
from .base import CallRequest, ProviderCall


class LiveCallRefused(RuntimeError):
    """Raised instead of placing a call that has not cleared every gate."""


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
                        TranscriptTurn(speaker=turn.get("speaker") or "unknown", text=text)
                    )
    return tuple(turns)


@dataclass
class CalleCallProvider:
    config: RuntimeConfig
    authorization: AuthorizationDecision
    name: str = "calle"
    calls_placed: int = 0

    def _client(self) -> Any:
        refusals = live_call_refusals(self.config)
        if refusals:
            raise ConfigError(refusals)
        if not self.authorization.allowed:
            raise LiveCallRefused(
                "authorization gate refused: "
                + ", ".join(r.value for r in self.authorization.refusals)
            )
        from calle import CalleClient  # imported late: only needed for live calls

        return CalleClient(api_key=self.config.api_key, base_url=self.config.base_url)

    def place_call(self, request: CallRequest) -> ProviderCall:
        client = self._client()
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
        self.calls_placed += 1
        terminal = client.calls.wait_for_result(created.id)
        payload = terminal if isinstance(terminal, dict) else terminal.__dict__
        return ProviderCall(
            transport=TransportOutcome(
                state=TransportState(payload.get("status", "failed")),
                call_id=payload.get("id"),
                diagnostic_failure_code=payload.get("failure_code"),
                diagnostic_failure_message=payload.get("failure_message"),
            ),
            structured_result=payload.get("structured_result"),
            transcript=attempt_transcript(payload, request.recipient_e164),
            raw={},
        )
