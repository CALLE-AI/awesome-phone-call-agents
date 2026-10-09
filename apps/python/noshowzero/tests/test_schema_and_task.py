import pytest

from noshowzero.schema import OFFER_RESULT_SCHEMA, REMINDER_RESULT_SCHEMA, unsupported_keywords
from noshowzero.task import build_offer_task, build_reminder_task, local_slot

SCHEMAS = [REMINDER_RESULT_SCHEMA, OFFER_RESULT_SCHEMA]


@pytest.mark.parametrize("schema", SCHEMAS)
def test_schema_stays_inside_calle_supported_subset(schema):
    assert unsupported_keywords(schema) == []


@pytest.mark.parametrize("schema", SCHEMAS)
def test_schema_is_closed_and_fully_required(schema):
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])


@pytest.mark.parametrize("schema", SCHEMAS)
def test_every_decision_enum_can_say_unknown(schema):
    for name, prop in schema["properties"].items():
        if "enum" in prop:
            assert "unknown" in prop["enum"], name
        assert prop.get("description"), name


def test_unsupported_keywords_are_reported():
    bad = {"type": "object", "properties": {"x": {"type": "string", "format": "date"}}, "additionalProperties": True}
    found = unsupported_keywords(bad)
    assert "$.properties.x.format" in found and any("additionalProperties" in f for f in found)


def test_time_is_spoken_in_the_clinic_timezone():
    assert local_slot("2026-09-11T20:30:00Z", "America/New_York") == ("4:30 PM", "Friday, September 11")
    assert local_slot("2026-09-11T20:30:00Z", "America/Los_Angeles")[0] == "1:30 PM"


def test_naive_times_are_refused():
    with pytest.raises(ValueError):
        local_slot("2026-09-11T16:30:00", "America/New_York")


def test_reminder_task(clinic, appointment):
    task = build_reminder_task(clinic, appointment)
    assert "Bright Smile Dental" in task and "4:30 PM on Friday, September 11" in task
    assert "virtual assistant" in task and "If asked whether you are an AI, say yes" in task
    assert "Never give medical advice" in task
    assert "do not share any appointment details" in task
    assert "Do not mention the service" in task  # voicemail stays discreet
    assert "555-0116" not in task and "5550116" not in task  # the patient's own number is never in the task


def test_reminder_task_speaks_the_patient_language(clinic, appointment):
    assert "Speak Spanish for the whole call" in build_reminder_task(clinic, appointment | {"language": "es-US"})


def test_offer_task(clinic, waitlist):
    task = build_offer_task(clinic, waitlist[3], "2026-09-11T20:30:00Z", "Dental Cleaning")
    assert "waitlist" in task and "4:30 PM on Friday, September 11" in task
    assert "never pressure the patient" in task
    assert "Do not promise a text or email" in task
    assert "5550199" not in task
