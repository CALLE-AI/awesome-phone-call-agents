"""The transcript reader, tested on the conversations that should defeat it.

The interesting cases here are not the ones that work. They are the ones where a
call plainly happened, a value was plainly discussed, and the answer still has
to be "not established": a value the assistant introduced, a readback with one
part wrong, an agreement that carries a correction inside it.
"""

from __future__ import annotations

import pytest

from callibrate.calling.models import CallOutcome
from callibrate.contracts.models import EvidenceRequirements, VerificationContract
from callibrate.evidence.reconcile import build_evidence
from callibrate.evidence.transcript import (
    names_more_than_one_session,
    normalize_turns,
    speaker_role,
    spoken_schedule,
)
from tests.conftest import turns


def read(contract: VerificationContract, raw, outcome=CallOutcome.COMPLETED):
    return build_evidence(
        contract, turns=normalize_turns(raw), caller="test", outcome=outcome
    )


# --------------------------------------------------------------- normalising


def test_calle_speaker_labels_become_callibrate_roles():
    assert speaker_role("bot") == "assistant"
    assert speaker_role("user") == "provider"


def test_an_unknown_speaker_is_never_treated_as_the_provider():
    """A label we do not recognise must not be able to satisfy a readback."""
    assert speaker_role("operator3") == "system"
    assert speaker_role("") == "system"


def test_the_stored_transcript_is_redacted():
    normalized = normalize_turns(turns(("user", "Call us on 555 010 1101 instead")))
    assert "555" not in normalized[0].text
    assert "REDACTED" in normalized[0].text.upper()


# ------------------------------------------------------------------ parsing


@pytest.mark.parametrize(
    ("sentence", "expected"),
    [
        ("It is ten until one now.", "WE 10:00-13:00"),
        ("We moved to ten thirty until two.", "WE 10:30-14:00"),
        ("Wednesdays nine to twelve.", "WE 09:00-12:00"),
        ("We open 09:00 and close 12:30.", "WE 09:00-12:30"),
    ],
)
def test_spoken_hours_become_a_canonical_value(sentence, expected):
    assert spoken_schedule(sentence, default_days=["WE"]) == expected


@pytest.mark.parametrize(
    "sentence",
    [
        "We are open most mornings.",
        "It is about ten-ish.",
        "Seven in the evening until seven in the morning.",
        "Just the one time, ten o'clock.",
    ],
)
def test_a_sentence_that_cannot_be_read_produces_no_candidate(sentence):
    """No candidate means a curator, which is the correct failure direction."""
    assert spoken_schedule(sentence, default_days=["WE"]) is None


@pytest.mark.parametrize(
    "sentence",
    [
        # The first two times and both days would publish Thursday as ten to
        # twelve, which is the sentence's Tuesday and nobody's Thursday.
        "Tuesdays ten to twelve and Thursdays one to three.",
        "We are open ten to twelve and again one to three.",
        "Tuesdays ten to twelve, Thursdays closed.",
        "Mondays and Wednesdays nine to twelve, Fridays two to four.",
    ],
)
def test_more_than_one_session_in_a_sentence_produces_no_candidate(sentence):
    """A record value holds one range, so half a sentence is never the answer."""
    assert spoken_schedule(sentence, default_days=["WE"]) is None
    assert names_more_than_one_session(sentence)


@pytest.mark.parametrize(
    ("sentence", "expected"),
    [
        ("Tuesdays and Thursdays ten to twelve.", "TU,TH 10:00-12:00"),
        ("Ten to twelve on Tuesdays and Thursdays.", "TU,TH 10:00-12:00"),
        ("Weekdays nine to five.", "MO,TU,WE,TH,FR 09:00-17:00"),
    ],
)
def test_one_range_over_several_days_is_still_one_session(sentence, expected):
    assert spoken_schedule(sentence, default_days=["WE"]) == expected
    assert not names_more_than_one_session(sentence)


