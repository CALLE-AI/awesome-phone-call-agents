"""The canonical state machine, written down once and generated from.

The implementation does not read these tables to decide anything — the
decisions live where they always did, in :mod:`workflow`, :mod:`outcome`,
:mod:`ledger`, :mod:`review` and :mod:`writeback`. This module is the
*record* of what those decisions may produce: one transition table per
vocabulary, stated once, against which two things check themselves:

* ``docs/state-machine.md`` is generated from these tables
  (``python -m warrantyops --generate-docs``), so the published diagram can
  never drift from the code that enforces it;
* ``tests/test_state_machine.py`` runs real scenarios end to end and asserts
  every observed transition is listed here — a state change that is not in
  the table is a bug in the code or a missing row in the table, and the test
  cannot tell which, which is the point of writing it down.

Vocabularies are never mixed: a value belongs to exactly one table, and the
``∅`` source marks the start of a fresh run. Recovery is modelled as an
edge, not an exception: ``UNKNOWN`` attempts reach ``COMPLETED`` only
through a GET-only re-read performed by a human-driven reconciliation, and
never back into a reservation that could be retried. A retried claim starts
a new key and therefore a new ``∅``.
"""

from __future__ import annotations

from .contract import ClaimStatus
from .ledger import AttemptState
from .outcome import TerminalState, TransportState
from .review import ReviewDecision
from .writeback import WriteBackOutcome

START = "∅"

#: attempt ledger lifecycle — who moves an attempt and why
ATTEMPT_TRANSITIONS: dict[str, tuple[str, ...]] = {
    START: (AttemptState.RESERVED.value,),
    AttemptState.RESERVED.value: (
        AttemptState.COMPLETED.value,
        AttemptState.UNKNOWN.value,
        # self-edge: the vendor call id is persisted against the reservation
        AttemptState.RESERVED.value,
    ),
    # UNKNOWN is never retried automatically. The edge to COMPLETED exists
    # only through GET-only recovery during human reconciliation.
    AttemptState.UNKNOWN.value: (AttemptState.COMPLETED.value,),
    AttemptState.COMPLETED.value: (),
}

#: transport states as the provider reports them. The workflow observes the
#: provider once, so ``∅`` may land on any reportable state — including a
#: terminal one (a place-call that returns after the call finished) or
#: ``in_progress`` (a non-terminal return, which leaves the run in flight).
TRANSPORT_TRANSITIONS: dict[str, tuple[str, ...]] = {
    START: (
        TransportState.NOT_ATTEMPTED.value,
        TransportState.QUEUED.value,
        TransportState.IN_PROGRESS.value,
        TransportState.COMPLETED.value,
        TransportState.FAILED.value,
        TransportState.CANCELED.value,
    ),
    TransportState.NOT_ATTEMPTED.value: (),
    TransportState.QUEUED.value: (
        TransportState.IN_PROGRESS.value,
        TransportState.COMPLETED.value,
        TransportState.FAILED.value,
        TransportState.CANCELED.value,
    ),
    TransportState.IN_PROGRESS.value: (
        TransportState.COMPLETED.value,
        TransportState.FAILED.value,
        TransportState.CANCELED.value,
    ),
    TransportState.COMPLETED.value: (),
    TransportState.FAILED.value: (),
    TransportState.CANCELED.value: (),
}

#: the folded terminal classification, derived from transport + validation
TERMINAL_TRANSITIONS: dict[str, tuple[str, ...]] = {
    START: (
        TerminalState.NOT_ATTEMPTED.value,
        TerminalState.IN_FLIGHT.value,
    ),
    TerminalState.NOT_ATTEMPTED.value: (),
    TerminalState.IN_FLIGHT.value: (
        TerminalState.TRANSPORT_FAILED.value,
        TerminalState.RESULT_UNAVAILABLE.value,
        TerminalState.RESULT_INVALID.value,
        TerminalState.INFORMATION_OBTAINED.value,
        TerminalState.ACTION_REQUIRED.value,
        TerminalState.BUSINESS_UNRESOLVED.value,
        TerminalState.MENU_UNRESOLVED.value,
    ),
    TerminalState.TRANSPORT_FAILED.value: (),
    TerminalState.RESULT_UNAVAILABLE.value: (),
    TerminalState.RESULT_INVALID.value: (),
    TerminalState.INFORMATION_OBTAINED.value: (),
    TerminalState.ACTION_REQUIRED.value: (),
    TerminalState.BUSINESS_UNRESOLVED.value: (),
    TerminalState.MENU_UNRESOLVED.value: (),
}

