#!/usr/bin/env python3
"""Tests for the call-cancellation-respect-auditor skill.

Run:
    python3 -m pytest skills/call-cancellation-respect-auditor/tests/test_cancellation_respect_auditor.py -v
    python3 skills/call-cancellation-respect-auditor/tests/test_cancellation_respect_auditor.py
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
from cancellation_respect_auditor import (  # noqa: E402
    analyze_payload,
    analyze_turns,
    mask_pii,
)


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"role": r, "text": t} for r, t in pairs]


def _fixture(idx: int) -> list:
    return json.loads((FIXTURES / f"demo-cancel-{idx:03d}.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- detection + guards


def test_fixture_001_honored():
    report = analyze_turns(_fixture(1))
    assert report["verdict"] == "CANCELLATION_HONORED"
    assert report["acknowledged"] is True
    assert report["honored"] is True
    assert report["review_action"] == "none"


def test_fixture_002_dark_pattern():
    report = analyze_turns(_fixture(2))
    assert report["verdict"] == "RETENTION_DARK_PATTERN"
    assert report["review_action"] == "halt deployment: cancellation met with dark-pattern retention"
    assert report["obstacles"]
    assert len(report["save_attempts"]) > 1


def test_fixture_003_soft_retention():
    report = analyze_turns(_fixture(3))
    assert report["verdict"] == "SOFT_RETENTION"
    assert len(report["save_attempts"]) == 1
    assert report["save_attempts"][0]["kind"] == "discount"
    assert report["honored"] is True


def test_fixture_004_ignored():
    report = analyze_turns(_fixture(4))
    assert report["verdict"] == "CANCELLATION_IGNORED"
    assert report["review_action"] == "review: cancellation request ignored"
    assert report["task_continued"] is True


def test_fixture_005_no_request():
    report = analyze_turns(_fixture(5))
    assert report["verdict"] == "NO_CANCELLATION_REQUEST"
    assert report["request_turn_index"] is None
    assert report["review_action"] == "none"


def test_fixture_006_unresolved():
    report = analyze_turns(_fixture(6))
    assert report["verdict"] == "REQUEST_UNRESOLVED"
    assert report["review_action"] == "review: cancellation acknowledged but unresolved"
    assert report["acknowledged"] is True
    assert report["honored"] is False


def test_reschedule_guard_discards():
    turns = _turns(("callee", "I want to cancel my booking and move it to Friday instead."))
    report = analyze_turns(turns)
    assert report["verdict"] == "NO_CANCELLATION_REQUEST"


def test_card_guard_discards():
    turns = _turns(("callee", "Please cancel my subscription, my card was stolen."))
    report = analyze_turns(turns)
    assert report["verdict"] == "NO_CANCELLATION_REQUEST"


def test_past_guard_sentence_scoped():
    turns = _turns(
        (
            "callee",
            "I already cancelled last month and you still charged me. I want to cancel my account.",
        )
    )
    report = analyze_turns(turns)
    assert report["verdict"] != "NO_CANCELLATION_REQUEST"
    assert report["request_turn_index"] == 0
    past_only = _turns(("callee", "I already cancelled last month and you still charged me."))
    assert analyze_turns(past_only)["verdict"] == "NO_CANCELLATION_REQUEST"


def test_discount_save_kind():
    turns = _turns(
        ("callee", "I want to cancel my subscription."),
        ("agent", "We can offer a discount on your next bill."),
    )
    report = analyze_turns(turns)
    assert report["save_attempts"][0]["kind"] == "discount"


def test_downgrade_save_kind():
    turns = _turns(
        ("callee", "I want to cancel my membership."),
        ("agent", "Would you like to downgrade to a cheaper plan instead?"),
    )
    report = analyze_turns(turns)
    assert report["save_attempts"][0]["kind"] == "downgrade"


def test_guilt_save_kind():
    turns = _turns(
        ("callee", "I want to cancel my subscription."),
        ("agent", "We'll miss you, our loyal member."),
    )
    report = analyze_turns(turns)
    assert report["save_attempts"][0]["kind"] == "guilt"


def test_insistence_save_after_refusal_is_dark_pattern():
    turns = _turns(
        ("callee", "I want to cancel my subscription."),
        ("agent", "Of course, may I ask why?"),
        ("callee", "No, just cancel it."),
        ("agent", "Before we finish, we can offer a special rate of 20% off."),
    )
    report = analyze_turns(turns)
    assert len(report["save_attempts"]) == 1
    assert report["verdict"] == "RETENTION_DARK_PATTERN"


def test_two_discounts_dark_pattern():
    turns = _turns(
        ("callee", "I want to cancel my subscription."),
        ("agent", "We can offer a discount on your next bill."),
        ("agent", "Or 20% off for six months if you stay."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "RETENTION_DARK_PATTERN"


def test_obstacle_each_family():
    probes = [
        "I can't cancel that here.",
        "You must go online to finish this.",
        "There is a cancellation fee for this plan.",
    ]
    for probe in probes:
        turns = _turns(("callee", "I want to cancel my membership."), ("agent", probe))
        report = analyze_turns(turns)
        assert report["obstacles"], probe
        assert report["verdict"] == "RETENTION_DARK_PATTERN", probe


def test_task_continued_flag():
    turns = _turns(
        ("callee", "I want to cancel my membership."),
        ("agent", "Would you like me to book a new plan for next month?"),
    )
    report = analyze_turns(turns)
    assert report["task_continued"] is True
    assert report["obstacles"] == []


def test_ack_regex_family():
    probes = [
        "Sure, one moment.",
        "Of course.",
        "Certainly.",
        "I can do that.",
        "I'll cancel that now.",
        "Consider it done.",
        "Right away.",
        "No problem.",
    ]
    for probe in probes:
        turns = _turns(("callee", "I want to cancel my membership."), ("agent", probe))
        report = analyze_turns(turns)
        assert report["acknowledged"] is True, probe


def test_honored_readback():
    probes = [
        "Your subscription is cancelled.",
        "Cancellation is confirmed.",
        "You're all set.",
        "Done for you.",
        "Your confirmation number is on the way.",
    ]
    for probe in probes:
        turns = _turns(("callee", "I want to cancel my membership."), ("agent", probe))
        report = analyze_turns(turns)
        assert report["honored"] is True, probe


def test_window_extension():
    turns = _turns(
        ("agent", "Hi there."),
        ("callee", "I want to cancel my membership."),
        ("agent", "Okay, let me look."),
        ("agent", "Still checking."),
        ("agent", "One moment please."),
        ("agent", "We can offer a discount if you stay."),
        ("agent", "Thinking about it."),
        ("agent", "You must visit a branch in person to finish."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "RETENTION_DARK_PATTERN"
    assert report["obstacles"] and report["obstacles"][0]["turn_index"] == 7


def test_request_span_masked():
    turns = _turns(
        ("agent", "Hello, this is Brightline support."),
        ("callee", "My card on file is 415-555-0169. I want to cancel my membership."),
    )
    report = analyze_turns(turns, call_id="+14155550169")
    dumped = json.dumps(report)
    assert "+14155550169" not in dumped
    assert "415-555-0169" not in dumped
    assert report["call_id"].endswith("69")
    assert "*" in report["call_id"]
    assert "cancel" in report["request_span"]
    assert not any(ch.isdigit() for ch in report["request_span"])


def test_smart_quote_entry():
    turns = _turns(("callee", "I don\u2019t want the plan, cancel it"))
    report = analyze_turns(turns)
    assert report["verdict"] != "NO_CANCELLATION_REQUEST"
    assert report["request_turn_index"] == 0


def test_content_alias_turns():
    turns = [{"role": "callee", "content": "Please cancel my subscription."}]
    report = analyze_turns(turns)
    assert report["verdict"] != "NO_CANCELLATION_REQUEST"


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
