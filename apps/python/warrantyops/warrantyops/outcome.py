"""Transport state and business state are different questions.

CALL-E reports whether a call happened. It does not report whether anything
was learned about a claim, and the documentation is explicit that the Calls
API does not currently guarantee a distinct no-answer or decline value, so a
failed call must leave the business result unresolved rather than infer one.

The rule this module enforces is that no transport state can ever produce a
business assertion. A call nobody answered is ``UNKNOWN`` status, never
``STATED_REJECTED``.

After a completed, schema-valid call, four more controls run here:

* enum values need an evidence quote that is itself grounded in a
  counterparty turn;
* a status whose evidence quote carries a known hedge cannot become a
  definitive business status and is reduced to ``UNKNOWN``;
* a confirmed reference needs its own grounded evidence — a counterparty
  utterance establishing the complete value, or the read-back exchange
  that put the complete value in front of the counterparty — and without
  either it stays an unconfirmed candidate;
* free-text values need to be grounded in a counterparty turn verbatim
  enough to be found by containment (:mod:`warrantyops.evidence`);
* a claim/case/credit reference is asserted only from its own read-back
  exchange (:mod:`warrantyops.identifiers`).

Anything that fails a control is dropped with a named downgrade, and the
result still distinguishes not-stated (field omitted) from stated-but-not-
established (``UNKNOWN`` / downgrade note) from malformed (validation error).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .contract import (
    CONTRACT_VERSION,
    STATED_TEXT_FIELDS,
    ClaimResult,
    ClaimStatus,
    ConfirmedReference,
    ReferenceKind,
    unresolved_result,
)
from .evidence import is_grounded_in_counterparty_turn
from .identifiers import (
    COUNTERPARTY_SPEAKER,
    IdentifierClaim,
    IdentifierDecision,
    IdentifierRefusal,
    IdentifierState,
    TranscriptTurn,
    _matching_turn_indices,
    _preceding_readback,
    _tokens_to_digits,
    digit_runs,
    digits_of,
    evaluate_identifier,
    fold_text,
)
from .validation import ValidationResult


class TransportState(str, Enum):
    """The CALL-E call lifecycle, plus the state before anything was sent."""

    NOT_ATTEMPTED = "NOT_ATTEMPTED"
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


TERMINAL_TRANSPORT_STATES = frozenset(
    {TransportState.COMPLETED, TransportState.FAILED, TransportState.CANCELED}
)


class TerminalState(str, Enum):
    """What this workflow concluded, once nothing more will change."""

    NOT_ATTEMPTED = "NOT_ATTEMPTED"
    IN_FLIGHT = "IN_FLIGHT"
    TRANSPORT_FAILED = "TRANSPORT_FAILED"
    RESULT_UNAVAILABLE = "RESULT_UNAVAILABLE"
    RESULT_INVALID = "RESULT_INVALID"
    INFORMATION_OBTAINED = "INFORMATION_OBTAINED"
    ACTION_REQUIRED = "ACTION_REQUIRED"
    BUSINESS_UNRESOLVED = "BUSINESS_UNRESOLVED"
    MENU_UNRESOLVED = "MENU_UNRESOLVED"


#: Terminal states whose business result may be written back after review.
#: A transport failure, a null result, an invalid result, an unresolved menu
#: and an empty result all stay local.
WRITE_BACK_ELIGIBLE_STATES = frozenset(
    {TerminalState.INFORMATION_OBTAINED, TerminalState.ACTION_REQUIRED}
)

#: The one validation error that means the provider returned *no* structured
#: result at all. Every other validation failure means a result came back and
#: is not assertable — a different terminal state, because a present-but-
#: invalid result is a provider-shape finding, not an absence of evidence.
_NULL_RESULT_ERROR = "structured_result is null"


@dataclass(frozen=True)
class MenuNavigation:
    """What evidence said about a supplied bounded keypad plan.

    A keypad plan is optional and, when one was supplied, the adapter that
    watched the call reports whether the menu it navigated was resolved.
    ``resolved`` is ``None`` when no evidence stated either way — the same
    honesty rule as everywhere else: unstated stays unstated, and an
    unresolved-menu conclusion is never inferred from a transport signal.
    """

    plan_supplied: bool
    resolved: bool | None = None


#: Phrases that make a status statement non-final, in folded form (lowercase,
#: punctuation collapsed to spaces, so ``I'm`` matches ``i m``). Two families,
#: both about the *current* status the enum asserts: uncertainty about the
#: record the representative is reading ("i think", "as far as i know") and a
#: projected state that has not happened yet ("should be", "will be").
#:
#: This is a deterministic backstop behind the schema instruction to use
#: ``UNKNOWN`` for anything hedged, not a linguistic claim: a closed lexicon
#: cannot detect every hedge in English, and it does not try. What it does
#: guarantee is that the hedges it does recognize can never survive as a
#: definitive business status, whatever the model returned. Unknown-to-this-
#: list hedges still have to pass transcript grounding; when in doubt the
#: reviewer sees the quote and the downgrade note together.
STATUS_HEDGE_PHRASES = (
    "i think",
    "i believe",
    "i guess",
    "i suspect",
    "i assume",
    "i expect",
    "i would say",
    "i m not sure",
    "not sure",
    "probably",
    "presumably",
    "possibly",
    "maybe",
    "might",
    "perhaps",
    "likely",
    "should be",
    "should show",
    "would be",
    "will be",
    "looks like",
    "looks as if",
    "appears",
    "seems",
    "as far as i know",
    "as far as i can see",
    "as far as i can tell",
    "last i checked",
    "can t see",
    "cannot see",
    "couldn t say",
)


def status_quote_is_hedged(quote: str | None) -> bool:
    """True when the status evidence quote contains a known non-final phrase."""

    folded = fold_text(quote or "")
    return any(phrase in folded for phrase in STATUS_HEDGE_PHRASES)


#: How a confirmed reference is evidenced. A bare "Yes." is never shown
#: alone: either the counterparty named the value themselves, or the value
#: appears in the read-back the affirmative answered, and both turns of that
#: pair are preserved.
REFERENCE_METHOD_DIRECT = "DIRECT_COUNTERPARTY_QUOTE"
REFERENCE_METHOD_READBACK = "CONFIRMED_BY_READBACK"

#: Spoken separator words with no reference content. They are dropped from
#: the canonical comparison space so "B R dash four eight two one" and
#: "BR-4821" land on the same string; nothing else is normalized away.
_SEPARATOR_WORDS = frozenset({"dash", "hyphen"})

#: Sentence punctuation. For grounding — unlike the looser exchange check
#: in :mod:`warrantyops.identifiers` — digit fragments separated by a
#: period or comma are separate numbers, never one merged run: "44. 821"
#: must not become "44821".
_SENTENCE_PUNCTUATION = re.compile(r"[.,;:!?]")


def _canonical_text(text: str) -> str:
    """The letter-and-digit comparison space for one utterance.

    Folded, spelled digits converted, separator words dropped, everything
    joined. "R. For Rajahmundry hyphen. Yes, 44. 821." becomes
    "rforrajahmundryyes44821" — visibly nothing like "br4821", which is the
    point: scattered or partial speech cannot be made to match here.
    """

    tokens = _tokens_to_digits(fold_text(text))
    return "".join(token for token in tokens if token not in _SEPARATOR_WORDS)


def _grounding_digit_runs(text: str) -> set[str]:
    """Digit runs that count as *this utterance's* numbers, for grounding.

    The raw text is split at sentence punctuation first, so fragments that
    merely sit in the same sentence-shaped utterance ("Yes, 44. 821.") stay
    fragments. Consecutive spoken digit words within one segment still form
    one run, which is how "Four eight one seven eight" is heard.
    """

    runs: set[str] = set()
    for segment in _SENTENCE_PUNCTUATION.split(text):
        runs.update(digit_runs(segment))
    return runs


def _letters_of(value: str) -> str:
    return "".join(char for char in (value or "") if char.isalpha()).lower()


def _reference_evidence(
    identifier: IdentifierDecision,
    extraction: dict[str, Any],
    transcript: tuple[TranscriptTurn, ...] | None,
) -> tuple[str, dict[str, str]] | None:
    """Ground the confirmed reference in the transcript, or refuse to.

    Conservative by construction. ``DIRECT_COUNTERPARTY_QUOTE`` requires the
    candidate's complete digit sequence inside one counterparty digit run
    and every letter of the candidate to have been spoken — by a
    counterparty utterance, or by the bot read-back of this reference's own
    exchange. A partial digit match, scattered characters or letters that
    exist only in the extracted candidate ground nothing: characters are
    never inferred from the candidate.

    ``CONFIRMED_BY_READBACK`` requires the bot read-back itself to contain
    the complete reference — letters and digits — with the counterparty's
    unambiguous confirmation immediately after; both turns are preserved and
    the confirmation word is never displayed alone.

    ``None`` means the reference stays an unconfirmed candidate needing
    human review.
    """

    if transcript is None or not identifier.value:
        return None
    digits = digits_of(identifier.value)
    if not digits:
        return None
    letters = _letters_of(identifier.value)
    display = (extraction.get("reference_confirmed") or "").strip() or None

    # The bot read-back this reference's confirmation answered, if any. It
    # is the only bot utterance that may supply the candidate's letters:
    # the value was put to the counterparty in it, verbatim.
    quote = (extraction.get("reference_confirmation_quote") or "").strip()
    paired_readback = None
    if quote:
        indices, _whole = _matching_turn_indices(quote, transcript)
        for index in indices:
            candidate_turn = _preceding_readback(transcript, index)
            if candidate_turn is not None:
                paired_readback = candidate_turn
                break

    letters_spoken = not letters or any(
        turn.speaker == COUNTERPARTY_SPEAKER and letters in _canonical_text(turn.text)
        for turn in transcript
    ) or (
        paired_readback is not None
        and letters in _canonical_text(paired_readback.text)
    )

    # 1. Direct: a counterparty utterance establishing the complete digits,
    #    with the letters spoken by the counterparty or the paired read-back.
    if letters_spoken:
        for turn in transcript:
            if turn.speaker == COUNTERPARTY_SPEAKER and any(
                digits in run for run in _grounding_digit_runs(turn.text)
            ):
                return REFERENCE_METHOD_DIRECT, {
                    "quote": turn.text.strip(),
                    "display": display or identifier.value,
                }

    # 2. Paired read-back: the bot said the complete reference and the
    #    counterparty confirmed it immediately after.
    if paired_readback is not None and letters_spoken and any(
        digits in run for run in _grounding_digit_runs(paired_readback.text)
    ) and (
        not letters or letters in _canonical_text(paired_readback.text)
    ):
        return REFERENCE_METHOD_READBACK, {
            "quote": quote,
            "readback": paired_readback.text.strip(),
            "display": display or identifier.value,
        }
    return None


@dataclass(frozen=True)
class TransportOutcome:
    """Everything known about the call as a call.

    ``failure_code`` is carried for support and never branched on: the CALL-E
    documentation states it is a nullable string with no published enum and
    tells integrators not to drive retry, reporting or analytics from it.
    """

    state: TransportState
    call_id: str | None = None
    diagnostic_failure_code: str | None = None
    diagnostic_failure_message: str | None = None

    @property
    def is_terminal(self) -> bool:
        return self.state in TERMINAL_TRANSPORT_STATES

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "call_id": self.call_id,
            "diagnostic_failure_code": self.diagnostic_failure_code,
            "diagnostic_failure_message": self.diagnostic_failure_message,
        }


@dataclass(frozen=True)
class WorkflowOutcome:
    terminal_state: TerminalState
    transport: TransportOutcome
    business: ClaimResult
    identifier: IdentifierDecision | None
    validation_errors: tuple[str, ...] = ()

    @property
    def write_back_eligible(self) -> bool:
        return self.terminal_state in WRITE_BACK_ELIGIBLE_STATES

    def to_dict(self) -> dict[str, Any]:
        return {
            "terminal_state": self.terminal_state.value,
            "transport": self.transport.to_dict(),
            "business": self.business.to_dict(),
            "identifier": self.identifier.to_dict() if self.identifier else None,
            "validation_errors": list(self.validation_errors),
        }


def _claim_from(extraction: dict[str, Any]) -> IdentifierClaim:
    return IdentifierClaim(
        value_heard=extraction.get("reference_heard"),
        readback_performed=bool(extraction.get("reference_readback_performed")),
        value_confirmed=extraction.get("reference_confirmed"),
        confirmation_quote=extraction.get("reference_confirmation_quote"),
    )


def derive_outcome(
    transport: TransportOutcome,
    validation: ValidationResult,
    *,
    transcript: tuple[TranscriptTurn, ...] | None = None,
    expected_reference_pattern: str | None = None,
    menu: MenuNavigation | None = None,
) -> WorkflowOutcome:
    """Fold a transport state and a validated extraction into one outcome."""

    if transport.state is TransportState.NOT_ATTEMPTED:
        return WorkflowOutcome(
            terminal_state=TerminalState.NOT_ATTEMPTED,
            transport=transport,
            business=unresolved_result("call was not attempted"),
            identifier=None,
        )
    if not transport.is_terminal:
        return WorkflowOutcome(
            terminal_state=TerminalState.IN_FLIGHT,
            transport=transport,
            business=unresolved_result("call has not reached a terminal state"),
            identifier=None,
        )
    if transport.state is not TransportState.COMPLETED:
        return WorkflowOutcome(
            terminal_state=TerminalState.TRANSPORT_FAILED,
            transport=transport,
            business=unresolved_result(
                f"call reached terminal state {transport.state.value} without a "
                "business outcome"
            ),
            identifier=None,
        )
    if not validation.ok or validation.value is None:
        # A result that came back and failed local validation is a different
        # finding from no result at all: the platform produced something, and
        # that something is not assertable. The webhook ``result_validation_
        # failed`` and the GoalRunError ``result_invalid`` name the same
        # distinction from the provider side; this is the local re-check.
        result_was_absent = validation.errors == (_NULL_RESULT_ERROR,)
        return WorkflowOutcome(
            terminal_state=(
                TerminalState.RESULT_UNAVAILABLE
                if result_was_absent
                else TerminalState.RESULT_INVALID
            ),
            transport=transport,
            business=unresolved_result(
                "call completed without a schema-valid structured result"
                if result_was_absent
                else "call completed but its structured result failed local "
                "schema validation"
            ),
            identifier=None,
            validation_errors=validation.errors,
        )

    extraction = validation.value
    downgrades: list[str] = []
    evidence: list[dict[str, str]] = []

    claim_status = ClaimStatus(extraction["claim_status"])
    status_quote = extraction.get("claim_status_evidence_quote")
    if claim_status is not ClaimStatus.UNKNOWN:
        if not (status_quote or "").strip():
            downgrades.append(
                f"claim_status {claim_status.value} had no evidence quote and was "
                "reduced to UNKNOWN"
            )
            claim_status = ClaimStatus.UNKNOWN
        elif not is_grounded_in_counterparty_turn(status_quote, transcript):
            downgrades.append(
                f"claim_status {claim_status.value} evidence quote was not found in "
                "a counterparty turn and was reduced to UNKNOWN"
            )
            claim_status = ClaimStatus.UNKNOWN
        elif status_quote_is_hedged(status_quote):
            # The quote is grounded — the counterparty did say it — but it is
            # not a final statement of status, so it is kept as evidence for
            # the reviewer while the asserted status stays UNKNOWN.
            downgrades.append(
                f"claim_status {claim_status.value} evidence quote was hedged or "
                "non-final and was reduced to UNKNOWN"
            )
            claim_status = ClaimStatus.UNKNOWN
            evidence.append(
                {"field": "claim_status", "quote": (status_quote or "").strip()}
            )
        else:
            evidence.append(
                {"field": "claim_status", "quote": (status_quote or "").strip()}
            )

    stated: dict[str, str] = {}
    for field_name in STATED_TEXT_FIELDS:
        value = extraction.get(field_name)
        if not (value or "").strip():
            continue
        if is_grounded_in_counterparty_turn(value, transcript):
            stated[field_name] = (value or "").strip()
            evidence.append({"field": field_name, "quote": (value or "").strip()})
        else:
            downgrades.append(
                f"{field_name} was not found in a counterparty turn and was dropped"
            )

    documents = tuple(
        item.strip() for item in (extraction.get("required_documents") or ()) if item
    )
    kept_documents: list[str] = []
    for document in documents:
        if is_grounded_in_counterparty_turn(document, transcript):
            kept_documents.append(document)
            evidence.append({"field": "required_documents", "quote": document})
        else:
            downgrades.append(
                "a required document entry was not found in a counterparty turn "
                "and was dropped"
            )

    identifier = evaluate_identifier(
        _claim_from(extraction),
        transcript=transcript,
        expected_pattern=expected_reference_pattern,
    )
    confirmed_reference = None
    if identifier.state is IdentifierState.CONFIRMED_IDENTIFIER:
        grounding = _reference_evidence(identifier, extraction, transcript)
        if grounding is None:
            # The confirmation machinery accepted it, but nothing in the
            # transcript can be shown as evidence for the value itself. A
            # reference nobody can be shown to have stated is not asserted.
            downgrades.append(
                "confirmed reference had no grounded transcript evidence and "
                "was reduced to an unconfirmed candidate needing human review"
            )
            identifier = IdentifierDecision(
                state=IdentifierState.UNCONFIRMED_IDENTIFIER,
                value=None,
                heard_value=identifier.heard_value,
                corrected=False,
                refusals=(*identifier.refusals, IdentifierRefusal.REFERENCE_EVIDENCE_UNGROUNDED),
            )
        else:
            method, extras = grounding
            confirmed_reference = ConfirmedReference(
                value=identifier.value or "",
                kind=ReferenceKind(extraction.get("reference_kind") or "UNKNOWN"),
                corrected=identifier.corrected,
            )
            item = {"field": "confirmed_reference", "method": method}
            item.update(extras)
            evidence.append(item)

    business = ClaimResult(
        contract_version=CONTRACT_VERSION,
        claim_status=claim_status,
        stated_reason=stated.get("stated_reason"),
        required_correction=stated.get("required_correction"),
        required_documents=tuple(kept_documents),
        stated_deadline=stated.get("stated_deadline"),
        escalation_path=stated.get("escalation_path"),
        stated_next_action=stated.get("stated_next_action"),
        confirmed_reference=confirmed_reference,
        evidence=tuple(evidence),
        downgrades=tuple(downgrades),
    )

    information_fields = (
        claim_status is not ClaimStatus.UNKNOWN,
        bool(stated.get("stated_reason")),
        confirmed_reference is not None,
    )
    action_fields = (
        bool(stated.get("required_correction")),
        bool(kept_documents),
        bool(stated.get("stated_deadline")),
        bool(stated.get("escalation_path")),
        bool(stated.get("stated_next_action")),
    )
    if any(information_fields):
        terminal_state = TerminalState.INFORMATION_OBTAINED
    elif any(action_fields):
        terminal_state = TerminalState.ACTION_REQUIRED
    else:
        terminal_state = TerminalState.BUSINESS_UNRESOLVED

    # A supplied keypad plan that evidence says did not resolve its menu is a
    # named terminal shape — but only when nothing usable was established: a
    # call that navigated partway and still grounded an answer is reported by
    # its answer, and "resolved: unknown" never classifies anything.
    if (
        menu is not None
        and menu.plan_supplied
        and menu.resolved is False
        and terminal_state is TerminalState.BUSINESS_UNRESOLVED
    ):
        terminal_state = TerminalState.MENU_UNRESOLVED

    return WorkflowOutcome(
        terminal_state=terminal_state,
        transport=transport,
        business=business,
        identifier=identifier,
    )
