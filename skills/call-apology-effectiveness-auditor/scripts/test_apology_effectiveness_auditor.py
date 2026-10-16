#!/usr/bin/env python3
"""Tests for the call-apology-effectiveness-auditor skill.

Run:
    python3 -m pytest skills/call-apology-effectiveness-auditor/scripts/test_apology_effectiveness_auditor.py -v
    python3 skills/call-apology-effectiveness-auditor/scripts/test_apology_effectiveness_auditor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
REFS = SKILL_DIR / "references"
EXAMPLE_EFFECTIVE = REFS / "example-transcript.json"
EXAMPLE_ROTE = REFS / "example-transcript-rote.json"
EXAMPLE_NON_APOLOGY = REFS / "example-transcript-non-apology.json"
EXAMPLE_UNADDRESSED = REFS / "example-transcript-unaddressed.json"

sys.path.insert(0, str(SCRIPTS))
from apology_effectiveness_auditor import (  # noqa: E402
    analyze_turns,
    craft_goal,
    load_call_result,
    main,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


# ---------------------------------------------------------------- loading


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert data["turns"][1]["speaker"] == "callee"


def test_load_whitespace_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "  "})
        assert load_call_result(p)["turns"] == []


def test_load_null_and_number_transcript_no_turns():
    for payload in ({"status": "C", "transcript": None}, {"status": "C", "transcript": 3}):
        with tempfile.TemporaryDirectory() as td:
            p = _write_result(Path(td), payload)
            assert load_call_result(p)["turns"] == []


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


def test_load_mixed_list_skips_non_dicts():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "C", "transcript": [{"speaker": "agent", "text": "Hello"}, "junk", None, {"speaker": "callee"}]},
        )
        turns = load_call_result(p)["turns"]
    assert len(turns) == 2
    assert turns[1]["text"] == ""


def test_load_result_wrapped_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "C", "result": {"transcript": _turns(("agent", "Hi"), ("callee", "Hello"))}},
        )
        assert len(load_call_result(p)["turns"]) == 2


# ---------------------------------------------------------------- masking


def test_mask_pii_masks_phone_keep_last_two():
    assert "555" not in mask_pii("number 415-555-0144")


def test_mask_pii_keeps_short_runs():
    assert mask_pii("at 3 p.m. on Friday the 15th") == "at 3 p.m. on Friday the 15th"


# ---------------------------------------------------------------- grievance detection


def test_grievance_positive_families():
    for text in (
        "This is unacceptable.",
        "You left me still waiting for an hour.",
        "This is a waste of my time.",
        "You promised Tuesday and nobody called.",
    ):
        card = analyze_turns(_turns(("agent", "Hello."), ("callee", text), ("agent", "Okay.")))
        assert card["grievances_total"] == 1, text
        assert card["verdict"] in {"GRIEVANCE_UNADDRESSED", "NON_APOLOGY", "PARTIAL_APOLOGY", "EFFECTIVE_APOLOGY"}


def test_grievance_negative_no_grievance():
    card = analyze_turns(_turns(("agent", "Hello."), ("callee", "Everything went fine, thanks."), ("agent", "Great.")))
    assert card["verdict"] == "NO_GRIEVANCE"
    assert card["grievances_total"] == 0
    assert card["grievance_turn_index"] is None


def test_agent_grievance_words_never_count():
    card = analyze_turns(
        _turns(
            ("agent", "I am sorry if this seems unacceptable, but nobody called either."),
            ("callee", "Sounds good to me."),
        )
    )
    assert card["verdict"] == "NO_GRIEVANCE"


def test_no_grievance_recommends_continue():
    card = analyze_turns(_turns(("agent", "Hello."), ("callee", "All good, thank you.")))
    assert card["recommended_action"] == {"action": "continue", "guidance": None}


def test_grievance_case_insensitive():
    card = analyze_turns(_turns(("agent", "Hello."), ("callee", "THIS IS UNACCEPTABLE."), ("agent", "Okay.")))
    assert card["grievances_total"] == 1


def test_grievance_evidence_is_masked_sentence():
    card = analyze_turns(
        _turns(("agent", "Hello."), ("callee", "Call 415-555-0144 back. This is unacceptable."), ("agent", "Okay."))
    )
    assert "555" not in card["grievance_evidence"]
    assert "unacceptable" in card["grievance_evidence"].lower()


# ---------------------------------------------------------------- apology detection


def test_apology_detected_im_sorry():
    card = analyze_turns(_turns(("callee", "This is unacceptable."), ("agent", "I'm sorry about that."), ("callee", "Fine.")))
    assert card["apology_detected"] is True
    assert card["apology_evidence"] is not None


def test_apology_detected_we_apologize():
    card = analyze_turns(_turns(("callee", "This is unacceptable."), ("agent", "We apologize for the delay."), ("callee", "Fine.")))
    assert card["apology_detected"] is True


def test_apology_detected_intensified_truly_sorry():
    card = analyze_turns(
        _turns(
            ("callee", "This is unacceptable."),
            ("agent", "I'm truly sorry. That's on us. I will send a new letter."),
            ("callee", "Fine."),
        )
    )
    assert card["verdict"] == "EFFECTIVE_APOLOGY"
    assert "ACKNOWLEDGMENT" in card["components_present"]
    assert "REPAIR" in card["components_present"]
    assert "REGRET" in card["components_present"]
    assert card["typology"] == "rote"


def test_apology_detected_intensified_so_sorry_partial():
    card = analyze_turns(_turns(("callee", "This is unacceptable."), ("agent", "I'm so sorry.")))
    assert card["apology_detected"] is True
    assert card["verdict"] == "PARTIAL_APOLOGY"


def test_apology_detected_uncontracted_so_sorry():
    card = analyze_turns(_turns(("callee", "This is unacceptable."), ("agent", "I am so sorry."), ("callee", "Fine.")))
    assert card["apology_detected"] is True


def test_apology_detected_uncontracted_truly_sorry():
    card = analyze_turns(_turns(("callee", "This is unacceptable."), ("agent", "I am truly sorry.")))
    assert card["apology_detected"] is True


def test_apology_only_before_grievance_not_counted():
    # The agent apologized before the grievance was raised; the window from
    # g onward has no apology, so the grievance is unaddressed.
    card = analyze_turns(
        _turns(
            ("agent", "I'm sorry about the traffic on this line."),
            ("callee", "This is unacceptable."),
            ("agent", "Let us continue."),
            ("callee", "Fine."),
        )
    )
    assert card["verdict"] == "GRIEVANCE_UNADDRESSED"
    assert card["apology_detected"] is False


# ---------------------------------------------------------------- deflection


def test_deflection_sorry_you_feel():
    card = analyze_turns(
        _turns(("callee", "This is unacceptable."), ("agent", "I'm sorry you feel that way."), ("callee", "Wow."))
    )
    assert card["verdict"] == "NON_APOLOGY"
    assert card["apology_detected"] is True
    assert card["components_present"] == []
    assert card["typology"] is None


def test_deflection_sorry_if_you_were():
    card = analyze_turns(
        _turns(("callee", "This is unacceptable."), ("agent", "I'm sorry if you were inconvenienced."), ("callee", "Wow."))
    )
    assert card["verdict"] == "NON_APOLOGY"


# ---------------------------------------------------------------- components


def _with_component(agent_text: str) -> list[dict[str, str]]:
    return _turns(("callee", "This is unacceptable."), ("agent", agent_text), ("callee", "Fine."))


def test_component_acknowledgment():
    card = analyze_turns(_with_component("I'm sorry about that. We got that wrong."))
    assert "ACKNOWLEDGMENT" in card["components_present"]


def test_component_repair():
    card = analyze_turns(_with_component("I'm sorry about that. Here's what I'll do: I will send a new letter."))
    assert "REPAIR" in card["components_present"]


def test_component_explanation():
    card = analyze_turns(_with_component("I'm sorry about that. The reason was a queue failure."))
    assert "EXPLANATION" in card["components_present"]


def test_component_regret_needs_intensifier():
    card = analyze_turns(_with_component("I'm sorry about that. We are truly sorry it happened."))
    assert "REGRET" in card["components_present"]


def test_component_regret_bare_sorry_does_not_count():
    card = analyze_turns(_with_component("I'm sorry about that."))
    assert "REGRET" not in card["components_present"]


def test_component_forbearance():
    card = analyze_turns(_with_component("I'm sorry about that. It won't happen again."))
    assert "FORBEARANCE" in card["components_present"]


def test_component_forgiveness_request():
    card = analyze_turns(_with_component("I'm sorry about that. Do you accept my apology?"))
    assert "FORGIVENESS_REQUEST" in card["components_present"]


def test_bare_sorry_zero_components_partial_rote():
    card = analyze_turns(_with_component("I'm sorry about that."))
    assert card["verdict"] == "PARTIAL_APOLOGY"
    assert card["components_present"] == []
    assert card["typology"] == "rote"


# ---------------------------------------------------------------- verdicts


def test_effective_ack_plus_repair():
    card = analyze_turns(
        _with_component("I'm sorry about that. That's on us. Here's what I'll do: I will send a new letter.")
    )
    assert card["verdict"] == "EFFECTIVE_APOLOGY"
    assert card["recommended_action"]["action"] == "continue"


def test_effective_ack_plus_explanation():
    card = analyze_turns(_with_component("I'm sorry about that. That's on us. The reason was a queue failure."))
    assert card["verdict"] == "EFFECTIVE_APOLOGY"


def test_partial_repair_but_no_ack():
    card = analyze_turns(_with_component("I'm sorry about that. I can refund the fee today."))
    assert card["verdict"] == "PARTIAL_APOLOGY"
    assert "REPAIR" in card["components_present"]
    assert "ACKNOWLEDGMENT" not in card["components_present"]
    assert card["recommended_action"]["action"] == "reissue_proper_apology"


def test_window_explanation_in_next_agent_turn_counts():
    card = analyze_turns(
        _turns(
            ("callee", "This is unacceptable."),
            ("agent", "I'm sorry about that. That's on us."),
            ("callee", "Well?"),
            ("agent", "The reason was a queue failure on our side."),
        )
    )
    assert card["verdict"] == "EFFECTIVE_APOLOGY"
    assert "EXPLANATION" in card["components_present"]


def test_grievance_unaddressed():
    card = analyze_turns(
        _turns(("callee", "I'm so frustrated, I waited all week."), ("agent", "Let's confirm Friday at 3 p.m."))
    )
    assert card["verdict"] == "GRIEVANCE_UNADDRESSED"
    assert card["recommended_action"]["action"] == "escalate_to_human"
    assert card["typology"] is None


def test_later_grievance_counted_not_graded():
    card = analyze_turns(
        _turns(
            ("callee", "This is unacceptable."),
            ("agent", "I'm sorry about that. That's on us and we'll send a new letter."),
            ("callee", "Also nobody called me yesterday."),
            ("agent", "Understood."),
        )
    )
    assert card["grievances_total"] == 2
    assert card["verdict"] == "EFFECTIVE_APOLOGY"
    assert card["grievance_turn_index"] == 0


# ---------------------------------------------------------------- typology


def test_typology_empathic():
    card = analyze_turns(
        _with_component("I'm sorry about that. That's on us. I understand how frustrating this is.")
    )
    assert card["typology"] == "empathic"


def test_typology_explanatory():
    card = analyze_turns(_with_component("I'm sorry about that. The reason was a queue failure."))
    assert card["typology"] == "explanatory"


def test_typology_rote_when_no_feeling_or_explanation():
    card = analyze_turns(
        _with_component("I'm sorry about that. That's on us. Here's what I'll do: I will send a new letter.")
    )
    assert card["typology"] == "rote"
    assert card["verdict"] == "EFFECTIVE_APOLOGY"


def test_typology_empathic_beats_explanatory():
    card = analyze_turns(
        _with_component(
            "I'm sorry about that. That's on us. I understand why you are upset, because the letter never arrived."
        )
    )
    assert card["typology"] == "empathic"


# ---------------------------------------------------------------- unclear paths


def test_empty_transcript_unclear():
    card = analyze_turns([])
    assert card["apology_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"
    assert card["verdict"] is None


def test_single_turn_unclear():
    card = analyze_turns(_turns(("callee", "This is unacceptable.")))
    assert card["apology_assessment"] == "unclear"
    assert card["reason"] == "insufficient_signal"


def test_disclaimer_present():
    card = analyze_turns(_turns(("agent", "Hi."), ("callee", "Hello.")))
    assert "not a relationship-quality certificate" in card["disclaimer"]
    assert card["analysis_mode"] == "heuristic"


# ---------------------------------------------------------------- craft


def test_craft_goal_wording():
    plan = craft_goal("apology-protocol")
    assert plan["mode"] == "craft"
    assert "That's on us" in plan["goal"]
    assert "I'm sorry you feel that way" in plan["goal"]
    assert len(plan["notes"]) == 2
    assert plan["language"] == "en"


def test_craft_goal_language_passthrough():
    assert craft_goal("apology-protocol", language="en-GB")["language"] == "en-GB"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("wrong")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "wrong" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_missing_transcript_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze", "--transcript", "nope.json"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_analyze_fixture_effective():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze", "--transcript", str(EXAMPLE_EFFECTIVE)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "EFFECTIVE_APOLOGY"
    assert card["typology"] == "empathic"
    assert card["recommended_action"]["action"] == "continue"
    assert card["call_id"] == "run-apo-empathic-01"


def test_cli_analyze_fixture_rote():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze", "--transcript", str(EXAMPLE_ROTE)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["verdict"] == "PARTIAL_APOLOGY"
    assert card["typology"] == "rote"


def test_cli_analyze_fixture_non_apology():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze", "--transcript", str(EXAMPLE_NON_APOLOGY)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["verdict"] == "NON_APOLOGY"
    assert card["apology_detected"] is True


def test_cli_analyze_fixture_unaddressed():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze", "--transcript", str(EXAMPLE_UNADDRESSED)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["verdict"] == "GRIEVANCE_UNADDRESSED"
    assert card["apology_detected"] is False


def test_cli_analyze_out_writes_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "card.json"
        proc = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "apology_effectiveness_auditor.py"),
                "analyze",
                "--transcript",
                str(EXAMPLE_ROTE),
                "--out",
                str(out),
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        assert json.loads(out.read_text(encoding="utf-8"))["verdict"] == "PARTIAL_APOLOGY"


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "craft", "--scenario", "apology-protocol"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "goal" in json.loads(proc.stdout)


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "craft", "--scenario", "bogus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_main_returns_int():
    assert main(["craft", "--scenario", "apology-protocol"]) == 0


def test_cli_invalid_json_exit_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "broken.json"
        p.write_text("{not valid json", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2
    assert "ERROR" in proc.stderr


def test_cli_json_array_exit_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "array.json"
        p.write_text('[{"speaker":"agent","text":"Hi"}]', encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2
    assert "ERROR" in proc.stderr


def test_cli_missing_required_arg_exit_2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "apology_effectiveness_auditor.py"), "analyze"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


# ---------------------------------------------------------------- runner


def _run_all() -> int:
    failures = 0
    globals_map = globals()
    tests = [(k, v) for k, v in globals_map.items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
