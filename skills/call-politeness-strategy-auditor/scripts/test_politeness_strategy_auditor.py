#!/usr/bin/env python3
"""Tests for politeness_strategy_auditor.

Run: python -m pytest scripts/test_politeness_strategy_auditor.py -v
     python scripts/test_politeness_strategy_auditor.py
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from politeness_strategy_auditor import (
    analyze,
    craft_template,
    load_call_result,
    mask_pii,
    main,
)

FIX = Path(__file__).parent.parent / "references"


def _turns(*pairs):
    return [{"speaker": s, "text": t} for s, t in pairs]


def _run_cli(args):
    return subprocess.run(
        [sys.executable, str(Path(__file__).parent / "politeness_strategy_auditor.py"), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Family trio: masking, shapes, CLI edges
# ---------------------------------------------------------------------------

def test_mask_pii_keeps_short_runs():
    assert mask_pii("party of 4 at 2 p.m.") == "party of 4 at 2 p.m."


def test_mask_pii_masks_7plus_digit_runs():
    masked = mask_pii("call +14155550179 now")
    assert "#########79" in masked and "0175" not in masked


def test_load_nested_wrapped_shape(tmp_path):
    p = tmp_path / "wrapped.json"
    p.write_text(
        json.dumps(
            {
                "call_id": "demo-polite-001",
                "status": "COMPLETED",
                "result": {
                    "post_summary": "ok",
                    "transcript": [
                        {"speaker": "agent", "text": "Hi."},
                        {"speaker": "callee", "text": "Hello."},
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    rec = load_call_result(p)
    assert rec["post_summary"] == "ok" and len(rec["turns"]) == 2


def test_load_flat_shape(tmp_path):
    p = tmp_path / "flat.json"
    p.write_text(
        json.dumps(
            {
                "call_id": "x",
                "status": "COMPLETED",
                "post_summary": "s",
                "transcript": [{"speaker": "agent", "text": "Hi."}],
            }
        ),
        encoding="utf-8",
    )
    assert load_call_result(p)["turns"][0]["text"] == "Hi."


def test_load_string_transcript(tmp_path):
    p = tmp_path / "str.json"
    p.write_text(
        json.dumps(
            {"result": {"post_summary": "x", "transcript": "Could you confirm the date, please?"}}
        ),
        encoding="utf-8",
    )
    rec = load_call_result(p)
    assert len(rec["turns"]) == 1 and rec["turns"][0]["speaker"] == "agent"


def test_cli_invalid_json_array_exits_2(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("[1,2]", encoding="utf-8")
    r = _run_cli(["analyze", "--call-result", str(bad)])
    assert r.returncode == 2 and "error" in r.stderr


def test_cli_missing_arg_exits_2():
    import pytest

    with pytest.raises(SystemExit) as ei:
        main(["analyze"])
    assert ei.value.code == 2


def test_cli_mixed_list_skips_nondicts(tmp_path):
    p = tmp_path / "mix.json"
    p.write_text(
        json.dumps(
            {
                "result": {
                    "post_summary": "x",
                    "transcript": [
                        {"speaker": "agent", "text": "Hi."},
                        "junk",
                        {"text": "no speaker"},
                        {"speaker": "callee"},
                    ],
                }
            }
        ),
        encoding="utf-8",
    )
    r = _run_cli(["analyze", "--call-result", str(p)])
    assert r.returncode == 0


def test_empty_transcript_no_requests():
    card = analyze([], "")
    assert card["verdict"] == "NO_AGENT_REQUESTS"


# ---------------------------------------------------------------------------
# Grading behavior
# ---------------------------------------------------------------------------

def test_single_bald_imperative_is_mixed():
    turns = _turns(("agent", "Give me your date of birth."), ("callee", "Why?"))
    card = analyze(turns, "")
    assert card["verdict"] == "MIXED"
    assert card["requests"][0]["grade"] == "BALD"
    assert card["requests"][0]["form"] == "imperative"


def test_three_balds_detected():
    turns = _turns(
        ("agent", "Give me your date of birth. Spell your last name. Repeat the code."),
        ("callee", "Okay okay."),
    )
    card = analyze(turns, "")
    assert card["verdict"] == "BALD_REQUESTS_DETECTED"
    assert card["counts"]["bald"] == 3


def test_percentage_rule_two_of_three_detected():
    turns = _turns(
        ("agent", "Give me your date of birth. Spell your last name."),
        ("callee", "Anything else?"),
        ("agent", "Could you confirm the email, please?"),
    )
    card = analyze(turns, "")
    assert card["counts"]["bald"] == 2 and card["counts"]["requests"] == 3
    assert card["verdict"] == "BALD_REQUESTS_DETECTED"


def test_percentage_rule_one_of_three_mixed():
    turns = _turns(
        ("agent", "Give me your date of birth."),
        ("callee", "Fine."),
        ("agent", "Could you confirm the email? Spell the code, please."),
    )
    card = analyze(turns, "")
    assert card["counts"]["bald"] == 1 and card["counts"]["requests"] == 3
    assert card["verdict"] == "MIXED"


def test_question_never_bald_and_modal_strategy():
    turns = _turns(("agent", "Could you spell your last name?"))
    card = analyze(turns, "")
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert card["requests"][0]["form"] == "question"
    assert card["requests"][0]["strategies"] == ["modal"]


def test_please_softens_imperative():
    turns = _turns(("agent", "Please give me your date of birth."))
    card = analyze(turns, "")
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "please" in card["requests"][0]["strategies"]


def test_kindly_counts_as_please():
    turns = _turns(("agent", "Kindly confirm the total."))
    card = analyze(turns, "")
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "please" in card["requests"][0]["strategies"]


def test_gratitude_sentence_and_please_request():
    turns = _turns(
        ("agent", "Thank you for your patience. Now, your date of birth, please?"),
        ("callee", "Sure."),
    )
    card = analyze(turns, "")
    assert card["counts"]["requests"] == 1
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "please" in card["requests"][0]["strategies"]


def test_if_you_would_indirect_request():
    turns = _turns(
        ("agent", "If you would just confirm the total, we're done."),
        ("callee", "Done."),
    )
    card = analyze(turns, "")
    assert card["counts"]["requests"] == 1
    assert card["requests"][0]["form"] == "question"
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "deference" in card["requests"][0]["strategies"]
    assert "hedge" in card["requests"][0]["strategies"]


def test_i_was_wondering_indirect():
    turns = _turns(
        ("agent", "I was wondering if you could read the card number to me."),
        ("callee", "Sure."),
    )
    card = analyze(turns, "")
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "indirect" in card["requests"][0]["strategies"]


def test_would_you_mind_counterfactual():
    turns = _turns(("agent", "Would you mind spelling that?"))
    card = analyze(turns, "")
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "counterfactual" in card["requests"][0]["strategies"]


def test_might_i_ask_indirect():
    turns = _turns(("agent", "Might I ask you to confirm the date?"), ("callee", "The 5th."))
    card = analyze(turns, "")
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "indirect" in card["requests"][0]["strategies"]


def test_im_afraid_implicit_request():
    turns = _turns(
        ("agent", "I'm afraid I'll still need your membership number."),
        ("callee", "Okay."),
    )
    card = analyze(turns, "")
    assert card["counts"]["requests"] == 1
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert "apologize" in card["requests"][0]["strategies"]


def test_transitional_self_directed_only_hold_line_request():
    turns = _turns(
        ("agent", "Hold on. Let me check the system. One moment. I'll be right back. Please hold the line."),
        ("callee", "Take your time."),
        ("agent", "Thank you for waiting."),
    )
    card = analyze(turns, "")
    assert card["counts"]["requests"] == 1
    assert card["requests"][0]["grade"] == "SOFTENED"
    assert card["verdict"] == "COURTEOUS"


def test_hold_the_line_bald():
    turns = _turns(("agent", "Hold the line."))
    card = analyze(turns, "")
    assert card["counts"]["requests"] == 1
    assert card["requests"][0]["grade"] == "BALD"


def test_formal_address_strategy():
    turns = _turns(("agent", "Mr. Nguyen, please confirm the address."))
    card = analyze(turns, "")
    assert "formal_address" in card["requests"][0]["strategies"]
    assert "please" in card["requests"][0]["strategies"]


def test_condescension_advisory_never_changes_verdict():
    turns = _turns(
        ("agent", "Thank you, dear. Could you confirm the date?"),
        ("callee", "Sure, honey."),
    )
    card = analyze(turns, "")
    assert card["verdict"] == "COURTEOUS"
    assert card["counts"]["condescension_flags"] == 1
    assert "condescension_turn: 0" in card["advisories"]


def test_no_requests_informational():
    turns = _turns(("agent", "Your order shipped yesterday."), ("callee", "Great."))
    assert analyze(turns, "")["verdict"] == "NO_AGENT_REQUESTS"


def test_say_exclamatory_guard():
    turns = _turns(
        ("agent", "Say, that's great news!"),
        ("callee", "Right?"),
    )
    card = analyze(turns, "")
    assert card["verdict"] == "NO_AGENT_REQUESTS"


def test_tell_me_bald_and_please_softened():
    turns = _turns(
        ("agent", "Tell me about your day."),
        ("callee", "Fine."),
        ("agent", "Tell me about your week, please?"),
    )
    card = analyze(turns, "")
    assert card["counts"]["requests"] == 2
    assert card["requests"][0]["grade"] == "BALD"
    assert card["requests"][1]["grade"] == "SOFTENED"


def test_masked_digits_do_not_break_classification():
    turns = _turns(
        ("agent", "Confirm the number +14155550179, please."),
        ("callee", "Confirmed."),
    )
    card = analyze(turns, "")
    assert card["requests"][0]["grade"] == "SOFTENED"


def test_courteous_full_dialogue():
    turns = _turns(
        ("agent", "Hi, this is the clinic calling about your delivery to +14155550179. Could you confirm your date of birth, please?"),
        ("callee", "Sure, 02/14."),
        ("agent", "Thank you. And could you spell your last name for me?"),
        ("callee", "N-G-U-Y-E-N."),
        ("agent", "Perfect, thank you so much. Just one more thing - would you mind confirming the delivery address?"),
        ("callee", "Yes, 2203 Market Street."),
        ("agent", "Thank you, that's everything."),
    )
    card = analyze(turns, "")
    assert card["verdict"] == "COURTEOUS"
    assert card["counts"]["bald"] == 0


def test_cli_wrapped_real_shape(tmp_path):
    p = tmp_path / "wrapped.json"
    p.write_text(
        json.dumps(
            {
                "call_id": "demo-polite-001",
                "status": "COMPLETED",
                "result": {
                    "post_summary": "Details confirmed politely.",
                    "transcript": [
                        {"speaker": "agent", "text": "Could you confirm your date of birth, please?"},
                        {"speaker": "callee", "text": "Sure."},
                        {"speaker": "agent", "text": "Thank you."},
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    r = _run_cli(["analyze", "--call-result", str(p)])
    assert r.returncode == 0
    card = json.loads(r.stdout)
    assert card["verdict"] == "COURTEOUS"
    assert card["post_summary_present"] is True


def test_craft_prints_template():
    r = _run_cli(["craft"])
    assert r.returncode == 0
    assert "Never use bare imperatives" in r.stdout


def test_fixture_files_grade_as_promised():
    for name, expected in [
        ("example-call-result.json", "COURTEOUS"),
        ("example-call-result-bald.json", "BALD_REQUESTS_DETECTED"),
        ("example-call-result-mixed.json", "MIXED"),
    ]:
        rec = load_call_result(FIX / name)
        card = analyze(rec["turns"], rec["post_summary"], call_id=rec["call_id"])
        assert card["verdict"] == expected, f"{name}: {card['verdict']}"


if __name__ == "__main__":
    import pytest

    sys.exit(pytest.main([__file__, "-v"]))
