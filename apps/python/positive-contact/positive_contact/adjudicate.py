"""Adjudication: one verified terminal call becomes exactly one disposition.

Three independent signals, combined fail-closed.

- Judge A reads the structured result, the CALL-E status, and `task_completed`.
- Judge B reads the transcript: it looks for an acknowledgement in a `speaker=user` turn
  after the notice turn, and it marks voicemail whenever a user turn matches a machine
  greeting pattern, whatever Judge A says.
- Judge C is an optional LLM. It is off by default, it is only consulted when A and B
  disagree, and its verdict never overrides an A+B agreement. It adds a note for the
  reviewer and nothing else.

`CONFIRMED` needs all four of: a live person, `acknowledged=yes`, confidence at the gate,
and Judge B independently finding the acknowledgement in the transcript. Every other
outcome moves the ladder forward or opens human review. Voicemail is never confirmation.
"""

from __future__ import annotations

import os
import re
from typing import Protocol

from .models import (
    Acknowledged,
    ContactType,
    Disposition,
    DispositionKind,
    EvidenceSpan,
    JudgeVerdict,
    NeedsAssistance,
    SupportCategory,
    SupportUrgency,
    YesNoUnknown,
)
from .redact import redact_free_text
from .script import ResultValidationError, validate_recipient_result
from .transports.base import CallSnapshot, TranscriptTurn

JUDGE_C_ENV_VAR = "PC_ENABLE_JUDGE_C"


def _phrases(*items: str) -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(item, re.IGNORECASE) for item in items)


# A `speaker=user` turn matching one of these is an answering machine, not a person.
#
# This lexicon is load-bearing: a greeting that slips through it can be read as a live
# person, and if the greeting happens to contain a word from the acknowledgement lexicon
# ("Hi, yes, this is the Smith family, we're not home") the machine's own greeting gets
# recorded as the acknowledgement. So it covers the imperative "leave a message" family,
# the "not home" family, and the callback-promise family, not just the literal word
# voicemail.
VOICEMAIL_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "en-US": _phrases(
        r"\bleave (?:a|your|us|me)\b",
        r"\bleave (?:a )?(?:brief |short |detailed )?message\b",
        r"\bafter the (?:tone|beep)\b",
        r"\bat the (?:tone|beep|sound of)\b",
        r"\byou(?:'ve|’ve| have) reached\b",
        r"\bis (?:not|un)available\b",
        r"\b(?:no one|no-one|nobody) is (?:here|home|available|in)\b",
        r"\b(?:we|i|they)(?:'re|’re| are|'m|’m| am)? ?not (?:home|here|in|available)\b",
        r"\bcan(?:'|’)?t (?:come to|get to) the phone\b",
        r"\bunable to (?:take|answer) your call\b",
        r"\bnot able to take your call\b",
        r"\bplease record\b",
        r"\brecord your (?:message|name)\b",
        r"\bvoice ?mail\b",
        r"\bmailbox\b",
        r"\bget back to you\b",
        r"\breturn your call as soon as\b",
        r"\b(?:please )?try (?:again|back|us) later\b",
        r"\bthe (?:person|number) you (?:are|'re|’re) (?:trying to reach|calling)\b",
    ),
}

# A `speaker=user` turn matching one of these acknowledges the notice.
ACKNOWLEDGEMENT_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "en-US": _phrases(
        r"\byes\b",
        r"\byeah\b",
        r"\byep\b",
        r"\byes,? i (?:heard|hear|understand|understood|got)\b",
        r"\bi (?:heard|understand|understood) (?:it|you|that)\b",
        r"\bi did hear\b",
        r"\bgot it\b",
        r"\bunderstood\b",
        r"\bconfirmed?\b",
        r"\bi hear you\b",
        r"\bthat'?s (?:right|correct)\b",
        r"\bcorrect\b",
    ),
}

