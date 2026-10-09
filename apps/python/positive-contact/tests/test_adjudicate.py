"""One test per row of the adjudication table in ARCHITECTURE.md section 10."""

from __future__ import annotations

import pytest

from positive_contact.adjudicate import (
    JUDGE_C_ENV_VAR,
    DisabledJudgeC,
    adjudicate,
    confidence_passes,
    judge_a_structured,
    judge_b_transcript,
    judge_c_enabled,
    judges_agree,
)
from positive_contact.models import Acknowledged, ContactType, DispositionKind, NeedsAssistance
from positive_contact.transports.base import CallSnapshot, TranscriptTurn

GREETING = (
    "This is an automated safety notification from Northbay Power about a possible Public "
    "Safety Power Shutoff. This call may be recorded. Am I speaking with Maria?"
)
NOTICE = (
    "Power at the 1200 block of Elm St may be turned off starting Friday at 6:00 PM to reduce "
    "wildfire risk. Because this account is enrolled in the Medical Baseline program, we are "
    "calling to make sure you have received this notice. Can you confirm that you heard it?"
)
MACHINE = "You have reached the voicemail of this number. Please leave a message after the tone."


def turns(*pairs):
    return tuple(
        TranscriptTurn(index=index, speaker=speaker, text=text, offset_seconds=index * 7)
        for index, (speaker, text) in enumerate(pairs)
    )


ACK_TRANSCRIPT = turns(
    ("bot", GREETING),
    ("user", "This is Maria speaking."),
    ("bot", NOTICE),
    ("user", "Yes, I heard you. When will it come back on?"),
)

DENIAL_TRANSCRIPT = turns(
    ("bot", GREETING),
    ("user", "Speaking."),
    ("bot", NOTICE),
    ("user", "No, I did not hear anything about that."),
)

VOICEMAIL_TRANSCRIPT = turns(("bot", GREETING), ("user", MACHINE))


def result(contact_type, acknowledged, needs_assistance="none", **extra):
    return {
        "contact_type": contact_type,
        "acknowledged": acknowledged,
        "needs_assistance": needs_assistance,
        **extra,
    }


def snapshot(
    *,
    status="completed",
    recipient_result=None,
    transcript=(),
    score=0.93,
    label="high",
    task_completed=True,
    failure_code=None,
):
    confidence_present = score is not None or label is not None
    return CallSnapshot(
        call_id="call_test_1",
        status=status,
        task_completed=task_completed,
        confidence_score=score if confidence_present else None,
        confidence_label=label if confidence_present else None,
        recipient_result=recipient_result,
        recipient_status="completed" if status == "completed" else "failed",
        transcript_turns=tuple(transcript),
        metadata={},
        failure_code=failure_code,
        raw={},
    )


def judge(snap, threshold=0.80, locale="en-US", judge_c=None):
    return adjudicate(
        snap, intent_id="int:test", locale=locale, confidence_threshold=threshold,
        judge_c=judge_c,
    )


# -- row 1: the only path to CONFIRMED --------------------------------------------


def test_row_live_person_yes_high_confidence_judges_agree_is_confirmed():
    disposition = judge(
        snapshot(recipient_result=result("live_person", "yes"), transcript=ACK_TRANSCRIPT)
    )
    assert disposition.disposition is DispositionKind.CONFIRMED
    assert disposition.reason_code == "live_human_acknowledged_with_transcript_evidence"
    assert disposition.judges_agree is True
    # The confirmation carries the transcript span that produced it.
    assert any(
        span.source == "transcript_acknowledgement" and "Yes, I heard you" in span.text
        for span in disposition.evidence_spans
    )


# -- row 2: judges disagree -------------------------------------------------------