def test_the_pronoun_we_is_not_wednesday():
    """The pronoun in "we open ten until one" is not a day of the week."""
    assert spoken_schedule("We open ten until one.", default_days=["MO"]) == "MO 10:00-13:00"


# ------------------------------------------------------------------ evidence


def test_explicit_change_read_back_and_confirmed_is_supported(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. We publish Wednesdays nine until twelve. Is that still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "So that is Wednesdays, ten in the morning until one in the afternoon?"),
            ("user", "Yes, that is right."),
        ),
    )
    claim = evidence.claims[0]
    assert claim.proposed_value == "WE 10:00-13:00"
    assert claim.explicit_statement
    assert claim.read_back_confirmed
    assert not claim.ambiguous


def test_a_value_the_assistant_introduced_is_not_evidence(contract):
    """The agent guesses, the provider says "sure". That is not a fact."""
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. I think you moved to ten until one on Wednesdays?"),
            ("user", "Sure."),
        ),
    )
    assert not evidence.claims
    assert evidence.unresolved_questions


def test_a_readback_with_one_part_wrong_is_not_confirmed(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. Is Wednesday nine until twelve still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "So Wednesdays, ten in the morning until three in the afternoon?"),
            ("user", "Yes."),
        ),
    )
    claim = evidence.claims[0]
    assert not claim.read_back_confirmed


def test_agreement_carrying_a_correction_is_not_agreement(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. Is Wednesday nine until twelve still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "Wednesdays, ten in the morning until one in the afternoon?"),
            ("user", "Yes, but actually it changed again last week."),
        ),
    )
    assert not evidence.claims[0].read_back_confirmed


def test_a_hedged_statement_is_marked_ambiguous(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. Is Wednesday nine until twelve still right?"),
            ("user", "I think it might be ten until one, but I would have to check."),
            ("bot", "Wednesdays, ten in the morning until one in the afternoon?"),
            ("user", "Yes, probably."),
        ),
    )
    assert evidence.claims[0].ambiguous


def test_confirming_the_published_value_is_a_confirmation_not_a_change(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. We publish Wednesdays nine until twelve. Is that still right?"),
            ("user", "That is correct, unchanged."),
        ),
    )
    assert not evidence.claims
    assert evidence.confirmations[0].field == "schedule"


def test_a_closure_mentioned_on_a_call_about_hours_is_never_dropped(contract):
    """We called about opening hours. They said the programme is ending."""
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant, calling about the weekly grocery pickup."),
            ("user", "We are ending the program next month, it closed to new people already."),
        ),
    )
    status = [claim for claim in evidence.claims if claim.field == "status"]
    assert status and status[0].removes_service


def test_two_sessions_read_back_faithfully_still_change_nothing(contract):
    """The readback is accurate, the provider agrees, and the record holds one range.

    This is the shape that would publish a false change if the reader kept the
    first two times: the provider says Thursday afternoon, the agent says
    Thursday afternoon, and only the candidate has lost it. There is no
    candidate, and the curator is told which sentence was not read.
    """
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. We publish Wednesdays nine until twelve. Is that still right?"),
            ("user", "Tuesdays ten to twelve and Thursdays one to three."),
            ("bot", "So that is Tuesdays ten to twelve and Thursdays one to three, correct?"),
            ("user", "Yes, that is right."),
        ),
    )
    assert not [claim for claim in evidence.claims if claim.field == "schedule"]
    assert not evidence.confirmations
    assert any("more than one session" in question for question in evidence.unresolved_questions)


def test_a_readback_that_adds_a_day_and_a_time_is_not_a_readback(contract):
    """Every part of the value is in the utterance, and so is a Thursday nobody has."""
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant. Is Wednesday nine until twelve still right?"),
            ("user", "It moved to ten until one."),
            ("bot", "So Wednesdays ten in the morning until one in the afternoon, and Thursdays two until four?"),
            ("user", "Yes."),
        ),
    )
    claim = evidence.claims[0]
    assert claim.proposed_value == "WE 10:00-13:00"
    assert not claim.read_back_confirmed
    assert "does not hold" in claim.evidence_note