# A turn matching one of these is not an acknowledgement, so "no, I did not hear that" is
# never read as a yes.
#
# The contraction pattern requires a literal apostrophe (`n't`, never bare `nt`) so that
# ordinary words ending in "nt" - want, went, meant, important - are not read as denials.
# An earlier version wrote it as `\bn'?t\b`, which cannot match inside "didn't" at all:
# the character before the "n" is a word character, so there is no boundary there. That
# made every contracted denial invisible to Judge B, and "I couldn't hear a word.
# Correct?" adjudicated as CONFIRMED with the denial itself stored as the evidence span.
NEGATION_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "en-US": _phrases(
        r"\bno\b",
        r"\bnot\b",
        r"n['’]t\b",
        r"\bcannot\b",
        r"\bnever\b",
        r"\bnothing\b",
        r"\bwhat(?:'s|’s| is) (?:this|that)\b",
        r"\bi don['’]?t (?:know|understand)\b",
        r"\bsay (?:that )?again\b",
        r"\bpardon\b",
        r"\brepeat\b",
        r"\bhuh\b",
    ),
}

# Bot turns that mark where the notice was actually delivered. An acknowledgement only
# counts if it comes after one of these.
NOTICE_MARKERS: dict[str, tuple[re.Pattern[str], ...]] = {
    "en-US": _phrases(
        r"\bpower\b.*\bturned off\b",
        r"\bpublic safety power shutoff\b",
        r"\bconfirm that you heard\b",
        r"\breceived this notice\b",
    ),
}

DEFAULT_LOCALE = "en-US"


def _for_locale(table: dict[str, tuple[re.Pattern[str], ...]], locale: str):
    return table.get(locale, table[DEFAULT_LOCALE])


def _matches(patterns: tuple[re.Pattern[str], ...], text: str) -> re.Pattern[str] | None:
    for pattern in patterns:
        if pattern.search(text):
            return pattern
    return None


def _first_match_position(patterns: tuple[re.Pattern[str], ...], text: str) -> int | None:
    """Where the earliest match starts, or None. Used to order an acknowledgement against
    a negation inside the same turn, so "yes I heard you, but I don't have a car" still
    reads as an acknowledgement while "no, I didn't hear that" does not."""
    positions = [match.start() for pattern in patterns if (match := pattern.search(text))]
    return min(positions) if positions else None


def _span(turn: TranscriptTurn, source: str) -> EvidenceSpan:
    return EvidenceSpan(
        source=source,
        turn_index=turn.index,
        offset_seconds=turn.offset_seconds,
        speaker=turn.speaker,
        text=redact_free_text(turn.text) or "",
    )


# -- Judge A ----------------------------------------------------------------------


def judge_a_structured(snapshot: CallSnapshot) -> JudgeVerdict:
    """Rule-based read of the structured result and the CALL-E status.

    Judge A never guesses voicemail from a status value. The contract publishes no
    answering-machine indicator, so voicemail detection belongs to Judge B
    (`docs/adapter-notes.md`, question 1).
    """
    if snapshot.status != "completed":
        return JudgeVerdict(
            judge="A",
            contact_type=ContactType.UNKNOWN,
            acknowledged=Acknowledged.UNKNOWN,
            reason_code=f"terminal_status_{snapshot.status}",
            note=snapshot.failure_message,
        )
    try:
        result = validate_recipient_result(snapshot.recipient_result)
    except ResultValidationError as exc:
        return JudgeVerdict(
            judge="A",
            contact_type=ContactType.UNKNOWN,
            acknowledged=Acknowledged.UNKNOWN,
            reason_code="recipient_result_invalid",
            note=str(exc),
        )
    return JudgeVerdict(
        judge="A",
        contact_type=ContactType(result["contact_type"]),
        acknowledged=Acknowledged(result["acknowledged"]),
        reason_code="structured_result",
        evidence=[
            EvidenceSpan(
                source="structured_result",
                text=(
                    f"contact_type={result['contact_type']} "
                    f"acknowledged={result['acknowledged']} "
                    f"needs_assistance={result['needs_assistance']}"
                ),
            )
        ],
    )


# -- Judge B ----------------------------------------------------------------------


