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
# Edges, guards, abstention, fixtures
# ---------------------------------------------------------------------------

def test_confront_and_warn_is_non_adherent():
    turns = _turns(
        ("agent", "You're just making excuses about the refill. If you don't refill it, you'll run out."),
        ("callee", "I want to stop skipping it."),
    )
    card = mod.analyze(turns, call_id="mi-cw")
    assert card["counts"]["confront"] == 1
    assert card["counts"]["warn"] == 1
    assert card["verdict"] == "NON_ADHERENT"


def test_plain_reservation_is_not_mi_call():
    turns = _turns(
        ("agent", "Hi, this is the dental office confirming your appointment on Thursday."),
        ("callee", "Yes, that's correct."),
        ("agent", "We'll text a reminder to +14155550165."),
        ("callee", "Great, see you then."),
    )
    assert mod.analyze(turns, call_id="mi-res")["verdict"] == "NOT_MI_CALL"


def test_not_mi_overrides_advice_without_change_talk():
    turns = _turns(
        ("agent", "You should arrive ten minutes early to complete paperwork."),
        ("callee", "Okay, I'll do that."),
    )
    card = mod.analyze(turns, call_id="mi-ovr")
    assert card["counts"]["advice_without_permission"] == 1
    assert card["verdict"] == "NOT_MI_CALL"


def test_catch_all_partial_adherence():
    turns = _turns(
        ("agent", "Would you like to cut down on skipping?"),
        ("callee", "I want to stop skipping it."),
        ("agent", "Would a reminder call help?"),
        ("callee", "Maybe."),
        ("agent", "Okay, we'll set that up."),
    )
    card = mod.analyze(turns, call_id="mi-part")
    assert card["counts"]["reflections"] == 0
    assert card["counts"]["open_questions"] < card["counts"]["closed_questions"]
    assert card["verdict"] == "PARTIALLY_ADHERENT"


def test_low_sample_advisory_under_six_agent_turns():
    turns = _turns(
        ("agent", "How is the medication going?"),
        ("callee", "I want to stop skipping it."),
        ("agent", "It sounds like you want to be more consistent."),
    )
    card = mod.analyze(turns, call_id="mi-low")
    assert "low_sample" in card["advisories"]


def test_no_low_sample_advisory_at_six_agent_turns():
    turns = MI_DIALOGUE + _turns(
        ("callee", "Thanks."),
        ("agent", "Thanks for your time."),
        ("agent", "Take care."),
    )
    assert "low_sample" not in mod.analyze(turns, call_id="mi-full")["advisories"]


def test_am_split_safety():
    # "a.m." must not terminate a sentence, but a later plain boundary still
    # splits, so the open question is detected rather than glued forever.
    glued = mod.classify_turn("Let's lock in 9 a.m. What makes mornings hard for you?")
    assert len(glued) == 1 and glued[0]["label"] == "closed_question"
    split = mod.classify_turn("Let's lock in 9 a.m. Just one more thing. What makes mornings hard?")
    labels = [s["label"] for s in split]
    assert "open_question" in labels


def test_masked_phone_never_affects_classification():
    card = mod.analyze(_turns(
        ("agent", "I'll text the refill reminder to +14155550165. What works best for you?"),
        ("callee", "I want to stop skipping it."),
    ), call_id="mi-mask")
    assert card["counts"]["open_questions"] == 1
    assert card["counts"]["advice_without_permission"] == 0


def _analyze_fixture(name):
    return _run(["analyze", "--call-result", str(REFERENCES / name)])


