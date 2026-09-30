"""The typed three-surface evidence packet.

One call produces three different questions, and they are answered on three
independent surfaces:

* **Transport outcome** — what happened to the call as a call
  (:class:`warrantyops.outcome.TransportOutcome`).
* **Task-completion signal** — did the call accomplish what it was asked to
  do, separate from whether the wire worked (:class:`TaskCompletionSignal`).
* **Usable evidence** — which asserted fields survived transcript grounding
  and what exact quotes ground them (:class:`UsableEvidence`).

The surfaces are typed separately so one being incomplete cannot corrupt the
others: a completed call with no usable evidence keeps a healthy transport
surface and an honest "not accomplished" signal; a failed call keeps its
diagnostics without inventing a business result. ``derive_outcome`` in
:mod:`warrantyops.outcome` already folds transport and business state; this
module wraps that fold into the packet shape the review surface, the receipt
factory and the audit chain all consume.

The packet's ``packet_sha256`` is the canonical digest of all three surfaces.
Review decisions bind to it, receipts carry it, and a decision recorded
against a different hash is a stale-packet refusal.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .contract import ConfirmedReference
from .outcome import TerminalState, TransportOutcome, WorkflowOutcome


class TaskCompletion(str, Enum):
    """Whether the call accomplished what it was asked to do.

    This is not transport success. A call can complete on the wire and learn
    nothing (``NOT_ACCOMPLISHED``), and a call that never reached a terminal
    state cannot be judged at all (``UNKNOWN``).
    """

    ACCOMPLISHED = "ACCOMPLISHED"
    NOT_ACCOMPLISHED = "NOT_ACCOMPLISHED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class TaskCompletionSignal:
    """The task-completion surface: the signal and the reason it was set."""

    status: TaskCompletion
    reason: str

    def to_dict(self) -> dict[str, str]:
        return {"status": self.status.value, "reason": self.reason}


@dataclass(frozen=True)
class UsableEvidence:
    """The evidence surface: what survived grounding, with its quotes.

    ``complete`` is False when the evidence surface could not be derived in
    full — no transcript was exposed, or validation failed — which is a
    property of the evidence surface alone. It never implies anything about
    the transport surface.
    """

    grounded_fields: tuple[str, ...] = ()
    quote_spans: tuple[dict[str, str], ...] = ()
    confirmed_reference: ConfirmedReference | None = None
    downgrades: tuple[str, ...] = ()
    complete: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "complete": self.complete,
            "grounded_fields": list(self.grounded_fields),
            "quote_spans": [dict(span) for span in self.quote_spans],
            "confirmed_reference": (
                self.confirmed_reference.to_dict()
                if self.confirmed_reference
                else None
            ),
            "downgrades": list(self.downgrades),
        }


@dataclass(frozen=True)
class EvidencePacket:
    """The three surfaces plus the canonical digest binding them together."""

    transport: TransportOutcome
    task_completion: TaskCompletionSignal
    evidence: UsableEvidence
    packet_sha256: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "transport": self.transport.to_dict(),
            "task_completion": self.task_completion.to_dict(),
            "evidence": self.evidence.to_dict(),
        }


def packet_digest(body: dict[str, Any]) -> str:
    """The canonical digest of a packet body: sorted keys, compact separators."""

    payload = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _task_completion(outcome: WorkflowOutcome) -> TaskCompletionSignal:
    terminal = outcome.terminal_state
    if terminal is TerminalState.NOT_ATTEMPTED:
        return TaskCompletionSignal(
            status=TaskCompletion.UNKNOWN,
            reason="no call was attempted",
        )
    if terminal is TerminalState.IN_FLIGHT:
        return TaskCompletionSignal(
            status=TaskCompletion.UNKNOWN,
            reason="the call has not reached a terminal state",
        )
    if terminal is TerminalState.TRANSPORT_FAILED:
        return TaskCompletionSignal(
            status=TaskCompletion.UNKNOWN,
            reason="the call failed on the transport and cannot be judged",
        )
    if terminal in (TerminalState.INFORMATION_OBTAINED, TerminalState.ACTION_REQUIRED):
        return TaskCompletionSignal(
            status=TaskCompletion.ACCOMPLISHED,
            reason="the call produced at least one grounded, usable field",
        )
    return TaskCompletionSignal(
        status=TaskCompletion.NOT_ACCOMPLISHED,
        reason="the call reached a terminal state without usable business evidence",
    )


def derive_packet(outcome: WorkflowOutcome) -> EvidencePacket:
    """Fold a workflow outcome into the three typed surfaces.

    Each surface is derived from its own inputs. The transport surface is the
    outcome's transport record untouched; the task-completion surface reads
    only the terminal classification; the evidence surface reads only the
    grounded business result. An incomplete surface states its incompleteness
    on itself and leaves the others whole.
    """

    business = outcome.business
    grounded_fields: list[str] = []
    if business.claim_status is not None and business.claim_status.value != "UNKNOWN":
        grounded_fields.append("claim_status")
    for name, value in (
        ("stated_reason", business.stated_reason),
        ("required_correction", business.required_correction),
        ("stated_deadline", business.stated_deadline),
        ("escalation_path", business.escalation_path),
        ("stated_next_action", business.stated_next_action),
    ):
        if value:
            grounded_fields.append(name)
    if business.required_documents:
        grounded_fields.append("required_documents")
    if business.confirmed_reference is not None:
        grounded_fields.append("confirmed_reference")

    evidence = UsableEvidence(
        grounded_fields=tuple(grounded_fields),
        quote_spans=tuple(dict(span) for span in business.evidence),
        confirmed_reference=business.confirmed_reference,
        downgrades=business.downgrades,
        complete=(
            outcome.terminal_state
            in (TerminalState.INFORMATION_OBTAINED, TerminalState.ACTION_REQUIRED)
        ),
    )
    completion = _task_completion(outcome)
    transport = outcome.transport
    packet = EvidencePacket(
        transport=transport,
        task_completion=completion,
        evidence=evidence,
        packet_sha256="",
    )
    body = packet.to_dict()
    return EvidencePacket(
        transport=transport,
        task_completion=completion,
        evidence=evidence,
        packet_sha256=packet_digest(body),
    )
