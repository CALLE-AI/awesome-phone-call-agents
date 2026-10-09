#!/usr/bin/env python3
"""Tests for call-motivational-interviewing-fidelity-auditor (pytest + standalone runner)."""

from __future__ import annotations

import atexit
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import motivational_interviewing_fidelity_auditor as mod

HERE = Path(__file__).resolve().parent
REFERENCES = HERE.parent / "references"


def _turn(spk, txt):
    return {"speaker": spk, "text": txt}


def _turns(*pairs):
    return [{"speaker": a, "text": b} for a, b in pairs]


# ---------------------------------------------------------------------------
# Masking
# ---------------------------------------------------------------------------

def test_mask_keeps_short_digit_runs():
    # 555-016 is only 6 digits: kept verbatim, separators included.
    assert mod.mask_pii("Call 555-016 now.") == "Call 555-016 now."


def test_mask_masks_seven_plus_digits():
    masked = mod.mask_pii("Text +14155550165 please.")
    assert "415" not in masked and "#65" in masked
    assert masked == "Text +#########65 please."


def test_mask_nested_wrapped_in_transcript():
    text = "Number is +1 (415) 555-0165 today."
    masked = mod.mask_pii(text)
    assert "0165" not in masked and masked.endswith("65 today.")


# ---------------------------------------------------------------------------
# Parser: wrapped, flat, string transcript, mixed list, errors
# ---------------------------------------------------------------------------

def _run(args):
    return subprocess.run(
        [sys.executable, str(HERE / "motivational_interviewing_fidelity_auditor.py"), *args],
        capture_output=True, text=True,
    )


_TMP: Path | None = None


def _tmp_dir() -> Path:
    # System temp, outside the repo; removed at process exit so the working
    # tree stays clean after a full run.
    global _TMP
    if _TMP is None:
        _TMP = Path(tempfile.mkdtemp(prefix="mifa-tests-"))
        atexit.register(shutil.rmtree, _TMP, ignore_errors=True)
    return _TMP


def _write(name, payload):
    p = _tmp_dir() / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_nested_wrapped_shape():
    p = _write("wrapped.json", {
        "call_id": "wrap-001", "status": "COMPLETED",
        "result": {"transcript": [_turn("agent", "Hi."), _turn("callee", "Hello.")]},
    })
    record = mod.load_call_result(p)
    assert record["call_id"] == "wrap-001" and len(record["turns"]) == 2


def test_load_flat_shape():
    p = _write("flat.json", {
        "call_id": "flat-001",
        "transcript": [_turn("agent", "Hi."), _turn("callee", "Hello.")],
    })
    record = mod.load_call_result(p)
    assert record["call_id"] == "flat-001" and len(record["turns"]) == 2


def test_load_string_transcript_becomes_agent_turn():
    p = _write("string.json", {"call_id": "str-001", "transcript": "One agent blob."})
    record = mod.load_call_result(p)
    assert record["turns"] == [{"speaker": "agent", "text": "One agent blob."}]


def test_load_mixed_list_skips_nondicts():
    p = _write("mixed.json", {
        "call_id": "mix-001",
        "transcript": ["junk", _turn("agent", "Hi."), {"speaker": "callee"}],
    })
    record = mod.load_call_result(p)
    assert [t["text"] for t in record["turns"]] == ["Hi.", ""]


def test_cli_invalid_json_array_exits_2():
    p = _tmp_dir() / "arr.json"
    p.write_text("[]", encoding="utf-8")
    r = _run(["analyze", "--call-result", str(p)])
    assert r.returncode == 2 and "error:" in r.stderr


def test_cli_missing_call_result_exits_2():
    r = _run(["analyze"])
    assert r.returncode == 2


def test_cli_empty_transcript_is_not_mi_call():
    p = _write("empty.json", {"call_id": "empty-001", "transcript": []})
    r = _run(["analyze", "--call-result", str(p)])
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "NOT_MI_CALL"
    assert card["counts"]["sentences"] == 0


def test_card_shape_fields():
    card = mod.analyze(_turns(("agent", "Hello.")), call_id="shape-001")
    assert card["skill"] == "call-motivational-interviewing-fidelity-auditor"
    for key in ("call_id", "verdict", "counts", "ratios", "change_talk_markers",
                "advisories", "disclaimer"):
        assert key in card


# ---------------------------------------------------------------------------
# Classifier behavior: MI_ADHERENT / advice / permission / guards
# ---------------------------------------------------------------------------

