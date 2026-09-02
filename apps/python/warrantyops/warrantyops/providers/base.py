"""The one shape every provider returns, real or fake."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from ..identifiers import TranscriptTurn
from ..outcome import TransportOutcome


@dataclass(frozen=True)
class CallRequest:
    """Everything needed to place one call, already authorized."""

    task: str
    recipient_e164: str
    result_schema: dict[str, Any]
    idempotency_key: str
    metadata: dict[str, str] = field(default_factory=dict)
    locale: str = "en-US"
    region: str = "US"


@dataclass(frozen=True)
class ProviderCall:
    """A terminal call as this application models it.

    ``transcript`` carries the full ordered turn list for the attempt on the
    number that was dialled, agent turns included, because a confirmation has
    to bind to the read-back it answered. It is empty when the provider exposes
    no transcript, which is a reason to refuse a confirmation, never a reason
    to assume one.
    """

    transport: TransportOutcome
    structured_result: dict[str, Any] | None
    transcript: tuple[TranscriptTurn, ...] = ()
    raw: dict[str, Any] = field(default_factory=dict)


class CallProvider(Protocol):
    """Place one call and return its terminal state."""

    name: str

    def place_call(self, request: CallRequest) -> ProviderCall:
        ...