def test_row_live_person_yes_high_confidence_judges_disagree_is_needs_human():
    # The structured result claims an acknowledgement the transcript does not contain.
    disposition = judge(
        snapshot(recipient_result=result("live_person", "yes"), transcript=DENIAL_TRANSCRIPT)
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "judge_disagreement_ladder_clock_still_running"
    assert disposition.judges_agree is False


def test_judge_disagreement_opens_human_review_and_ladder_keeps_running(
    ledger, event, policy, now
):
    """A disagreement pauses automation for this contact but not the deadline."""
    from datetime import timedelta

    from positive_contact.escalate import advance_after_disposition, build_intent, sweep_cutoff
    from positive_contact.models import Contact, IntentState, LadderEvent, LadderTarget
    from positive_contact.escalate import apply
    from positive_contact.script import SCHEMA_VERSION, TASK_VERSION

    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id="pc-500",
            event_id=event.event_id,
            first_name="Sam",
            phone_e164="+14155550190",
            locale="en-US",
            tz="America/Los_Angeles",
            service_address_short="9 block of Test St",
        )
    )
    intent = ledger.reserve_intent(
        build_intent(
            event, "pc-500", 1, LadderTarget.PRIMARY, not_before=now,
            task_version=TASK_VERSION, schema_version=SCHEMA_VERSION, created_at=now,
        )
    )
    for ladder_event, reason in (
        (LadderEvent.CALL_ACCEPTED, "call_submitted"),
        (LadderEvent.TERMINAL_OBSERVED, "terminal_status_completed"),
        (LadderEvent.BINDING_VERIFIED, "bound"),
    ):
        apply(ledger, intent, ladder_event, reason, at=now)

    disposition = judge(
        snapshot(recipient_result=result("live_person", "yes"), transcript=DENIAL_TRANSCRIPT)
    )
    disposition = disposition.model_copy(update={"intent_id": intent.intent_id})
    ledger.put_disposition(disposition)
    advance_after_disposition(
        ledger, event, policy, intent, disposition, now=now,
        task_version=TASK_VERSION, schema_version=SCHEMA_VERSION,
    )
    assert ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN
    # No further call is scheduled while a person owns it.
    assert len(ledger.list_intents_for_contact("pc-500")) == 1

    # The clock keeps running. At the cutoff the unresolved item becomes a truck roll.
    sweep_cutoff(ledger, event, policy, now=event.field_visit_cutoff + timedelta(minutes=1))
    assert ledger.reconstruct(intent.intent_id) is IntentState.FIELD_VISIT_PENDING
    assert len(ledger.list_work_orders(event.event_id)) == 1


# -- row 3: confidence below the gate ---------------------------------------------


