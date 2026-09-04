"""Tests for the CALL-E payload adapter.

The payloads below follow the shapes published in the CALL-E OpenAPI 3.1
contract (v0.6.0). Phone numbers are from the reserved fictional NANP block.
"""

from __future__ import annotations

from typing import Any

import pytest

from redline.calle.models import (
    CalleParseError,
    call_record_from_payload,
    speaker_from_calle,
    unwrap_payload,
)
from redline.types import Disposition, GroundTruth, Speaker

TRUTH = GroundTruth(disposition=Disposition.ANSWERED)


def build_task(**overrides: Any) -> dict[str, Any]:
    """A completed single-recipient call task, as CALL-E returns it."""
    task: dict[str, Any] = {
        "id": "call_123",
        "object": "call_task",
        "status": "completed",
        "task": "Call the recipient and confirm Thursday's appointment.",
        "recipients": [
            {
                "id": "rcp_123",
                "phones": ["+14155550142"],  # redline-allow: e164
                "locale": "en-US",
                "region": "US",
                "status": "completed",
                "structured_result": {"can_attend": "yes"},
                "summary": "The recipient can attend.",
                "attempts": [
                    {
                        "id": "att_123",
                        "phone": "+14155550142",  # redline-allow: e164
                        "status": "completed",
                        "started_at": "2026-06-01T17:00:05Z",
                        "completed_at": "2026-06-01T17:01:00Z",
                        "summary": "The recipient can attend.",
                        "transcript_turns": [
                            {
                                "offset_seconds": 0,
                                "speaker": "bot",
                                "text": "Can you attend Thursday?",
                            },
                            {
                                "offset_seconds": 8,
                                "speaker": "user",
                                "text": "Yes, I can attend.",
                            },
                        ],
                        "provider_call_id": "provider_call_123",
                        "failure_code": None,
                        "failure_message": None,
                    }
                ],
            }
        ],
        "structured_result": {"completed_count": 1},
        "summary": "The recipient can attend.",
        "task_completed": True,
        "completion_confidence": {"score": 0.92, "label": "high"},
        "evidence": ["The recipient said yes."],
        "metadata": {},
        "failure_code": None,
        "failure_message": None,
        "created_at": "2026-06-01T17:00:00Z",
        "completed_at": "2026-06-01T17:01:00Z",
    }
    task.update(overrides)
    return task


def parse(payload: dict[str, Any], **kwargs: Any):
    defaults: dict[str, Any] = {
        "scenario_id": "demo",
        "ground_truth": TRUTH,
        "transport": "replay",
    }
    defaults.update(kwargs)
    return call_record_from_payload(payload, **defaults)


class TestSpeakerMapping:
    @pytest.mark.parametrize(
        ("label", "expected"),
        [
            ("bot", Speaker.AGENT),
            ("BOT", Speaker.AGENT),
            ("user", Speaker.CALLEE),
            ("unknown", Speaker.UNKNOWN),
        ],
    )
    def test_documented_labels_map(self, label: str, expected: Speaker) -> None:
        assert speaker_from_calle(label) is expected

    @pytest.mark.parametrize("label", ["operator", "", None, 7, {"a": 1}])
    def test_anything_else_degrades_to_unknown(self, label: object) -> None:
        # An enum can grow a member after we ship. Degrading beats crashing,
        # and beats guessing: `unknown` turns are never searched for canaries.
        assert speaker_from_calle(label) is Speaker.UNKNOWN


class TestUnwrapping:
    def test_a_bare_call_task_passes_through(self) -> None:
        task = build_task()
        assert unwrap_payload(task)["id"] == "call_123"

    def test_a_webhook_envelope_is_unwrapped(self) -> None:
        envelope = {
            "id": "evt_123",
            "type": "call.completed",
            "created_at": "2026-06-01T17:01:00Z",
            "data": build_task(),
        }
        assert unwrap_payload(envelope)["id"] == "call_123"

    def test_a_webhook_fixture_and_a_poll_fixture_agree(self) -> None:
        task = build_task()
        envelope = {"id": "evt_1", "type": "call.completed", "data": task}
        assert parse(task) == parse(envelope)


class TestTranscript:
    def test_turns_are_indexed_and_attributed(self) -> None:
        record = parse(build_task())
        assert [(t.index, t.speaker) for t in record.transcript] == [
            (0, Speaker.AGENT),
            (1, Speaker.CALLEE),
        ]

    def test_offsets_are_carried(self) -> None:
        record = parse(build_task())
        assert [t.offset_seconds for t in record.transcript] == [0, 8]

    def test_null_offsets_survive(self) -> None:
        task = build_task()
        task["recipients"][0]["attempts"][0]["transcript_turns"][0][
            "offset_seconds"
        ] = None
        assert parse(task).transcript[0].offset_seconds is None

    def test_turns_without_text_are_dropped(self) -> None:
        task = build_task()
        task["recipients"][0]["attempts"][0]["transcript_turns"].append(
            {"offset_seconds": 12, "speaker": "bot"}
        )
        assert parse(task).turn_count == 2

    def test_the_last_attempt_is_the_one_evaluated(self) -> None:
        # CALL-E retried. The final attempt holds the conversation that
        # produced the result; earlier ones stay in `raw`.
        task = build_task()
        attempts = task["recipients"][0]["attempts"]
        attempts.insert(
            0,
            {
                "id": "att_000",
                "phone": "+14155550142",  # redline-allow: e164
                "status": "failed",
                "started_at": None,
                "completed_at": None,
                "summary": None,
                "transcript_turns": [
                    {"offset_seconds": 0, "speaker": "bot", "text": "first try"}
                ],
                "provider_call_id": None,
                "failure_code": "no_answer",
                "failure_message": "Nobody answered.",
            },
        )
        record = parse(task)
        assert record.transcript[0].text == "Can you attend Thursday?"
        assert len(record.raw["recipients"][0]["attempts"]) == 2

    def test_a_task_without_recipients_has_an_empty_transcript(self) -> None:
        # A task-only call is legal: CALL-E infers the target from the text.
        record = parse(build_task(recipients=[]))
        assert record.transcript == ()
        assert record.structured_result == {"completed_count": 1}


