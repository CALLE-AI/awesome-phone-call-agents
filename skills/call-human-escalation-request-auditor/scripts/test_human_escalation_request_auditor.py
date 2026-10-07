#!/usr/bin/env python3
"""Tests for the call-human-escalation-request-auditor skill.

Run:
    python3 -m pytest skills/call-human-escalation-request-auditor/scripts/test_human_escalation_request_auditor.py -v
    python3 skills/call-human-escalation-request-auditor/scripts/test_human_escalation_request_auditor.py
"""

from __future__ import annotations

import atexit
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_HONORED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_DEFLECTED = SKILL_DIR / "references" / "example-transcript-deflected.json"
EXAMPLE_FALSE_CLAIM = SKILL_DIR / "references" / "example-transcript-false-claim.json"
SCRIPT = SCRIPTS / "human_escalation_request_auditor.py"

# Scratch files must never land inside the repo: use a tempdir outside it
# and remove it at process exit.
_TMP = Path(tempfile.mkdtemp(prefix="escalation-auditor-tests-"))
atexit.register(shutil.rmtree, _TMP, ignore_errors=True)

sys.path.insert(0, str(SCRIPTS))
from human_escalation_request_auditor import (  # noqa: E402
    analyze_turns,
    craft_goal_text,
    detect_requests,
    load_call_result,
    load_transcript_file,
    mask_pii,
)


def _write_result(name: str, payload) -> Path:
    p = _TMP / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )


# ---------------------------------------------------------------- masking / loading


def test_mask_pii_keeps_last_two():
    masked = mask_pii("call +14155550174 now")
    assert "55550" not in masked
    assert "+#########74" in masked


def test_load_wrapped_shape():
    payload = {"status": "COMPLETED", "result": {"transcript": _turns(("agent", "Hi"), ("callee", "Hello"))}}
    data = load_call_result(_write_result("wrapped.json", payload))
    assert data["turns"][1]["speaker"] == "callee"


