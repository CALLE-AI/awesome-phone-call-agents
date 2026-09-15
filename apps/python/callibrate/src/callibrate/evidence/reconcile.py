"""Turning a finished call into evidence, with two readings that must agree.

A CALL-E run comes back with two different kinds of thing: a transcript of what
was said, and the caller's own account of what it achieved. The account is
useful and it is not evidence, because it was written by the participant whose
work is being checked.

So this module reads the transcript itself, by rule, and produces its own
candidate value for every field under contract. Then it reconciles:

    transcript candidate  +  caller account  agree     -> a supported claim
    transcript candidate  +  caller account  disagree  -> a claim, flagged, to a curator
    transcript candidate  +  no account                -> a supported claim
    no transcript candidate + caller account           -> a claim with no evidence, to a curator
    neither                                            -> an unresolved question

Nothing here can make a claim safer than the transcript makes it. Every branch
either keeps the transcript's verdict or lowers it, which is the property the
whole product rests on: a call that goes badly cannot leave the record in a
worse state than a call that never happened.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from callibrate.calling.models import (
    CallEvidence,
    CallOutcome,
    Claim,
    Confirmation,
    SafetyEvent,
    SafetyEventKind,
    Turn,
)
from callibrate.contracts.models import VerificationContract
from callibrate.evidence import readback as readback_rules
from callibrate.evidence.transcript import (
    CLIENT_PHRASES,
    CLOSURE_PHRASES,
    DISTRESS_PHRASES,
    ELIGIBILITY_PHRASES,
    STOP_PHRASES,
    WRONG_PARTY_PHRASES,
    NormalizedTurn,
    contains_any,
    disclosure_spoken,
    is_hedged,
    names_more_than_one_session,
    spoken_schedule,
)

#: Fields whose spoken form this module can canonicalise on its own.
CANONICALISABLE = {"schedule", "status"}

#: Fields whose value is free text. A change to one of these is always a
#: proposal for a person to read, never a canonical value to write.
FREE_TEXT = {
    "name",
    "description",
    "eligibility",
    "fees",
    "application_process",
    "alert",
    "address",
}

REDACTION_MARKERS = ("[phone redacted]", "[email redacted]")


def _turns_to_models(turns: list[NormalizedTurn]) -> list[Turn]:
    return [
        Turn(id=turn.id, role=turn.role, text=turn.text, offset_seconds=turn.offset_seconds)
        for turn in turns
    ]


def _records(turns: list[NormalizedTurn]) -> list[dict[str, Any]]:
    return [{"id": turn.id, "role": turn.role, "text": turn.text} for turn in turns]


def _provider_turns(turns: list[NormalizedTurn]) -> list[NormalizedTurn]:
    return [turn for turn in turns if turn.role in {"provider", "seeker"}]


def scan_safety(turns: list[NormalizedTurn]) -> list[SafetyEvent]:
    """Find the things that end a call regardless of what else was established."""
    events: list[SafetyEvent] = []
    seen: set[SafetyEventKind] = set()
    for turn in _provider_turns(turns):
        checks = (
            (SafetyEventKind.STOP_REQUESTED, STOP_PHRASES),
            (SafetyEventKind.DISTRESS, DISTRESS_PHRASES),
            (SafetyEventKind.WRONG_PARTY, WRONG_PARTY_PHRASES),
            (SafetyEventKind.REACHED_CLIENT, CLIENT_PHRASES),
        )
        for kind, phrases in checks:
            phrase = contains_any(turn.text, phrases)
            if phrase and kind not in seen:
                seen.add(kind)
                events.append(SafetyEvent(kind=kind, detail=turn.text[:500], turn_id=turn.id))
    return events


def _safety_outcome(events: list[SafetyEvent]) -> CallOutcome | None:
    ordered = (
        (SafetyEventKind.DISTRESS, CallOutcome.DISTRESS),
        (SafetyEventKind.STOP_REQUESTED, CallOutcome.STOP_REQUESTED),
        (SafetyEventKind.REACHED_CLIENT, CallOutcome.REACHED_CLIENT),
        (SafetyEventKind.WRONG_PARTY, CallOutcome.WRONG_PARTY),
    )
    kinds = {event.kind for event in events}
    return next((outcome for kind, outcome in ordered if kind in kinds), None)


def _record_days(current_value: str) -> list[str]:
    """The days the record already holds, used when a sentence names only hours."""
    parts = (current_value or "").split()
    if not parts:
        return []
    codes = [code for code in parts[0].split(",") if code in {"MO", "TU", "WE", "TH", "FR", "SA", "SU"}]
    return codes


def _transcript_candidates(
    field: str, turns: list[NormalizedTurn], current_value: str
) -> list[tuple[str, NormalizedTurn]]:
    """Every value this transcript proposes for one field, in the order said.

    Plural on purpose. A conversation where the assistant mishears and the
    provider corrects it contains two candidates, and which one is right is not
    decided here: it is decided by which one the provider was read back and
    agreed to. Returning only the last would let a correction *about* a wrong
    readback become the proposed value.
    """
    provider = _provider_turns(turns)
    found: list[tuple[str, NormalizedTurn]] = []

    if field == "schedule":
        default_days = _record_days(current_value)
        for turn in provider:
            candidate = spoken_schedule(turn.text, default_days=default_days)
            if candidate and candidate != current_value:
                found.append((candidate, turn))
        return found

    if field == "status":
        for turn in provider:
            if contains_any(turn.text, CLOSURE_PHRASES):
                found.append(("inactive", turn))
                break
        return found

    if field == "phone":
        # The stored transcript masks phone numbers, so a new number can never be
        # read back out of it. Stated here rather than worked around.
        return []

    if field == "eligibility":
        for turn in provider:
            if contains_any(turn.text, ELIGIBILITY_PHRASES):
                found.append((turn.text[:2000], turn))
                break
        return found

    return found


def _confirmation(
    field: str, turns: list[NormalizedTurn], current_value: str
) -> Confirmation | None:
    """Whether the transcript shows the provider agreeing the record is right.

    The assistant has to have said the whole of the value the record holds, and
    the provider has to have agreed to that, plainly, straight afterwards.
    """
    if not current_value:
        return None
    for index, turn in enumerate(turns):
        if turn.role != "assistant" or not readback_rules.covers_value(turn.text, field, current_value):
            continue
        reply = next(
            (later for later in turns[index + 1 :] if later.role in {"provider", "seeker"}),
            None,
        )
        if reply is None or not readback_rules.affirms(reply.text):
            continue
        return Confirmation(
            field=field,
            value=current_value,
            turn_ids=[turn.id, reply.id],
            quote=reply.text[:1000],
        )
    return None


def _caller_hint(caller_result: dict[str, Any], field: str) -> str | None:
    """A value the caller reported for this field, if it reported one at all.

    CALL-E's MCP surface returns prose, so this looks in the places a structured
    value can appear and accepts nothing else. A hint is never sufficient on its
    own; it exists so that a disagreement with the transcript is visible.
    """
    for key in ("structured_result", "structuredResult", "result", "fields", "details"):
        container = caller_result.get(key)
        if isinstance(container, dict):
            value = container.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()[:2000]
    value = caller_result.get(field)
    return value.strip()[:2000] if isinstance(value, str) and value.strip() else None


def _build_claim(
    contract: VerificationContract,
    field: str,
    turns: list[NormalizedTurn],
    caller_result: dict[str, Any],
) -> Claim | None:
    """One field's claim, or nothing when the call established nothing about it."""
    current_value = contract.known_value(field)
    candidates = _transcript_candidates(field, turns, current_value)
    hint = _caller_hint(caller_result, field)
    records = _records(turns)

    if not candidates and hint is None:
        return None

    if not candidates:
        # The caller reported something the transcript does not show. Never
        # discarded, never trusted: it goes in front of a person with the reason.
        assert hint is not None
        return Claim(
            field=field,
            proposed_value=hint,
            explicit_statement=False,
            removes_service=field == "status" and hint.lower() != "active",
            ambiguous=True,
            confidence=0.0,
            evidence_note=(
                "the caller reported this value but no provider turn in the transcript states it"
            ),
        )

    # Prefer whichever candidate the transcript actually corroborates. Falling
    # back to the first is deliberate: the provider's own opening statement is
    # what they came to say, and a later turn is usually a reaction to us.
    chosen_value, chosen_turn = candidates[0]
    evidence = readback_rules.corroborate(records, field, chosen_value)
    for value, turn in candidates:
        attempt = readback_rules.corroborate(records, field, value)
        if attempt.corroborated:
            chosen_value, chosen_turn, evidence = value, turn, attempt
            break

    notes: list[str] = []
    ambiguous = is_hedged(chosen_turn.text)

    if hint is not None and hint.strip() != chosen_value.strip():
        ambiguous = True
        notes.append(
            "the caller's result and the transcript propose different values; "
            f"transcript {chosen_value!r}, caller {hint!r}"
        )
    if len(candidates) > 1 and not evidence.corroborated:
        ambiguous = True
        notes.append(
            f"the provider named {len(candidates)} different values and none was read back and agreed"
        )

    readback_ids: list[str] = []
    confirmation_ids: list[str] = []
    if evidence.corroborated:
        readback_ids = [
            turn.id
            for turn in turns
            if turn.role == "assistant" and turn.text == evidence.readback_quote
        ][:1]
        confirmation_ids = [
            turn.id
            for turn in turns
            if turn.role in {"provider", "seeker"} and turn.text == evidence.confirmation_quote
        ][:1]
    else:
        notes.append(evidence.reason)

    if field in FREE_TEXT:
        # A free-text value cannot be normalised, so it cannot be matched word
        # for word against a readback. It is always a proposal for a person.
        ambiguous = True
        notes.append("a free-text value is never applied without a person reading it")

    if evidence.corroborated and not ambiguous:
        confidence = 0.99
    elif evidence.corroborated:
        confidence = 0.6
    else:
        confidence = 0.4

    return Claim(
        field=field,
        proposed_value=chosen_value,
        quote=chosen_turn.text[:1000],
        explicit_statement=True,
        removes_service=field == "status" and str(chosen_value).lower() != "active",
        ambiguous=ambiguous,
        confidence=confidence,
        source_turn_ids=[chosen_turn.id],
        readback_turn_ids=readback_ids,
        confirmation_turn_ids=confirmation_ids,
        evidence_note="; ".join(note for note in notes if note)[:500],
    )