class TestPlatformClaims:
    def test_completion_and_confidence_are_carried(self) -> None:
        record = parse(build_task())
        assert record.task_completed is True
        assert record.completion_confidence is not None
        assert record.completion_confidence.score == pytest.approx(0.92)
        assert record.completion_confidence.label == "high"

    def test_evidence_is_a_tuple_of_strings(self) -> None:
        assert parse(build_task()).evidence == ("The recipient said yes.",)

    def test_non_string_evidence_items_are_dropped(self) -> None:
        task = build_task(evidence=["kept", 42, None, {"a": 1}])
        assert parse(task).evidence == ("kept",)

    def test_missing_completion_stays_none_not_false(self) -> None:
        # `task_completed` is nullable until CALL-E has a terminal outcome.
        # Collapsing null to False would invent a failed call.
        assert parse(build_task(task_completed=None)).task_completed is None

    def test_a_malformed_confidence_is_dropped_not_fatal(self) -> None:
        # An out-of-range score is a platform bug. Losing one field beats
        # losing the whole record.
        task = build_task(completion_confidence={"score": 1.7, "label": "high"})
        assert parse(task).completion_confidence is None

    def test_confidence_without_a_label_still_parses(self) -> None:
        task = build_task(completion_confidence={"score": 0.5})
        confidence = parse(task).completion_confidence
        assert confidence is not None and confidence.label == "unknown"

    def test_duration_is_derived_from_the_attempt_timestamps(self) -> None:
        assert parse(build_task()).duration_seconds == 55

    def test_duration_is_none_when_the_attempt_is_open(self) -> None:
        task = build_task()
        task["recipients"][0]["attempts"][0]["completed_at"] = None
        assert parse(task).duration_seconds is None

    def test_attempt_failure_code_wins_over_task_level(self) -> None:
        task = build_task(failure_code="internal_error")
        task["recipients"][0]["attempts"][0]["failure_code"] = "no_answer"
        assert parse(task).failure_code == "no_answer"

    def test_raw_payload_is_kept_for_audit(self) -> None:
        assert parse(build_task()).raw["id"] == "call_123"


class TestResultLevelSelection:
    def test_auto_prefers_the_recipient_result(self) -> None:
        # The per-recipient schema is the more specific claim about the person
        # who actually answered.
        assert parse(build_task()).structured_result == {"can_attend": "yes"}

    def test_auto_falls_back_to_the_task_result(self) -> None:
        task = build_task()
        task["recipients"][0]["structured_result"] = None
        assert parse(task).structured_result == {"completed_count": 1}

    def test_explicit_task_level_ignores_the_recipient(self) -> None:
        record = parse(build_task(), result_level="task")
        assert record.structured_result == {"completed_count": 1}

    def test_explicit_recipient_level_does_not_fall_back(self) -> None:
        task = build_task()
        task["recipients"][0]["structured_result"] = None
        assert parse(task, result_level="recipient").structured_result is None

    def test_a_null_result_is_preserved(self) -> None:
        # CALL-E returns null when it could not produce a schema-valid result.
        # That fail-closed signal must reach the evaluator intact.
        task = build_task(structured_result=None)
        task["recipients"][0]["structured_result"] = None
        assert parse(task).structured_result is None


class TestRecipientSelection:
    def test_a_batch_call_can_be_read_per_recipient(self) -> None:
        task = build_task()
        second = {
            **task["recipients"][0],
            "id": "rcp_456",
            "structured_result": {"can_attend": "no"},
        }
        task["recipients"].append(second)
        assert parse(task, recipient_index=1).structured_result == {"can_attend": "no"}

    def test_an_out_of_range_recipient_is_an_error(self) -> None:
        with pytest.raises(CalleParseError, match="out of range"):
            parse(build_task(), recipient_index=4)


class TestMalformedPayloads:
    def test_a_recipient_that_is_not_an_object_is_an_error(self) -> None:
        with pytest.raises(CalleParseError, match="not a JSON object"):
            parse(build_task(recipients=["oops"]))

    def test_missing_optional_blocks_do_not_raise(self) -> None:
        record = parse({"object": "call_task", "id": "call_1"})
        assert record.transcript == ()
        assert record.task_completed is None
        assert record.evidence == ()
        assert record.structured_result is None

    def test_an_unparseable_timestamp_yields_no_duration(self) -> None:
        task = build_task()
        task["recipients"][0]["attempts"][0]["started_at"] = "not-a-date"
        assert parse(task).duration_seconds is None

    def test_ground_truth_is_carried_untouched(self) -> None:
        truth = GroundTruth(disposition=Disposition.VOICEMAIL, human_confirmed=False)
        record = parse(build_task(), ground_truth=truth)
        assert record.ground_truth is truth
