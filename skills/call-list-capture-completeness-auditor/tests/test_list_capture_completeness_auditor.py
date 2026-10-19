#!/usr/bin/env python3
"""Tests for the call-list-capture-completeness-auditor skill.

Run:
    python3 -m pytest skills/call-list-capture-completeness-auditor/tests/test_list_capture_completeness_auditor.py -v
    python3 skills/call-list-capture-completeness-auditor/tests/test_list_capture_completeness_auditor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

TESTS = Path(__file__).resolve().parent
SKILL_DIR = TESTS.parent
SCRIPTS = SKILL_DIR / "scripts"
FIXTURES = SKILL_DIR / "data" / "fixtures"

sys.path.insert(0, str(SCRIPTS))
from list_capture_completeness_auditor import (  # noqa: E402
    analyze_payload,
    analyze_turns,
    fold_plural,
    item_tokens,
    mask_pii,
)


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"role": r, "text": t} for r, t in pairs]


def _fixture(idx: int) -> dict:
    return json.loads((FIXTURES / f"demo-list-{idx:03d}.json").read_text(encoding="utf-8"))


def _turns_of(idx: int) -> list:
    return _fixture(idx)["transcript"]


def _item_displays(report: dict) -> list[str]:
    return [item["item"] for lst in report["lists"] for item in lst["items"]]


# ---------------------------------------------------------------- loader

def test_wrapped_shape_result_transcript():
    fixture = _fixture(1)
    payload = {
        "status": "COMPLETED",
        "result": {
            "call_id": "demo-list-001",
            "post_summary": "requests noted",
            "transcript": fixture["transcript"],
        },
    }
    report = analyze_payload(payload)
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"
    assert report["call_id"] == "demo-list-001"
    assert report["mode"] == "analyze"


def test_bare_dict_shape():
    fixture = _fixture(1)
    report = analyze_payload({"call_id": "cid-1", "transcript": fixture["transcript"]})
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"
    assert report["call_id"] == "cid-1"


def test_flat_list_shape():
    report = analyze_turns(_turns_of(1))
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"
    assert report["call_id"] is None


def test_speaker_alias():
    turns = [
        {"speaker": "bot", "text": "Front desk, hello."},
        {"speaker": "customer", "text": "I need a crib and late checkout."},
        {"speaker": "bot", "text": "Let me read that back: a crib and late checkout. Is that everything?"},
    ]
    report = analyze_turns(turns)
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"
    assert report["counts"]["items_total"] == 2


def test_non_dict_items_skipped():
    turns = [
        {"role": "agent", "text": "Front desk, hello."},
        "not a dict",
        None,
        {"role": "callee", "text": "I need a crib and late checkout."},
        {"role": "agent", "text": "Let me read that back: a crib and late checkout. Is that everything?"},
    ]
    report = analyze_turns(turns)
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"


def test_typographic_apostrophe_regression():
    turns = _turns(
        ("agent", "Harbor Grill, this is Dana."),
        ("callee", "Hi, we need a crib, late checkout, and a room on a high floor."),
        ("agent", "Of course. Let me read that back: a crib, late checkout, and a room on a high floor. Is that everything?"),
        ("callee", "That\u2019s everything."),
        ("agent", "Perfect, all three requests are noted on your reservation."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"


def test_call_id_top_level_preferred():
    payload = {"call_id": "top-level", "result": {"call_id": "nested", "transcript": []}}
    report = analyze_payload(payload)
    assert report["call_id"] == "top-level"


def test_call_id_nested_in_result():
    payload = {"result": {"call_id": "nested", "transcript": []}}
    report = analyze_payload(payload)
    assert report["call_id"] == "nested"


def test_empty_transcript_no_list():
    report = analyze_turns([])
    assert report["verdict"] == "NO_LIST_EXCHANGED"
    assert report["review_action"] == "none"


# ---------------------------------------------------------------- chunking / item normalization

def test_three_chunk_sentence_makes_three_items():
    turns = _turns(("callee", "We need a crib, late checkout, and parking."))
    report = analyze_turns(turns)
    assert report["counts"]["lists_detected"] == 1
    assert report["counts"]["items_total"] == 3


def test_also_sentence_extends_active_list():
    turns = _turns(
        ("callee", "We need a crib and late checkout."),
        ("callee", "Also a fridge please."),
    )
    report = analyze_turns(turns)
    assert report["counts"]["lists_detected"] == 1
    assert report["counts"]["items_total"] == 3
    assert "fridge" in _item_displays(report)


def test_first_and_then_two_chunks():
    turns = _turns(("callee", "First a crib and then late checkout."))
    report = analyze_turns(turns)
    assert report["counts"]["lists_detected"] == 1
    assert report["counts"]["items_total"] == 2


def test_single_chunk_sentence_no_list():
    turns = _turns(("callee", "We need one crib."))
    report = analyze_turns(turns)
    assert report["counts"]["lists_detected"] == 0


def test_quantifier_strip_number_word():
    assert item_tokens("two large pizzas") == {"large", "pizza"}


def test_quantifier_strip_digit():
    assert item_tokens("2 large pizzas") == {"large", "pizza"}


def test_plural_fold():
    assert fold_plural("salads") == "salad"
    assert fold_plural("salad") == "salad"


# ---------------------------------------------------------------- readback / matching

def test_paraphrase_capture_number_word_vs_digit():
    turns = _turns(
        ("callee", "We need two large pizzas and a garden salad."),
        ("agent", "I have you down for 2 large pizzas and a garden salad. Is that everything?"),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"
    assert report["counts"]["items_captured"] == 2
    assert report["counts"]["items_dropped"] == 0


def test_dropped_item_callee_restatement_does_not_capture():
    turns = _turns(
        ("agent", "Harbor Grill, this is Dana."),
        ("callee", "Hi, we need a crib, late checkout, and a room on a high floor."),
        ("agent", "Of course. Let me read that back: a crib and late checkout. Is that everything?"),
        ("callee", "And the high floor."),
        ("agent", "Got it."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "ITEMS_DROPPED"
    assert [d["item"] for d in report["dropped_items"]] == ["high floor"]


def test_added_item_in_confirmation_sentence():
    turns = _turns(
        ("agent", "Harbor Grill, this is Dana."),
        ("callee", "Hi, we need a crib and late checkout."),
        ("agent", "I have you down for a crib, late checkout, and the breakfast package. Is that everything?"),
        ("callee", "Uh, sure."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "ITEMS_ADDED"
    assert [a["item"] for a in report["added_items"]] == ["breakfast package"]
    assert report["counts"]["lists_detected"] == 1


def test_agent_suggestion_outside_confirmation_not_added():
    turns = _turns(
        ("callee", "I need a crib and late checkout."),
        ("agent", "We also offer parking, by the way."),
        ("agent", "Let me confirm: a crib, late checkout, and parking. Is that everything?"),
    )
    report = analyze_turns(turns)
    assert report["added_items"] == []
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"


def test_both_dropped_and_added():
    turns = _turns(
        ("callee", "I need a crib and late checkout."),
        ("agent", "I have you down for a crib and parking. Is that everything?"),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "BOTH_DROPPED_AND_ADDED"
    assert report["review_action"] == (
        "rework the goal template readback: capture every item and drop invented ones"
    )


def test_no_readback_detected():
    turns = _turns(
        ("callee", "I need a crib and late checkout."),
        ("agent", "We have a crib available."),
        ("agent", "Late checkout is possible too."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "NO_READBACK_DETECTED"
    assert report["review_action"] == "add a closing readback step to the goal template"


def test_verdict_priority_both_beats_dropped():
    turns = _turns(
        ("callee", "I need a crib and late checkout and parking."),
        ("agent", "I have you down for a crib and a fridge."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "BOTH_DROPPED_AND_ADDED"


# ---------------------------------------------------------------- fixture grading

def test_fixture_001_all_captured_counts():
    report = analyze_turns(_turns_of(1))
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"
    assert report["review_action"] == "none"
    assert report["counts"] == {
        "lists_detected": 1,
        "items_total": 3,
        "items_captured": 3,
        "items_dropped": 0,
        "items_added": 0,
    }


def test_fixture_002_dropped_exactly_high_floor():
    report = analyze_turns(_turns_of(2))
    assert report["verdict"] == "ITEMS_DROPPED"
    assert report["review_action"] == "add item-by-item readback to the goal template"
    assert [d["item"] for d in report["dropped_items"]] == ["high floor"]
    assert report["counts"]["items_added"] == 0


def test_fixture_003_added_exactly_breakfast_package():
    report = analyze_turns(_turns_of(3))
    assert report["verdict"] == "ITEMS_ADDED"
    assert report["review_action"] == "remove unverifiable items from the confirmation script"
    assert [a["item"] for a in report["added_items"]] == ["breakfast package"]
    assert report["counts"]["items_dropped"] == 0


def test_fixture_004_no_list_exchanged():
    report = analyze_turns(_turns_of(4))
    assert report["verdict"] == "NO_LIST_EXCHANGED"
    assert report["review_action"] == "none"
    assert report["lists"] == []


# ---------------------------------------------------------------- PII masking

def test_mask_pii_long_digit_run_in_report():
    turns = _turns(
        ("callee", "I need a crib and a quiet room, you can text 4155550149."),
        ("agent", "Got it."),
    )
    report = analyze_turns(turns)
    dumped = json.dumps(report)
    assert "4155550149" not in dumped
    assert any("*" in item for item in _item_displays(report))
    assert mask_pii("call 4155550149 now") == "call ********49 now"


def test_mask_pii_short_runs_untouched():
    assert mask_pii("at 7 p.m. room 12") == "at 7 p.m. room 12"


# ---------------------------------------------------------------- CLI / edges

MODULE = SCRIPTS / "list_capture_completeness_auditor.py"


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(MODULE), *args],
        capture_output=True,
        text=True,
    )


def test_cli_missing_file_exit_2(tmp_path: Path):
    proc = _run_cli("analyze", "--call-result", str(tmp_path / "nope.json"))
    assert proc.returncode == 2


def test_cli_invalid_json_exit_2(tmp_path: Path):
    p = tmp_path / "broken.json"
    p.write_text("{not json", encoding="utf-8")
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 2


def test_cli_top_level_string_exit_2(tmp_path: Path):
    p = tmp_path / "string.json"
    p.write_text(json.dumps("just a string"), encoding="utf-8")
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 2


def test_cli_craft_missing_args_exit_2():
    proc = _run_cli("craft")
    assert proc.returncode == 2


def test_cli_craft_valid_number(tmp_path: Path):
    proc = _run_cli(
        "craft",
        "--number", "+14155550149",
        "--business-name", "Harbor Grill",
        "--task", "confirm the reservation requests",
    )
    assert proc.returncode == 0
    goal = json.loads(proc.stdout)["goal_template"]
    assert goal["to"] == "+14155550149"
    assert goal["language"] == "en-US"
    assert "Is that everything?" in goal["protocol"]
    assert "Never add items the caller did not state" in goal["protocol"]
    assert "Harbor Grill" in goal["description"]


def test_cli_craft_rejects_non_reserved():
    proc = _run_cli("craft", "--number", "+19999999999")
    assert proc.returncode == 2


def test_cli_craft_language_passthrough():
    proc = _run_cli("craft", "--number", "+14155550149", "--language", "vi-VN")
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["goal_template"]["language"] == "vi-VN"


def test_cli_empty_transcript_exit_0(tmp_path: Path):
    p = tmp_path / "empty.json"
    p.write_text(json.dumps({"transcript": []}), encoding="utf-8")
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "NO_LIST_EXCHANGED"


def test_cli_analyze_fixture_001_prints_report(tmp_path: Path):
    proc = _run_cli("analyze", "--call-result", str(FIXTURES / "demo-list-001.json"))
    assert proc.returncode == 0
    report = json.loads(proc.stdout)
    assert report["skill"] == "call-list-capture-completeness-auditor"
    assert report["mode"] == "analyze"
    assert report["call_id"] == "demo-list-001"
    assert report["verdict"] == "ALL_ITEMS_CAPTURED"


# ---------------------------------------------------------------- runner


def _run_all() -> int:
    import inspect
    import tempfile

    failures = 0
    globals_map = globals()
    tests = [(k, v) for k, v in globals_map.items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            params = inspect.signature(fn).parameters
            if "tmp_path" in params:
                with tempfile.TemporaryDirectory() as tmp:
                    fn(Path(tmp))
            else:
                fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
