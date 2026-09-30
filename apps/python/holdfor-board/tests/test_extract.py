from __future__ import annotations

from holdfor.extract import EXTRACTION_FAILED, NOT_VERBATIM, extract
from holdfor.models import CallResult, CallState, Feeling, MedicationOk, Turn, WantsSeen

TURNS = [
    Turn(index=0, speaker="agent", text="Are you feeling better, the same, or worse?"),
    Turn(index=1, speaker="other", text="Worse. I can't get up the stairs any more."),
]


def result(structured):
    return CallResult(state=CallState.TERMINAL_VERIFIED, transcript=TURNS, structured=structured)


def base():
    return {
        "feeling": "worse",
        "medication_ok": "unsure",
        "wants_seen": "yes",
        "carried_words_text": "I can't get up the stairs any more.",
        "carried_words_turn": 1,
        "stop_condition": False,
        "stop_reason": None,
    }


def test_a_clean_transcript_maps_to_bounded_fields():
    extracted = extract(result(base()), medication_changed=True)
    assert extracted.feeling is Feeling.WORSE
    assert extracted.wants_seen is WantsSeen.YES
    assert extracted.medication_ok is MedicationOk.UNSURE
    assert extracted.stop_condition is False


def test_missing_structured_payload_is_a_stop_condition():
    extracted = extract(result(None), medication_changed=False)
    assert extracted.stop_condition is True
    assert extracted.stop_reason == EXTRACTION_FAILED


def test_unmappable_answer_is_a_stop_condition():
    payload = base() | {"feeling": "a bit peaky"}
    extracted = extract(result(payload), medication_changed=True)
    assert extracted.stop_condition is True
    assert extracted.stop_reason == EXTRACTION_FAILED


def test_carried_words_must_be_a_verbatim_span_of_the_named_turn():
    payload = base() | {"carried_words_text": "The patient reports difficulty with stairs."}
    extracted = extract(result(payload), medication_changed=True)
    assert extracted.stop_condition is True
    assert extracted.stop_reason == NOT_VERBATIM


def test_carried_words_must_come_from_the_patient_not_the_agent():
    payload = base() | {
        "carried_words_text": "Are you feeling better",
        "carried_words_turn": 0,
    }
    extracted = extract(result(payload), medication_changed=True)
    assert extracted.stop_reason == NOT_VERBATIM


def test_carried_words_must_match_the_turn_they_claim_to_come_from():
    payload = base() | {"carried_words_turn": 0}
    extracted = extract(result(payload), medication_changed=True)
    assert extracted.stop_reason == NOT_VERBATIM


def test_medication_is_not_asked_when_medication_did_not_change():
    payload = base() | {"medication_ok": "yes"}
    extracted = extract(result(payload), medication_changed=False)
    assert extracted.medication_ok is MedicationOk.NOT_ASKED


def test_medication_stays_unset_when_it_changed_but_was_never_asked():
    payload = base() | {"medication_ok": "not_asked"}
    extracted = extract(result(payload), medication_changed=True)
    assert extracted.medication_ok is None
    assert extracted.stop_condition is False