def build_evidence(
    contract: VerificationContract,
    *,
    turns: list[NormalizedTurn],
    caller: str,
    outcome: CallOutcome,
    caller_result: dict[str, Any] | None = None,
    call_id: str = "",
    plan_id: str = "",
    provider_status: str = "",
    summary: str = "",
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
    duration_seconds: float = 0.0,
) -> CallEvidence:
    """Read one finished call and produce everything the policy is allowed to see."""
    caller_result = caller_result or {}
    started_at = started_at or datetime.now(UTC)
    completed_at = completed_at or datetime.now(UTC)

    safety_events = scan_safety(turns)
    resolved_outcome = _safety_outcome(safety_events) or outcome

    spoken = disclosure_spoken(turns)
    if contract.call_constraints.disclosure_required and not spoken and turns:
        safety_events.append(
            SafetyEvent(
                kind=SafetyEventKind.NO_DISCLOSURE,
                detail="the assistant did not identify itself as automated before asking questions",
            )
        )

    claims: list[Claim] = []
    confirmations: list[Confirmation] = []
    unresolved: list[str] = []

    for field in contract.fields_to_verify:
        current_value = contract.known_value(field)
        claim = _build_claim(contract, field, turns, caller_result)
        if claim is not None:
            claims.append(claim)
            continue
        confirmation = _confirmation(field, turns, current_value)
        if confirmation is not None:
            confirmations.append(confirmation)
            continue
        if field == "phone" and any(
            marker in turn.text.lower() for turn in turns for marker in REDACTION_MARKERS
        ):
            unresolved.append(
                "the phone number was discussed but the stored transcript masks it, so it "
                "cannot be checked from the record"
            )
            continue
        if field == "schedule" and any(
            names_more_than_one_session(turn.text) for turn in _provider_turns(turns)
        ):
            # The call did settle the hours. It settled more of them than one
            # range can hold, and picking a half is the mutation this system
            # exists to refuse, so the whole sentence goes to a person.
            unresolved.append(
                "the provider described more than one session in one sentence and a record "
                "value holds a single range, so the hours were not read from it"
            )
            continue
        unresolved.append(f"nothing in the call settles {contract.field_label(field)}")

    # A closure mentioned in passing is still a closure. We called about the
    # opening hours; the provider said the programme is ending. Dropping that
    # because `status` was not on the contract would be the single worst thing
    # this system could do, so it is picked up regardless and sent to a person.
    if "status" not in contract.fields_to_verify:
        closure = _transcript_candidates("status", turns, contract.known_value("status"))
        if closure:
            value, turn = closure[0]
            claims.append(
                Claim(
                    field="status",
                    proposed_value=value,
                    quote=turn.text[:1000],
                    explicit_statement=True,
                    removes_service=True,
                    ambiguous=False,
                    confidence=0.0,
                    source_turn_ids=[turn.id],
                    evidence_note=(
                        "the provider mentioned a closure on a call about something else; "
                        "no closure is ever applied automatically"
                    ),
                )
            )
            unresolved.append(
                "the provider mentioned the service is closing, which a person has to confirm"
            )

    return CallEvidence(
        contract_id=contract.id,
        caller=caller,
        call_id=call_id,
        plan_id=plan_id,
        provider_status=provider_status,
        outcome=resolved_outcome,
        disclosure_spoken=spoken,
        recording_consent=False,
        transcript=_turns_to_models(turns),
        claims=claims,
        confirmations=confirmations,
        unresolved_questions=unresolved[:20],
        safety_events=safety_events,
        summary=summary[:2000],
        caller_result=caller_result,
        started_at=started_at,
        completed_at=completed_at,
        duration_seconds=max(0.0, duration_seconds),
    )