#: what the counterparty says about the claim; STATED_* can be downgraded to
#: UNKNOWN when grounding fails, never sideways to another STATED_* value
CLAIM_TRANSITIONS: dict[str, tuple[str, ...]] = {
    START: tuple(status.value for status in ClaimStatus),
    ClaimStatus.STATED_REJECTED.value: (ClaimStatus.UNKNOWN.value,),
    ClaimStatus.STATED_RETURNED.value: (ClaimStatus.UNKNOWN.value,),
    ClaimStatus.STATED_IN_PROCESS.value: (ClaimStatus.UNKNOWN.value,),
    ClaimStatus.STATED_PAID.value: (ClaimStatus.UNKNOWN.value,),
    ClaimStatus.UNKNOWN.value: (),
}

#: the human decision between the call and any mutation
REVIEW_TRANSITIONS: dict[str, tuple[str, ...]] = {
    START: (
        ReviewDecision.APPROVE.value,
        ReviewDecision.REFUSE.value,
        ReviewDecision.RETURN_TO_DIGITAL.value,
    ),
    ReviewDecision.APPROVE.value: (WriteBackOutcome.RECEIPT.value,),
    ReviewDecision.REFUSE.value: (),
    ReviewDecision.RETURN_TO_DIGITAL.value: (),
}

#: what persisted after write-back
WRITE_BACK_TRANSITIONS: dict[str, tuple[str, ...]] = {
    START: tuple(outcome.value for outcome in WriteBackOutcome),
    WriteBackOutcome.RECEIPT.value: (
        # idempotent replay under the same review; a different review on the
        # same note identity is REVIEW_CONFLICT, never a second RECEIPT write
        WriteBackOutcome.RECEIPT.value,
        WriteBackOutcome.REVIEW_CONFLICT.value,
    ),
    WriteBackOutcome.NO_BUSINESS_RESULT.value: (),
    WriteBackOutcome.NOT_REVIEWED.value: (),
    WriteBackOutcome.SOURCE_CHANGED.value: (),
    WriteBackOutcome.REVIEW_CONFLICT.value: (),
}

TABLES: list[tuple[str, str, dict[str, tuple[str, ...]]]] = [
    ("Attempt", "the local attempt ledger", ATTEMPT_TRANSITIONS),
    ("Transport", "as the provider reports it", TRANSPORT_TRANSITIONS),
    ("Terminal", "the folded classification", TERMINAL_TRANSITIONS),
    ("Claim", "what the counterparty stated", CLAIM_TRANSITIONS),
    ("Review", "the human decision", REVIEW_TRANSITIONS),
    ("Write-back", "what persisted", WRITE_BACK_TRANSITIONS),
]


def transition_is_listed(
    table: dict[str, tuple[str, ...]], source: str, target: str
) -> bool:
    """Is this edge part of the machine? Used by the conformance tests."""

    return target in table.get(source, ())


def _terminal_members(table: dict[str, tuple[str, ...]]) -> tuple[str, ...]:
    return tuple(sorted(state for state, out in table.items() if not out and state != START))


def render_markdown() -> str:
    """The canonical ``docs/state-machine.md`` body, as a string.

    Rendered deterministically (sorted where nothing is ordered by meaning)
    so regeneration is byte-identical: the docs are a projection of code.
    """

    lines = [
        "# State machine",
        "",
        "Generated from ``warrantyops/statemachine.py`` — regenerate with",
        "``make docs`` (``python -m warrantyops --generate-docs``). Do not",
        "edit by hand; the tests assert this file matches the tables.",
        "",
        "Six vocabularies, never mixed: a value belongs to exactly one",
        "table. ``∅`` marks the start of a run. A state with no outgoing",
        "edges is terminal for that vocabulary. Recovery is an edge from",
        "``UNKNOWN`` to ``COMPLETED`` through a GET-only re-read during",
        "human reconciliation — never back into a retriable reservation;",
        "a retried claim starts a new key, therefore a new ``∅``.",
        "",
    ]
    for title, subtitle, table in TABLES:
        lines.append(f"## {title} — {subtitle}")
        lines.append("")
        for source in sorted(table):
            targets = table[source]
            label = "*start*" if source == START else source
            if not targets:
                lines.append(f"- `{label}` — terminal")
            elif source == START:
                lines.append(f"- `{label}` → {' / '.join(f'`{t}`' for t in targets)}")
            else:
                lines.append(f"- `{label}` → {' / '.join(f'`{t}`' for t in targets)}")
        terminal = _terminal_members(table)
        if terminal:
            lines.append("")
            lines.append(f"Terminal: {', '.join(f'`{t}`' for t in terminal)}.")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
