"""The one shape every provider returns, real or fake."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol

from ..identifiers import TranscriptTurn
from ..outcome import TransportOutcome


class RecipientRoutingError(ValueError):
    """A recipient cannot be paired with silent provider routing defaults."""


# This is an explicit allowlist, not a general routing table. CALL-E recipient
# metadata is country-shaped, so an unmatched calling code refuses before
# creation rather than inheriting US routing by accident.
_ROUTING_BY_CALLING_CODE = {
    "+1": ("US", "en-US"),
    "+44": ("GB", "en-GB"),
    "+52": ("MX", "es-MX"),
    "+91": ("IN", "en-IN"),
}

_LOCALE_RE = re.compile(r"^[a-z]{2,3}-[A-Z]{2}$")


def recipient_routing(recipient_e164: str) -> tuple[str, str]:
    """Return the CALL-E ``(region, locale)`` pair for a supported E.164."""

    number = recipient_e164.strip()
    for calling_code, routing in _ROUTING_BY_CALLING_CODE.items():
        if number.startswith(calling_code):
            return routing
    raise RecipientRoutingError(
        "recipient country is outside the explicit CALL-E routing allowlist"
    )


@dataclass(frozen=True)
class CallRequest:
    """Everything needed to place one call, already authorized."""

    task: str
    recipient_e164: str
    result_schema: dict[str, Any]
    idempotency_key: str
    locale: str
    region: str
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        expected_region, expected_locale = recipient_routing(self.recipient_e164)
        if self.locale != expected_locale or self.region != expected_region:
            raise RecipientRoutingError(
                "recipient routing metadata must match the E.164 destination: "
                f"expected region={expected_region}, locale={expected_locale}"
            )
        if _LOCALE_RE.fullmatch(self.locale) is None:
            raise RecipientRoutingError("locale must have the form language-REGION")


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

    #: Whether this provider can reach a real telephone network. A provider
    #: that can must be paired with a durable attempt ledger
    #: (:mod:`warrantyops.ledger`); the workflow refuses the pairing
    #: otherwise. Fakes declare False because no suppression they skip could
    #: ever ring a phone.
    requires_durable_ledger: bool

    def place_call(
        self,
        request: CallRequest,
        on_call_created: Optional[Callable[[str], None]] = None,
    ) -> ProviderCall:
        """Place one call and report its outcome.

        ``on_call_created``, when supplied, is invoked with the vendor's
        call id immediately after creation succeeds and before the first
        status read, so the caller can persist the correlation while the
        attempt ledger reservation is the only other durable fact. A
        provider that cannot report an id (or creates nothing) simply never
        invokes it.
        """
        ...  # pragma: no cover - a Protocol declaration