@pytest.mark.parametrize(
    "score,label", [(0.62, "medium"), (0.20, "low"), (0.79, "medium"), (None, None)]
)
def test_row_live_person_yes_confidence_below_the_gate_is_needs_human(score, label):
    disposition = judge(
        snapshot(
            recipient_result=result("live_person", "yes"),
            transcript=ACK_TRANSCRIPT,
            score=score,
            label=label,
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "confidence_below_gate"


# -- row 4: live person who did not acknowledge -----------------------------------


@pytest.mark.parametrize("acknowledged", ["no", "unknown"])
def test_row_live_person_without_acknowledgement_is_unconfirmed(acknowledged):
    disposition = judge(
        snapshot(
            recipient_result=result("live_person", acknowledged),
            transcript=DENIAL_TRANSCRIPT,
        )
    )
    assert disposition.disposition is DispositionKind.UNCONFIRMED
    assert disposition.reason_code == "live_person_did_not_acknowledge"


# -- row 5: voicemail --------------------------------------------------------------


def test_row_voicemail_is_unconfirmed_even_though_the_notice_was_left():
    disposition = judge(
        snapshot(
            recipient_result=result("voicemail", "unknown"),
            transcript=VOICEMAIL_TRANSCRIPT,
        )
    )
    assert disposition.disposition is DispositionKind.UNCONFIRMED
    assert disposition.reason_code == "voicemail_notice_left_not_confirmation"


def test_voicemail_is_never_confirmation_whatever_the_confidence():
    disposition = judge(
        snapshot(
            recipient_result=result("voicemail", "yes"),
            transcript=VOICEMAIL_TRANSCRIPT,
            score=1.0,
            label="high",
        )
    )
    assert disposition.disposition is not DispositionKind.CONFIRMED


# -- row 6: no answer and busy -----------------------------------------------------


@pytest.mark.parametrize("contact_type", ["no_answer", "busy"])
def test_row_no_answer_or_busy_is_unconfirmed_and_retryable(contact_type):
    disposition = judge(
        snapshot(recipient_result=result(contact_type, "unknown"), transcript=(), score=0.3,
                 label="low")
    )
    assert disposition.disposition is DispositionKind.UNCONFIRMED
    assert disposition.reason_code == f"{contact_type}_retry"


# -- row 7: wrong number -----------------------------------------------------------


def test_row_wrong_number_is_needs_human_and_retires_the_number():
    disposition = judge(
        snapshot(
            recipient_result=result("wrong_number", "unknown"),
            transcript=turns(
                ("bot", GREETING),
                ("user", "There is nobody here by that name. You have the wrong number."),
            ),
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "wrong_number_number_retired_for_event"
    assert disposition.contact_type is ContactType.WRONG_NUMBER


# -- row 8: refused ----------------------------------------------------------------


def test_row_refused_is_needs_human_with_no_redial():
    disposition = judge(
        snapshot(
            recipient_result=result("refused", "no"),
            transcript=turns(
                ("bot", GREETING),
                ("user", "Take me off your list and do not call again."),
            ),
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "refused_no_redial"


# -- row 9: language barrier -------------------------------------------------------


def test_row_language_barrier_is_needs_human_bilingual_callback():
    disposition = judge(
        snapshot(
            recipient_result=result("language_barrier", "unknown"),
            transcript=turns(("bot", GREETING), ("user", "Ich verstehe kein Englisch.")),
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "language_barrier_bilingual_callback_no_redial"


# -- row 10: a medical question outranks the confirm path --------------------------


def test_row_medical_question_is_needs_human_priority_even_with_an_acknowledgement():
    disposition = judge(
        snapshot(
            recipient_result=result("live_person", "yes", needs_assistance="medical_question"),
            transcript=ACK_TRANSCRIPT,
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "medical_question_priority_review"
    # The contact disposition is still recorded so the report counts it honestly.
    assert disposition.contact_type is ContactType.LIVE_PERSON
    assert disposition.acknowledged is Acknowledged.YES
    assert disposition.needs_assistance is NeedsAssistance.MEDICAL_QUESTION


# -- row 11: contradiction ---------------------------------------------------------


def test_row_contradiction_between_the_transcript_and_the_result_is_needs_human():
    """The structured result claims a live acknowledgement; the transcript is a machine."""
    disposition = judge(
        snapshot(
            recipient_result=result("live_person", "yes"),
            transcript=VOICEMAIL_TRANSCRIPT,
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "contradiction_voicemail_greeting_vs_acknowledged"
    assert disposition.contact_type is ContactType.VOICEMAIL


# -- row 12: not cleanly completed -------------------------------------------------


@pytest.mark.parametrize("status", ["failed", "canceled"])
def test_row_failed_or_canceled_is_needs_human_with_no_auto_redial(status):
    disposition = judge(
        snapshot(
            status=status,
            recipient_result=None,
            transcript=(),
            score=None,
            label=None,
            task_completed=None,
            failure_code="provider_error",
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == f"terminal_status_{status}_no_auto_redial"


def test_an_invalid_recipient_result_is_needs_human():
    disposition = judge(snapshot(recipient_result=None, transcript=ACK_TRANSCRIPT))
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "recipient_result_invalid"


def test_an_unexpected_key_in_the_result_is_needs_human():
    disposition = judge(
        snapshot(
            recipient_result={**result("live_person", "yes"), "diagnosis": "x"},
            transcript=ACK_TRANSCRIPT,
        )
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "recipient_result_invalid"


def test_contact_type_unknown_on_a_completed_call_is_needs_human():
    disposition = judge(
        snapshot(recipient_result=result("unknown", "unknown"), transcript=())
    )
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN
    assert disposition.reason_code == "contact_type_unknown_on_completed_call"


# -- the judges themselves ---------------------------------------------------------


def test_judge_b_finds_the_acknowledgement_after_the_notice_turn():
    verdict = judge_b_transcript(snapshot(transcript=ACK_TRANSCRIPT))
    assert verdict.acknowledged is Acknowledged.YES
    assert verdict.evidence[0].turn_index == 3


def test_judge_b_ignores_a_yes_that_came_before_the_notice():
    """"Yes, this is Maria" answers the greeting, not the notice."""
    transcript = turns(
        ("bot", GREETING),
        ("user", "Yes, this is Maria."),
        ("bot", NOTICE),
        ("user", "Hold on, let me get a pen."),
    )
    verdict = judge_b_transcript(snapshot(transcript=transcript))
    assert verdict.acknowledged is not Acknowledged.YES


def test_judge_b_marks_voicemail_regardless_of_judge_a():
    snap = snapshot(recipient_result=result("live_person", "yes"), transcript=VOICEMAIL_TRANSCRIPT)
    assert judge_a_structured(snap).contact_type is ContactType.LIVE_PERSON
    assert judge_b_transcript(snap).contact_type is ContactType.VOICEMAIL


def test_judge_b_reads_a_hedged_acknowledgement_as_an_acknowledgement():
    transcript = turns(
        ("bot", GREETING),
        ("bot", NOTICE),
        ("user", "Yes, I heard you, but I do not have a car to get to the center."),
    )
    verdict = judge_b_transcript(snapshot(transcript=transcript))
    assert verdict.acknowledged is Acknowledged.YES


def test_judge_b_does_not_read_a_denial_as_an_acknowledgement():
    verdict = judge_b_transcript(snapshot(transcript=DENIAL_TRANSCRIPT))
    assert verdict.acknowledged is Acknowledged.NO


def test_judge_b_reports_unknown_without_a_transcript():
    verdict = judge_b_transcript(snapshot(transcript=()))
    assert verdict.acknowledged is Acknowledged.UNKNOWN
    assert verdict.reason_code == "no_transcript"


def test_judge_b_tolerates_a_null_offset():
    transcript = (
        TranscriptTurn(index=0, speaker="bot", text=NOTICE, offset_seconds=None),
        TranscriptTurn(index=1, speaker="user", text="Yes, I heard it.", offset_seconds=None),
    )
    verdict = judge_b_transcript(snapshot(transcript=transcript))
    assert verdict.acknowledged is Acknowledged.YES
    assert verdict.evidence[0].offset_seconds is None


def test_judge_a_does_not_guess_voicemail_from_a_status():
    """The contract publishes no answering-machine indicator; Judge A must not invent one."""
    verdict = judge_a_structured(
        snapshot(status="failed", recipient_result=None, failure_code="no_answer_machine")
    )
    assert verdict.contact_type is ContactType.UNKNOWN


def test_agreement_requires_both_judges_to_reach_the_same_read():
    a = judge_a_structured(
        snapshot(recipient_result=result("live_person", "yes"), transcript=ACK_TRANSCRIPT)
    )
    b = judge_b_transcript(snapshot(transcript=ACK_TRANSCRIPT))
    assert judges_agree(a, b)

    b_unknown = judge_b_transcript(snapshot(transcript=()))
    assert not judges_agree(a, b_unknown)


# -- the confidence gate -----------------------------------------------------------


@pytest.mark.parametrize(
    "score,label,expected",
    [
        (0.93, "high", True),
        (0.80, "medium", True),
        (0.81, "low", True),
        (0.79, "medium", False),
        (None, "high", True),
        (None, "medium", False),
        (None, None, False),
        (0.99, None, True),
        (True, "unrecognised", False),
    ],
)
def test_the_confidence_gate(score, label, expected):
    assert confidence_passes(score, label, 0.80) is expected


# -- Judge C -----------------------------------------------------------------------


def test_judge_c_is_off_by_default():
    assert judge_c_enabled({}) is False
    assert DisabledJudgeC().enabled is False


def test_judge_c_requires_an_explicit_env_var():
    assert judge_c_enabled({JUDGE_C_ENV_VAR: "true"}) is True
    assert judge_c_enabled({JUDGE_C_ENV_VAR: "0"}) is False


class RecordingJudgeC:
    enabled = True

    def __init__(self):
        self.calls = 0

    def review(self, snapshot, a, b):
        self.calls += 1
        return "the reviewer should listen to the recording"


def test_judge_c_is_not_consulted_when_the_first_two_judges_agree():
    third = RecordingJudgeC()
    disposition = judge(
        snapshot(recipient_result=result("live_person", "yes"), transcript=ACK_TRANSCRIPT),
        judge_c=third,
    )
    assert third.calls == 0
    assert disposition.judge_c is None
    assert disposition.disposition is DispositionKind.CONFIRMED


def test_judge_c_adds_a_note_on_disagreement_but_never_overrides_it():
    third = RecordingJudgeC()
    disposition = judge(
        snapshot(recipient_result=result("live_person", "yes"), transcript=DENIAL_TRANSCRIPT),
        judge_c=third,
    )
    assert third.calls == 1
    assert disposition.judge_c == "the reviewer should listen to the recording"
    # The note does not rescue the disagreement.
    assert disposition.disposition is DispositionKind.NEEDS_HUMAN


def test_a_disabled_judge_c_is_never_consulted():
    disposition = judge(
        snapshot(recipient_result=result("live_person", "yes"), transcript=DENIAL_TRANSCRIPT),
        judge_c=DisabledJudgeC(),
    )
    assert disposition.judge_c is None


# -- evidence and redaction --------------------------------------------------------


def test_every_disposition_records_the_evidence_that_produced_it():
    disposition = judge(
        snapshot(recipient_result=result("live_person", "yes"), transcript=ACK_TRANSCRIPT)
    )
    assert disposition.evidence_spans
    assert any(span.source == "structured_result" for span in disposition.evidence_spans)


def test_notes_for_human_are_redacted_before_storage():
    disposition = judge(
        snapshot(
            recipient_result=result(
                "live_person",
                "yes",
                notes_for_human="Call her back on +14155550199 or sam@example.com",
            ),
            transcript=ACK_TRANSCRIPT,
        )
    )
    assert disposition.notes_for_human is not None
    assert "+14155550199" not in disposition.notes_for_human
    assert "sam@example.com" not in disposition.notes_for_human