def test_a_stop_request_is_a_safety_event(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant calling about your listing."),
            ("user", "Please stop calling and take us off your list."),
        ),
    )
    assert evidence.outcome == CallOutcome.STOP_REQUESTED
    assert any(event.kind.value == "stop_requested" for event in evidence.safety_events)


def test_a_help_seeker_answering_is_a_safety_event(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "This is an automated assistant calling about the weekly grocery pickup."),
            ("user", "I need food for my children, can you help me?"),
        ),
    )
    assert evidence.outcome == CallOutcome.REACHED_CLIENT


def test_a_missing_disclosure_is_recorded_against_the_call(contract):
    evidence = read(
        contract,
        turns(
            ("bot", "Hi, quick question about your opening hours."),
            ("user", "They are ten until one now."),
        ),
    )
    assert not evidence.disclosure_spoken
    assert any(event.kind.value == "no_disclosure" for event in evidence.safety_events)


def test_a_caller_claim_the_transcript_does_not_support_survives_with_zero_confidence(contract):
    """CALL-E says the hours changed. The transcript does not say it.

    The claim is neither trusted nor discarded: it reaches a curator with the
    reason it was not trusted attached to it.
    """
    evidence = build_evidence(
        contract,
        turns=normalize_turns(
            turns(
                ("bot", "This is an automated assistant. Is Wednesday nine until twelve still right?"),
                ("user", "Hmm."),
            )
        ),
        caller="call-e",
        outcome=CallOutcome.COMPLETED,
        caller_result={"structured_result": {"schedule": "WE 10:00-13:00"}},
    )
    claim = evidence.claims[0]
    assert claim.confidence == 0.0
    assert not claim.explicit_statement
    assert "does not state it" in claim.evidence_note or "no provider turn" in claim.evidence_note


def test_caller_and_transcript_disagreeing_is_flagged(contract):
    evidence = build_evidence(
        contract,
        turns=normalize_turns(
            turns(
                ("bot", "This is an automated assistant. Is Wednesday nine until twelve still right?"),
                ("user", "It moved to ten until one."),
                ("bot", "Wednesdays ten in the morning until one in the afternoon?"),
                ("user", "Yes."),
            )
        ),
        caller="call-e",
        outcome=CallOutcome.COMPLETED,
        caller_result={"structured_result": {"schedule": "WE 11:00-14:00"}},
    )
    claim = evidence.claims[0]
    assert claim.ambiguous
    assert "disagree" in claim.evidence_note or "different values" in claim.evidence_note


def test_a_phone_change_cannot_be_corroborated_from_a_redacted_transcript(contract):
    """Stated, not hidden: redaction makes a phone readback uncheckable."""
    phone_contract = contract.model_copy(
        update={"fields_to_verify": ["phone"], "current_record": {"phone": "+15550101101"}}
    )
    evidence = read(
        phone_contract,
        turns(
            ("bot", "This is an automated assistant. Is 555 010 1101 still your number?"),
            ("user", "No, it is 555 010 2202 now."),
            ("bot", "555 010 2202?"),
            ("user", "Yes."),
        ),
    )
    assert not evidence.claims
    assert any("masks" in question for question in evidence.unresolved_questions)


def test_requirements_can_be_relaxed_but_the_transcript_still_decides(contract):
    """Turning the readback requirement off is a contract decision, not a bug.

    It changes what the policy will accept. It does not change what the
    transcript reader reports, which is the property that matters.
    """
    relaxed = contract.model_copy(
        update={"evidence_requirements": EvidenceRequirements(readback_required=False)}
    )
    evidence = read(
        relaxed,
        turns(
            ("bot", "This is an automated assistant. Is Wednesday nine until twelve still right?"),
            ("user", "It moved to ten until one."),
        ),
    )
    claim = evidence.claims[0]
    assert claim.explicit_statement
    assert not claim.readback_turn_ids