def test_fixture_mi_adherent_end_to_end():
    r = _analyze_fixture("example-call-result.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "MI_ADHERENT" and card["call_id"] == "demo-mi-001"
    assert card["counts"]["advice_without_permission"] == 0
    assert card["counts"]["open_questions"] >= card["counts"]["closed_questions"]


def test_fixture_non_adherent_end_to_end():
    r = _analyze_fixture("example-call-result-nonadherent.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "NON_ADHERENT" and card["call_id"] == "demo-mi-002"
    assert card["counts"]["advice_without_permission"] >= 3
    assert card["change_talk_markers"] >= 1


def test_fixture_not_mi_end_to_end():
    r = _analyze_fixture("example-call-result-not-mi.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "NOT_MI_CALL" and card["call_id"] == "demo-mi-003"
    assert card["change_talk_markers"] == 0


def test_goal_fixture_matches_craft_output():
    goal = (REFERENCES / "example-goal.txt").read_text(encoding="utf-8")
    assert goal == mod.craft_template()


# ---------------------------------------------------------------------------
# Adversarial review: reflection / advice / confront / warn / permission /
# change-talk lexicon coverage
# ---------------------------------------------------------------------------

def _counts_for(agent_text):
    return mod.analyze(
        _turns(("agent", agent_text), ("callee", "I want to stop skipping it.")),
        call_id="mi-advrev",
    )["counts"]


def test_reflection_bare_and_past_sound_stems():
    assert _counts_for("Sounds like you're ready.")["reflections"] == 1
    assert _counts_for("It sounded like you were unsure.")["reflections"] == 1


def test_reflection_that_sounds_like_a_plan_stays_out():
    # "That ..." must not match the optional-it sound/seem stem (^-anchored).
    assert _counts_for("That sounds like a plan.")["reflections"] == 0


def test_reflection_what_i_hear_is_and_im_hearing_that():
    assert _counts_for("What I hear is you're torn.")["reflections"] == 1
    assert _counts_for("I'm hearing that you're stuck.")["reflections"] == 1


def test_reflection_uncontracted_you_are_forms():
    assert _counts_for("So, you are feeling stuck.")["reflections"] == 1
    assert _counts_for("You are saying that it's hard.")["reflections"] == 1


def test_advice_contracted_and_uncontracted_recommend_suggest():
    assert _counts_for("I'd recommend a pill box.")["advice_without_permission"] == 1
    assert _counts_for("I would suggest alarms.")["advice_without_permission"] == 1


def test_advice_you_oughta():
    assert _counts_for("You oughta refill today.")["advice_without_permission"] == 1


def test_advice_it_would_be_best_to():
    assert _counts_for("It would be best to set an alarm.")["advice_without_permission"] == 1


def test_advice_make_sure_imperative():
    assert _counts_for("Make sure to take it with food.")["advice_without_permission"] == 1


def test_confront_keep_avoiding_and_plain_excuse():
    card = mod.analyze(
        _turns(("agent", "You keep avoiding this. That's an excuse."),
               ("callee", "I want to stop skipping it.")),
        call_id="mi-conf2",
    )
    assert card["counts"]["confront"] == 2
    assert card["verdict"] == "NON_ADHERENT"


def test_warn_if_you_keep():
    counts = _counts_for("If you keep skipping, you will run out.")
    # Conditional warning wins over the confront "you keep ..." stem here.
    assert counts["warn"] == 1 and counts["confront"] == 0


def test_warn_without_clause():
    assert _counts_for("Without a refill you'll run out.")["warn"] == 1


def test_warn_without_control_without_loss_verb():
    # "pay" is not a loss verb, so no warn even with the without-clause shape.
    assert _counts_for("Without the discount you'd pay more.")["warn"] == 0


def test_permission_is_it_okay_if_i():
    counts = _counts_for("Is it okay if I share a tip? I recommend alarms.")
    assert counts["advice_with_permission"] == 1
    assert counts["advice_without_permission"] == 0


def test_permission_let_me_offer_a_suggestion():
    counts = _counts_for("Let me offer a suggestion. I recommend alarms.")
    assert counts["advice_with_permission"] == 1
    assert counts["advice_without_permission"] == 0


def test_permission_might_i_suggest():
    counts = _counts_for("Might I suggest alarms?")
    assert counts["advice_with_permission"] == 1
    assert counts["advice_without_permission"] == 0


def test_change_talk_extended_stems_flip_gate():
    base = _turns(("agent", "It sounds like you're torn."))
    for phrase in (
        "I've been trying to take it more often.",
        "I'm trying my best with the mornings.",
        "Maybe I should quit skipping.",
        "I kinda want to refill on time.",
    ):
        card = mod.analyze(base + _turns(("callee", phrase)), call_id="mi-ct")
        assert card["verdict"] != "NOT_MI_CALL", phrase


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