def judge_b_transcript(snapshot: CallSnapshot, locale: str = DEFAULT_LOCALE) -> JudgeVerdict:
    """Independent read of the transcript, with the exact span recorded as evidence."""
    turns = snapshot.transcript_turns
    if not turns:
        return JudgeVerdict(
            judge="B",
            contact_type=ContactType.UNKNOWN,
            acknowledged=Acknowledged.UNKNOWN,
            reason_code="no_transcript",
        )

    voicemail_patterns = _for_locale(VOICEMAIL_PATTERNS, locale)
    ack_patterns = _for_locale(ACKNOWLEDGEMENT_PATTERNS, locale)
    negation_patterns = _for_locale(NEGATION_PATTERNS, locale)
    notice_patterns = _for_locale(NOTICE_MARKERS, locale)

    user_turns = [turn for turn in turns if turn.speaker == "user"]

    # A machine greeting on a user turn marks voicemail regardless of Judge A.
    for turn in user_turns:
        if _matches(voicemail_patterns, turn.text):
            return JudgeVerdict(
                judge="B",
                contact_type=ContactType.VOICEMAIL,
                acknowledged=Acknowledged.NO,
                reason_code="machine_greeting_detected",
                evidence=[_span(turn, "transcript_voicemail_greeting")],
            )

    if not user_turns:
        return JudgeVerdict(
            judge="B",
            contact_type=ContactType.UNKNOWN,
            acknowledged=Acknowledged.UNKNOWN,
            reason_code="no_user_turns",
        )

    # Where was the notice actually delivered? An acknowledgement before that point is
    # answering a different question.
    notice_index = -1
    for turn in turns:
        if turn.speaker == "bot" and _matches(notice_patterns, turn.text):
            notice_index = turn.index
    if notice_index < 0:
        first_bot = next((turn.index for turn in turns if turn.speaker == "bot"), -1)
        notice_index = first_bot

    denial: TranscriptTurn | None = None
    for turn in user_turns:
        if turn.index <= notice_index:
            continue
        ack_at = _first_match_position(ack_patterns, turn.text)
        negation_at = _first_match_position(negation_patterns, turn.text)
        if ack_at is not None and (negation_at is None or ack_at < negation_at):
            return JudgeVerdict(
                judge="B",
                contact_type=ContactType.LIVE_PERSON,
                acknowledged=Acknowledged.YES,
                reason_code="acknowledgement_in_transcript",
                evidence=[_span(turn, "transcript_acknowledgement")],
            )
        if negation_at is not None and denial is None:
            denial = turn

    if denial is not None:
        return JudgeVerdict(
            judge="B",
            contact_type=ContactType.LIVE_PERSON,
            acknowledged=Acknowledged.NO,
            reason_code="live_person_did_not_acknowledge",
            evidence=[_span(denial, "transcript_no_acknowledgement")],
        )

    return JudgeVerdict(
        judge="B",
        contact_type=ContactType.LIVE_PERSON,
        acknowledged=Acknowledged.UNKNOWN,
        reason_code="live_person_no_acknowledgement_found",
        evidence=[_span(user_turns[-1], "transcript_last_user_turn")],
    )


# -- Judge C ----------------------------------------------------------------------


class Judge(Protocol):
    """Interface for an optional third opinion. Never consulted in fixture or replay mode."""

    def review(self, snapshot: CallSnapshot, a: JudgeVerdict, b: JudgeVerdict) -> str:
        """Return a short note for the human reviewer. Not a verdict."""


class DisabledJudgeC:
    """The default. Consulting it is a no-op."""

    enabled = False

    def review(self, snapshot: CallSnapshot, a: JudgeVerdict, b: JudgeVerdict) -> str:
        return ""


def judge_c_enabled(env: dict[str, str] | None = None) -> bool:
    environ = os.environ if env is None else env
    return environ.get(JUDGE_C_ENV_VAR, "").strip().lower() in {"1", "true", "yes", "on"}


# -- combination ------------------------------------------------------------------