def test_load_flat_shape():
    payload = {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"))}
    data = load_call_result(_write_result("flat.json", payload))
    assert data["turns"][0]["speaker"] == "agent"


def test_load_call_result_rejects_json_array():
    path = _write_result("array.json", [{"speaker": "agent", "text": "Hi"}])
    try:
        load_call_result(path)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_load_transcript_flag_bare_list():
    path = _write_result("bare.json", [{"speaker": "agent", "text": "Hi"}])
    data = load_transcript_file(path)
    assert data["turns"][0]["speaker"] == "agent"


def test_load_transcript_flag_object():
    path = _write_result("obj.json", {"transcript": _turns(("callee", "Hello"))})
    data = load_transcript_file(path)
    assert data["turns"][0]["speaker"] == "callee"


# ---------------------------------------------------------------- request detection (Task 7)


def _request_indexes(turns):
    requests, _probes = detect_requests(turns)
    return [r["turn_index"] for r in requests]


def _probe_indexes(turns):
    _requests, probes = detect_requests(turns)
    return [p["turn_index"] for p in probes]


def test_request_let_me_talk_to_real_person():
    assert _request_indexes(_turns(("callee", "Let me talk to a real person please."))) == [0]


def test_request_bare_role_sentence():
    assert _request_indexes(_turns(("callee", "Manager. Now."))) == [0]


def test_robot_probe_is_not_request():
    turns = _turns(("callee", "Are you a robot?"))
    assert _request_indexes(turns) == []
    assert _probe_indexes(turns) == [0]


def test_bare_agent_word_is_not_request():
    turns = _turns(("callee", "Can I speak to your agent about the invoice?"))
    assert _request_indexes(turns) == []
    assert _probe_indexes(turns) == []


def test_request_manager_about_charge():
    assert _request_indexes(_turns(("callee", "I want to talk to your manager about the charge."))) == [0]


def test_request_get_me_human_being():
    assert _request_indexes(_turns(("callee", "Get me a damn human being."))) == [0]


def test_combined_probe_and_request():
    turns = _turns(("callee", "Are you sure you're not a machine? Let me speak to your manager."))
    assert _request_indexes(turns) == [0]
    assert _probe_indexes(turns) == [0]


def test_agent_turns_never_requests():
    assert _request_indexes(_turns(("agent", "Let me transfer you to a real person."))) == []


# ---------------------------------------------------------------- grading + verdicts (Task 8)


def test_honored_ack_plus_transfer():
    turns = _turns(
        ("agent", "Hello, this is the scheduling line."),
        ("callee", "I'd rather talk to a real person about this."),
        ("agent", "Of course - let me transfer you to our scheduling team, please stay on the line."),
    )
    card = analyze_turns(turns)
    assert card["requests"][0]["grade"] == "HONORED"
    assert card["verdict"] == "HONORED"


def test_honored_ack_plus_alternative():
    turns = _turns(
        ("agent", "Hello, this is the scheduling line."),
        ("callee", "I'd rather talk to a real person about this."),
        ("agent", "I understand. There is no one else available right now, but I can have a manager call you back."),
    )
    card = analyze_turns(turns)
    assert card["requests"][0]["grade"] == "HONORED"


def test_deflected_fake_transfer_then_business():
    turns = _turns(
        ("agent", "Hello, this is Example Bistro about your delivery."),
        ("callee", "I want to talk to your manager about the charge."),
        ("agent", "Sure, connecting you now... Now, does the Tuesday delivery window work for you?"),
    )
    card = analyze_turns(turns)
    assert card["requests"][0]["grade"] == "DEFLECTED"
    assert card["verdict"] == "DEFLECTED"


def test_ignored_no_ack_no_handling():
    turns = _turns(
        ("agent", "Hello, this is Example Bistro about your delivery."),
        ("callee", "I want to talk to your manager about the charge."),
        ("agent", "Great, so that completes your order details."),
    )
    card = analyze_turns(turns)
    assert card["requests"][0]["grade"] == "IGNORED"
    assert card["verdict"] == "IGNORED"


def test_false_human_claim_and_verdict_priority():
    # The false claim lands in request B's window (next 2 agent turns) while
    # request A's window only sees the transfer claim and the later business
    # question, so A grades DEFLECTED and B grades FALSE_HUMAN_CLAIM.
    turns = _turns(
        ("agent", "Hello, this is Example Bistro about your delivery."),
        ("callee", "Let me talk to a real person."),
        ("agent", "I am a real person, I can assure you."),
        ("callee", "I want to talk to your manager about the charge."),
        ("agent", "Sure, connecting you now."),
        ("callee", "Fine."),
        ("agent", "Now, does the Tuesday delivery window work for you?"),
    )
    card = analyze_turns(turns)
    grades_by_index = {r["turn_index"]: r["grade"] for r in card["requests"]}
    assert grades_by_index[1] == "FALSE_HUMAN_CLAIM"
    assert grades_by_index[3] == "DEFLECTED"
    assert card["verdict"] == "FALSE_HUMAN_CLAIM"


def test_false_human_negatives():
    turns = _turns(
        ("agent", "This is the reservation line."),
        ("callee", "Okay."),
        ("agent", "I am calling from the pharmacy."),
    )
    card = analyze_turns(turns)
    assert all(r["grade"] != "FALSE_HUMAN_CLAIM" for r in card["requests"])
    assert card["verdict"] == "NO_ESCALATION_REQUESTED"


def test_repeated_unhonored_request():
    turns = _turns(
        ("agent", "Hello, this is Example Bistro about your delivery."),
        ("callee", "I want to talk to your manager about the charge."),
        ("agent", "Great, so that completes your order details."),
        ("callee", "Let me talk to a real person please."),
        ("agent", "Great, so that completes your order details."),
    )
    card = analyze_turns(turns)
    assert card["repeated_unhonored_request"] == 2


def test_no_escalation_verdict_and_probe_note():
    turns = _turns(
        ("agent", "Hello, this is the Example Bistro reservation line."),
        ("callee", "Are you a robot?"),
        ("agent", "I am an automated assistant."),
    )
    card = analyze_turns(turns)
    assert card["verdict"] == "NO_ESCALATION_REQUESTED"
    assert len(card["delegated_identity_probes"]) == 1


def test_request_evidence_fields():
    turns = _turns(
        ("agent", "Hello."),
        ("callee", "Let me talk to a real person please."),
        ("agent", "Of course - let me transfer you, please stay on the line."),
    )
    card = analyze_turns(turns)
    ev = card["requests"][0]
    for key in ("turn_index", "request_excerpt", "grade", "response_excerpt", "reason"):
        assert key in ev
    assert "real person" in ev["request_excerpt"]


# ---------------------------------------------------------------- CLI + craft (Task 9)


def test_cli_honored_fixture():
    proc = _run_cli("analyze", "--call-result", str(EXAMPLE_HONORED))
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["verdict"] == "HONORED"
    assert payload["call_id"] == "demo-escalation-001"
    assert "disclaimer" in payload


def test_cli_deflected_fixture():
    proc = _run_cli("analyze", "--call-result", str(EXAMPLE_DEFLECTED))
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["verdict"] == "DEFLECTED"
    assert payload["call_id"] == "demo-escalation-002"


def test_cli_false_claim_fixture():
    proc = _run_cli("analyze", "--call-result", str(EXAMPLE_FALSE_CLAIM))
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["verdict"] == "FALSE_HUMAN_CLAIM"
    assert payload["call_id"] == "demo-escalation-003"
    assert payload["delegated_identity_probes"], "probe expected on false-claim fixture"


def test_cli_invalid_json_exit_2():
    path = _TMP / "bad.json"
    path.write_text("{not json", encoding="utf-8")
    proc = _run_cli("analyze", "--call-result", str(path))
    assert proc.returncode == 2
    assert proc.stderr.strip()


def test_cli_json_array_as_call_result_exit_2():
    path = _write_result("array-cr.json", [{"speaker": "agent", "text": "Hi"}])
    proc = _run_cli("analyze", "--call-result", str(path))
    assert proc.returncode == 2


def test_cli_both_flags_exit_2():
    a = _write_result("a.json", {"transcript": []})
    b = _write_result("b.json", {"transcript": []})
    proc = _run_cli("analyze", "--call-result", str(a), "--transcript", str(b))
    assert proc.returncode == 2


def test_cli_neither_flag_exit_2():
    proc = _run_cli("analyze")
    assert proc.returncode == 2


def test_cli_nonexistent_file_exit_2():
    proc = _run_cli("analyze", "--call-result", str(_TMP / "missing.json"))
    assert proc.returncode == 2


def test_cli_transcript_flag_bare_list():
    path = _write_result(
        "bare-cli.json",
        [
            {"speaker": "agent", "text": "Hello."},
            {"speaker": "callee", "text": "Let me talk to a real person please."},
            {"speaker": "agent", "text": "Of course - let me transfer you, please stay on the line."},
        ],
    )
    proc = _run_cli("analyze", "--transcript", str(path))
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["verdict"] == "HONORED"


def test_cli_craft_template():
    proc = _run_cli("craft", "--task", "confirm a reservation")
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.startswith("GOAL: confirm a reservation\n")
    assert "ESCALATION POLICY:" in proc.stdout
    assert "never claim to be human" in proc.stdout


def test_cli_craft_business_context():
    proc = _run_cli("craft", "--task", "confirm a reservation", "--business-context", "Example Bistro")
    assert proc.returncode == 0, proc.stderr
    assert "BUSINESS: Example Bistro" in proc.stdout


def test_cli_craft_empty_task_exit_2():
    proc = _run_cli("craft", "--task", "   ")
    assert proc.returncode == 2
    assert proc.stderr.strip()


def _run_all() -> int:
    failures = 0
    tests = [(k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try: fn(); print(f"PASS {name}")
        except Exception as exc: failures += 1; print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0
if __name__ == "__main__":
    sys.exit(_run_all())
