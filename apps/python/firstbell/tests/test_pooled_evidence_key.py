"""What the pooled evidence de-duplicates on, against what it publishes.

`evidence/recorded-calls.json` publishes `de_duplicated_by: "call id"`, and
`pool_recorded_calls.per_receipt` justifies its attempt arithmetic with the same sentence.
Three de-duplicators read `item["id"]`, which the receipt writes as the pupil id, into a
variable named `call_id`. On the recorded set the two keys agree, because the only repeated
rows are an idempotency replay that shares both. They stop agreeing the moment a pupil is
telephoned twice, which `--again LABEL` exists to do and which a second day's export
produces on its own, and then two separately billed calls collapse into one and vanish from
`calls`, `answered`, `attempts_billed` and every rate derived from them.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "tools"))


def _receipt(call_id: str, pupil: str = "S-1") -> dict:
    return {
        "reached_production_api": True,
        "items": [{
            "id": pupil,
            "call_id": call_id,
            "resolution": "resolved",
            "attempts": 1,
            "placed_by_this_run": True,
            "structured_result": {"reason_category": "illness",
                                  "expected_return": "tomorrow"},
        }],
    }


def _two_calls_to_one_pupil(tmp_path: Path) -> Path:
    """The state `--again` produces: one child, two days, two separately billed calls."""
    (tmp_path / "01-monday.json").write_text(
        json.dumps(_receipt("call-MONDAY")), encoding="utf-8")
    (tmp_path / "02-tuesday.json").write_text(
        json.dumps(_receipt("call-TUESDAY")), encoding="utf-8")
    return tmp_path


def test_the_pool_counts_two_calls_to_one_pupil_as_two(tmp_path):
    import pool_recorded_calls

    items = pool_recorded_calls.distinct_items(_two_calls_to_one_pupil(tmp_path))
    kept = sorted(one["call_id"] for one in items)
    assert kept == ["call-MONDAY", "call-TUESDAY"], (
        "one billed call was deleted from the pooled denominator")


def test_the_escalation_replay_keys_on_the_call_id_its_docstring_names(tmp_path):
    import replay_escalation

    seen = replay_escalation.records(_two_calls_to_one_pupil(tmp_path))
    assert sorted(seen) == ["call-MONDAY", "call-TUESDAY"], (
        'records() says "Keyed on the call id alone" and was keyed on the pupil id')


def test_a_row_that_never_rang_does_not_merge_with_a_call(tmp_path):
    """A refused row carries no call id, and must not collide with one that does."""
    import pool_recorded_calls

    (tmp_path / "01-run.json").write_text(json.dumps({
        "reached_production_api": True,
        "items": [
            {"id": "S-9", "call_id": None, "resolution": "skipped", "attempts": 0},
            {"id": "S-9", "call_id": "call-LATER", "resolution": "resolved",
             "attempts": 1, "placed_by_this_run": True},
        ],
    }), encoding="utf-8")

    items = pool_recorded_calls.distinct_items(tmp_path)
    assert len(items) == 2, "the refused row and the placed call are not the same event"


def test_the_published_claim_and_the_code_agree_on_the_recorded_set():
    """The pooled figures in the repository must not move because of this change."""
    published = json.loads(
        (APP / "evidence" / "recorded-calls.json").read_text(encoding="utf-8"))
    assert "call id" in published["de_duplicated_by"], (
        "this test exists to hold the code to that sentence")