MI_DIALOGUE = _turns(
    ("agent", "It sounds like you're torn about the new dose."),
    ("callee", "Yeah, I want to stop skipping it."),
    ("agent", "So you're taking it every morning now?"),
    ("callee", "Most days."),
    ("agent", "What I'm hearing is you'd like to be more consistent."),
    ("callee", "Exactly."),
    ("agent", "How could I help with that?"),
)


def test_mi_adherent_dialogue():
    card = mod.analyze(MI_DIALOGUE, call_id="mi-001")
    assert card["verdict"] == "MI_ADHERENT"
    assert card["counts"]["reflections"] == 3
    assert card["counts"]["open_questions"] >= card["counts"]["closed_questions"]
    assert card["counts"]["advice_without_permission"] == 0


def test_advice_x3_without_permission_is_non_adherent():
    turns = _turns(
        ("agent", "Hello, this is your refill assistant."),
        ("callee", "Oh, okay."),
        ("agent", "You should set a daily alarm so you stop skipping doses."),
        ("callee", "I do forget a lot."),
        ("agent", "You need to take it with food every morning."),
        ("callee", "I want to take it regularly, honestly."),
        ("agent", "You must refill before Friday or the prescription lapses."),
        ("callee", "That's a lot to think about."),
    )
    card = mod.analyze(turns, call_id="mi-adv")
    assert card["verdict"] == "NON_ADHERENT"
    assert card["counts"]["advice_without_permission"] == 3
    assert card["counts"]["advice_with_permission"] == 0


def test_permission_softens_advice():
    turns = _turns(
        ("agent", "It sounds like you're working hard on this."),
        ("callee", "I want to stop skipping it."),
        ("agent", "What have you tried so far?"),
        ("callee", "Alarms, mostly."),
        ("agent", "Would you mind if I shared what other patients try? I recommend a pill organizer."),
    )
    card = mod.analyze(turns, call_id="mi-perm")
    assert card["counts"]["advice_with_permission"] == 1
    assert card["counts"]["advice_without_permission"] == 0
    assert card["verdict"] == "MI_ADHERENT"


def test_permission_is_same_turn_only():
    turns = _turns(
        ("agent", "Would you mind if I shared an idea?"),
        ("callee", "Sure."),
        ("agent", "I recommend a pill organizer. You should try it for a week."),
    )
    card = mod.analyze(turns, call_id="mi-perm2")
    assert card["counts"]["advice_with_permission"] == 0
    assert card["counts"]["advice_without_permission"] >= 1


def test_affirmation_guard_over_advice():
    card = mod.analyze(_turns(("agent", "You should be proud of keeping up your walks.")),
                       call_id="mi-aff")
    assert card["counts"]["affirmations"] == 1
    assert card["counts"]["advice_without_permission"] == 0


def test_open_vs_closed_question_starters():
    labels = {s["text"]: s["label"] for t in (
        "What gets in the way of the morning dose?",
        "Do you keep it by the coffee maker?",
        "How about a phone reminder?",
    ) for s in mod.classify_turn(t)}
    assert labels["What gets in the way of the morning dose?"] == "open_question"
    assert labels["Do you keep it by the coffee maker?"] == "closed_question"
    # Documented trap: wh-initial rule classifies "How about ...?" as open
    # even though it is effectively a closed offer; kept deterministic.
    assert labels["How about a phone reminder?"] == "open_question"


def test_uncontracted_advice_forms():
    text = "You will need to bring your insurance card. I would recommend arriving early."
    labels = [s["label"] for s in mod.classify_turn(text)]
    assert labels.count("advice_without_permission") >= 1
    assert all(lbl == "advice_without_permission" for lbl in labels)


def test_agent_future_need_is_not_advice():
    card = mod.analyze(_turns(("agent", "I'm afraid I'll need the code.")),
                       call_id="mi-fut")
    assert card["counts"]["advice_without_permission"] == 0


# ---------------------------------------------------------------------------
# Craft template
# ---------------------------------------------------------------------------

def test_craft_default_prints_oars_body():
    body = mod.craft_template()
    assert "OARS" in body
    assert "Would you mind if I shared" in body
    assert "ROLL WITH RESISTANCE" in body


def test_cli_craft_default():
    r = _run(["craft"])
    assert r.returncode == 0, r.stderr
    assert "Would you mind if I shared" in r.stdout


def test_cli_craft_language_passthrough_prefix():
    r = _run(["craft", "--language", "vi-VN"])
    assert r.returncode == 0, r.stderr
    assert r.stdout.splitlines()[0] == "[vi-VN] Translate and apply the same MI structure below."
    assert "Would you mind if I shared" in r.stdout


# ---------------------------------------------------------------------------
# Standalone runner (must stay LAST)
# ---------------------------------------------------------------------------

def _run_all() -> int:
    failures = 0
    tests = [(k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
