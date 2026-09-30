"""The deterministic public receipt: one run, rendered as bounded JSON.

The receipt is the only shape this application publishes about a run. It
aliases the repository roadmap's common result fields
(``status``, ``outcome``, ``summary``, ``recording_url``, ``transcript_url``,
``external_call_id``, ``started_at``, ``completed_at``,
``recipient_phone_e164`` — masked, ``source_platform``, ``source_object_id``)
so a plugin or reviewer that only knows the roadmap's field names can read
it, and it carries the WarrantyOps-native fields the proof system needs:
evidence class, provider marker, quote spans, terminal and transport state,
``packet_sha256`` and the audit-chain head.

Three properties are structural:

* **Deterministic.** The rendering is canonical JSON over the supplied
  values; no clock, no randomness, no environment is read here. The same
  inputs render byte-identically, which is what makes proof-page
  regeneration checkable by digest.
* **Bounded.** No transcript, no raw provider payload, no secrets, no
  unmasked number. URLs are supplied facts or ``None`` — never invented.
* **Classified once.** Every receipt states exactly one evidence class and
  one provider marker. The caller supplies the class (the caller knows
  whether the run was a recorded result, a synthetic scenario replay, or a
  fictional demonstration); this module records it and refuses to combine
  classes on one receipt.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .authorization import mask_e164
from .packet import derive_packet
from .workflow import CaseRun


class EvidenceClass(str, Enum):
    """What kind of run produced this receipt. Exactly one, stated once."""

    #: A real CALL-E runtime artifact with a sanitized receipt.
    RECORDED = "Recorded CALL-E result"
    #: A recorded or scripted scenario replay through a fake provider.
    SYNTHETIC = "Synthetic scenario"
    #: A wholly invented case used to demonstrate a shape, never a runtime.
    FICTIONAL = "Fictional case data"


#: Fields aliased to the repository roadmap's common result fields. Kept as a
#: frozenset so tests can pin that the alias surface never drifts silently.
ROADMAP_ALIASES = frozenset(
    {
        "status",
        "outcome",
        "summary",
        "recording_url",
        "transcript_url",
        "external_call_id",
        "started_at",
        "completed_at",
        "recipient_phone_e164",
        "source_platform",
        "source_object_id",
    }
)


@dataclass(frozen=True)
class PublicReceipt:
    """The bounded public record of one run."""

    # Roadmap aliases — readable by anything that only knows the roadmap's
    # common field names.
    status: str
    outcome: str
    summary: str
    recipient_phone_e164: str
    source_platform: str
    source_object_id: str
    recording_url: str | None = None
    transcript_url: str | None = None
    external_call_id: str | None = None
    started_at: str | None = None
    completed_at: str | None = None

    # WarrantyOps-native fields.
    terminal_state: str = ""
    transport_state: str = ""
    claim_status: str = ""
    evidence_class: str = ""
    provider: str = ""
    quote_spans: tuple[dict[str, Any], ...] = ()
    packet_sha256: str | None = None
    goal_version: str | None = None
    audit_chain_head: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "outcome": self.outcome,
            "summary": self.summary,
            "recording_url": self.recording_url,
            "transcript_url": self.transcript_url,
            "external_call_id": self.external_call_id,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "recipient_phone_e164": self.recipient_phone_e164,
            "source_platform": self.source_platform,
            "source_object_id": self.source_object_id,
            "terminal_state": self.terminal_state,
            "transport_state": self.transport_state,
            "claim_status": self.claim_status,
            "evidence_class": self.evidence_class,
            "provider": self.provider,
            "quote_spans": [dict(span) for span in self.quote_spans],
            "packet_sha256": self.packet_sha256,
            "goal_version": self.goal_version,
            "audit_chain_head": self.audit_chain_head,
        }


def _summary(run: CaseRun) -> str:
    """One bounded line of what happened, from the run's own states."""

    if run.refusal is not None:
        reasons = ", ".join(run.refusal.reasons)
        return f"refused at {run.refusal.gate.value}: {reasons}"
    outcome = run.outcome
    if outcome is None:
        # CaseRun is exclusive: no refusal means an outcome exists. A run
        # carrying neither is malformed and must not render a receipt.
        raise ValueError("run carries neither a refusal nor an outcome")
    if outcome.business.stated_reason:
        return outcome.business.stated_reason
    return outcome.terminal_state.value


def build_receipt(
    run: CaseRun,
    *,
    recipient_e164: str,
    provider_name: str,
    evidence_class: EvidenceClass,
    source_platform: str,
    source_object_id: str,
    recording_url: str | None = None,
    transcript_url: str | None = None,
    started_at: str | None = None,
    completed_at: str | None = None,
    goal_version: str | None = None,
    audit_chain_head: str | None = None,
) -> PublicReceipt:
    """Render one run as the public receipt.

    Everything that is not on the run is a supplied fact from the caller:
    the URLs and timestamps come from provider records when they exist (and
    are ``None`` when they do not), and the evidence class comes from
    whoever knows what kind of run this was. Nothing here consults a clock,
    a network or the environment.
    """

    refused = run.refusal is not None
    outcome = run.outcome
    if refused:
        transport = None
        status = "REFUSED"
        claim_status = ""
        quote_spans: tuple[dict[str, Any], ...] = ()
        packet_sha256: str | None = None
    else:
        if outcome is None:
            # CaseRun is exclusive (see _summary); a receipt exists only for
            # a run that carries one of the two.
            raise ValueError("run carries neither a refusal nor an outcome")
        transport = outcome.transport
        status = outcome.terminal_state.value
        claim_status = outcome.business.claim_status.value
        quote_spans = tuple(dict(span) for span in outcome.business.evidence)
        packet_sha256 = derive_packet(outcome).packet_sha256

    return PublicReceipt(
        status=status,
        outcome=claim_status or ("REFUSED" if refused else "UNKNOWN"),
        summary=_summary(run),
        recipient_phone_e164=mask_e164(recipient_e164),
        source_platform=source_platform,
        source_object_id=source_object_id,
        recording_url=recording_url,
        transcript_url=transcript_url,
        external_call_id=transport.call_id if transport else None,
        started_at=started_at,
        completed_at=completed_at,
        terminal_state=status,
        transport_state=transport.state.value if transport else "NOT_ATTEMPTED",
        claim_status=claim_status,
        evidence_class=evidence_class.value,
        provider=provider_name,
        quote_spans=quote_spans,
        packet_sha256=packet_sha256,
        goal_version=goal_version,
        audit_chain_head=audit_chain_head,
    )


def render_receipt_json(receipt: PublicReceipt) -> str:
    """Canonical JSON: sorted keys, compact separators, stable bytes."""

    return json.dumps(
        receipt.to_dict(), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def receipt_sha256(receipt: PublicReceipt) -> str:
    """The digest of the rendered receipt, for regeneration checks."""

    return hashlib.sha256(render_receipt_json(receipt).encode("utf-8")).hexdigest()