def confidence_passes(
    score: float | None, label: str | None, threshold: float
) -> bool:
    """The confidence gate.

    `completion_confidence` is nullable and `label` has no published enum, so a missing or
    unrecognized value fails the gate rather than being read optimistically.
    """
    if isinstance(label, str) and label.strip().lower() == "high":
        return True
    if isinstance(score, (int, float)) and not isinstance(score, bool):
        return float(score) >= threshold
    return False


def judges_agree(a: JudgeVerdict, b: JudgeVerdict) -> bool:
    """Agreement means Judge B independently reached the same read, not merely that it
    failed to object. An `unknown` from Judge B is never agreement."""
    return a.contact_type == b.contact_type and a.acknowledged == b.acknowledged


def adjudicate(
    snapshot: CallSnapshot,
    *,
    intent_id: str,
    locale: str = DEFAULT_LOCALE,
    confidence_threshold: float = 0.80,
    judge_c: Judge | None = None,
) -> Disposition:
    """Turn one verified terminal call into exactly one disposition.

    Implements the table in ARCHITECTURE.md section 10 in order, first match wins.
    """
    a = judge_a_structured(snapshot)
    b = judge_b_transcript(snapshot, locale)
    agree = judges_agree(a, b)

    needs_assistance = NeedsAssistance.UNKNOWN
    support_category = SupportCategory.UNKNOWN
    support_urgency = SupportUrgency.UNKNOWN
    provider_contact_consent = YesNoUnknown.UNKNOWN
    emergency_risk = YesNoUnknown.UNKNOWN
    notes_for_human: str | None = None
    if isinstance(snapshot.recipient_result, dict):
        raw_assist = snapshot.recipient_result.get("needs_assistance")
        if isinstance(raw_assist, str):
            try:
                needs_assistance = NeedsAssistance(raw_assist)
            except ValueError:
                needs_assistance = NeedsAssistance.UNKNOWN
        notes_for_human = redact_free_text(snapshot.recipient_result.get("notes_for_human"))
        for field_name, enum_type, fallback in (
            ("support_category", SupportCategory, SupportCategory.UNKNOWN),
            ("support_urgency", SupportUrgency, SupportUrgency.UNKNOWN),
            ("provider_contact_consent", YesNoUnknown, YesNoUnknown.UNKNOWN),
            ("emergency_risk", YesNoUnknown, YesNoUnknown.UNKNOWN),
        ):
            raw_value = snapshot.recipient_result.get(field_name)
            if not isinstance(raw_value, str):
                continue
            try:
                parsed = enum_type(raw_value)
            except ValueError:
                parsed = fallback
            if field_name == "support_category":
                support_category = parsed
            elif field_name == "support_urgency":
                support_urgency = parsed
            elif field_name == "provider_contact_consent":
                provider_contact_consent = parsed
            else:
                emergency_risk = parsed

    judge_c_note: str | None = None
    if judge_c is not None and getattr(judge_c, "enabled", False) and not agree:
        # Only consulted on disagreement, and only ever writes a note.
        judge_c_note = judge_c.review(snapshot, a, b) or None

    confidence_ok = confidence_passes(
        snapshot.confidence_score, snapshot.confidence_label, confidence_threshold
    )

    evidence = [*a.evidence, *b.evidence]

    def build(
        kind: DispositionKind,
        contact_type: ContactType,
        acknowledged: Acknowledged,
        reason_code: str,
    ) -> Disposition:
        return Disposition(
            intent_id=intent_id,
            contact_type=contact_type,
            acknowledged=acknowledged,
            needs_assistance=needs_assistance,
            confidence_score=snapshot.confidence_score,
            confidence_label=snapshot.confidence_label,
            judge_a=f"{a.contact_type.value}/{a.acknowledged.value}:{a.reason_code}",
            judge_b=f"{b.contact_type.value}/{b.acknowledged.value}:{b.reason_code}",
            judge_c=judge_c_note,
            judges_agree=agree,
            disposition=kind,
            reason_code=reason_code,
            evidence_spans=evidence,
            notes_for_human=notes_for_human,
            support_category=support_category,
            support_urgency=support_urgency,
            provider_contact_consent=provider_contact_consent,
            emergency_risk=emergency_risk,
        )

    # Row: failed / canceled / anything not cleanly completed.
    if snapshot.status != "completed":
        return build(
            DispositionKind.NEEDS_HUMAN,
            ContactType.UNKNOWN,
            Acknowledged.UNKNOWN,
            f"terminal_status_{snapshot.status}_no_auto_redial",
        )

    # Row: the recipient result was missing or did not survive strict local validation.
    if a.reason_code == "recipient_result_invalid":
        return build(
            DispositionKind.NEEDS_HUMAN,
            ContactType.UNKNOWN,
            Acknowledged.UNKNOWN,
            "recipient_result_invalid",
        )

    # Row: contradiction. The transcript shows a machine greeting while the structured
    # result claims a live person acknowledged the notice.
    if (
        b.contact_type is ContactType.VOICEMAIL
        and a.contact_type is ContactType.LIVE_PERSON
        and a.acknowledged is Acknowledged.YES
    ):
        return build(
            DispositionKind.NEEDS_HUMAN,
            ContactType.VOICEMAIL,
            a.acknowledged,
            "contradiction_voicemail_greeting_vs_acknowledged",
        )

    # Rows that never redial, recorded before anything else can close them out.
    if a.contact_type is ContactType.WRONG_NUMBER:
        return build(
            DispositionKind.NEEDS_HUMAN,
            ContactType.WRONG_NUMBER,
            a.acknowledged,
            "wrong_number_number_retired_for_event",
        )
    if a.contact_type is ContactType.REFUSED:
        return build(
            DispositionKind.NEEDS_HUMAN,
            ContactType.REFUSED,
            a.acknowledged,
            "refused_no_redial",
        )
    if a.contact_type is ContactType.LANGUAGE_BARRIER:
        return build(
            DispositionKind.NEEDS_HUMAN,
            ContactType.LANGUAGE_BARRIER,
            a.acknowledged,
            "language_barrier_bilingual_callback_no_redial",
        )

    # Row: a medical question outranks the confirm path. The contact disposition is still
    # recorded so the report counts it honestly.
    if needs_assistance is NeedsAssistance.MEDICAL_QUESTION:
        return build(
            DispositionKind.NEEDS_HUMAN,
            a.contact_type,
            a.acknowledged,
            "medical_question_priority_review",
        )

    if a.contact_type is ContactType.LIVE_PERSON and a.acknowledged is Acknowledged.YES:
        if not confidence_ok:
            return build(
                DispositionKind.NEEDS_HUMAN,
                a.contact_type,
                a.acknowledged,
                "confidence_below_gate",
            )
        if not agree:
            return build(
                DispositionKind.NEEDS_HUMAN,
                a.contact_type,
                a.acknowledged,
                "judge_disagreement_ladder_clock_still_running",
            )
        return build(
            DispositionKind.CONFIRMED,
            ContactType.LIVE_PERSON,
            Acknowledged.YES,
            "live_human_acknowledged_with_transcript_evidence",
        )

    if a.contact_type is ContactType.LIVE_PERSON:
        return build(
            DispositionKind.UNCONFIRMED,
            ContactType.LIVE_PERSON,
            a.acknowledged,
            "live_person_did_not_acknowledge",
        )

    if a.contact_type is ContactType.VOICEMAIL:
        return build(
            DispositionKind.UNCONFIRMED,
            ContactType.VOICEMAIL,
            a.acknowledged,
            "voicemail_notice_left_not_confirmation",
        )

    if a.contact_type in (ContactType.NO_ANSWER, ContactType.BUSY):
        return build(
            DispositionKind.UNCONFIRMED,
            a.contact_type,
            a.acknowledged,
            f"{a.contact_type.value}_retry",
        )

    # contact_type=unknown on a completed call. Nothing here supports a conclusion.
    return build(
        DispositionKind.NEEDS_HUMAN,
        ContactType.UNKNOWN,
        a.acknowledged,
        "contact_type_unknown_on_completed_call",
    )
