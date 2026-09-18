#!/usr/bin/env python3
"""Tests for the call-attest-challenge-auth skill.

Run:
    python3 -m pytest skills/call-attest-challenge-auth/scripts/test_attest_auth.py -v
    python3 skills/call-attest-challenge-auth/scripts/test_attest_auth.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
REPO_ROOT = SKILL_DIR.parent.parent
EXAMPLE_VERIFIED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_MISMATCH = SKILL_DIR / "references" / "example-transcript-mismatch.json"

sys.path.insert(0, str(SCRIPTS))
from attest_auth import (  # noqa: E402
    _levenshtein,
    _match_response,
    _normalize_tokens,
    build_attestation_card,
    craft_goal,
    derive_code,
    load_call_result,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_VERIFIED)
    assert data["status"] == "COMPLETED"
    assert data["turns"][0]["speaker"] == "agent"
    assert "4f2a91" in data["turns"][0]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_MISMATCH)
    assert data["status"] == "completed"
    assert len(data["turns"]) == 3


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []


def test_mask_ten_digit_phone_keeps_last_two():
    # run "1 415 555 0155" is 14 chars (11 digits) -> 12 hashes + last 2 chars
    assert mask_pii("call +1 415 555 0155 now") == "call +############55 now"


def test_mask_exactly_seven_digits_is_masked():
    assert mask_pii("ref 555-0155 closed") == "ref ######55 closed"


def test_short_digit_runs_untouched():
    text = "Nonce 4f2a91, code 42, order 12345"
    assert mask_pii(text) == text


def test_mask_separators_count_toward_one_run():
    assert mask_pii("id 415.555.0155 x9") == "id ##########55 x9"


def test_mask_trailing_separator_not_part_of_run():
    assert mask_pii("num 5550155, please") == "num #####55, please"


def test_derive_code_deterministic():
    assert derive_code("s3cret", "4f2a91") == derive_code("s3cret", "4f2a91")


def test_derive_code_nonce_sensitive():
    assert derive_code("s3cret", "4f2a91") != derive_code("s3cret", "4f2a92")


def test_derive_code_format():
    from attest_auth import COLORS, NUMBER_WORDS
    code = derive_code("s3cret", "4f2a91")
    assert len(code) == 4
    assert code[0] in COLORS
    assert code[1] in COLORS
    assert code[2] in NUMBER_WORDS
    assert re.fullmatch(r"[0-9]{2}", code[3])


def test_normalize_expands_digit_strings():
    assert _normalize_tokens("42") == ["FOUR", "TWO"]


def test_normalize_confusables():
    assert _normalize_tokens("FOR") == ["FOUR"]
    assert _normalize_tokens("blue, orange TOO") == ["BLUE", "ORANGE", "TWO"]


def test_levenshtein_distances():
    assert _levenshtein("FOUR", "FOUR") == 0
    assert _levenshtein("FOUR", "FOR") == 1
    assert _levenshtein("BLUE", "BLEU") == 2


def test_match_response_exact():
    expected = _normalize_tokens("BLUE ORANGE SEVEN 42")
    assert _match_response(expected, _normalize_tokens("BLUE ORANGE SEVEN 42")) is True


def test_match_response_fuzzy_one_edit():
    expected = _normalize_tokens("BLUE ORANGE SEVEN 42")
    assert _match_response(expected, _normalize_tokens("BLUE ORANJE SEVEN FOUR TWO")) is True


def test_match_response_wrong_code_fails():
    expected = _normalize_tokens("BLUE ORANGE SEVEN 42")
    assert _match_response(expected, _normalize_tokens("RED APPLE FIVE 99")) is False


def test_match_response_order_and_extras():
    expected = _normalize_tokens("BLUE ORANGE SEVEN 42")
    assert _match_response(expected, _normalize_tokens("OK BLUE PLEASE ORANGE SEVEN FOUR TWO")) is True
    assert _match_response(expected, _normalize_tokens("ORANGE BLUE SEVEN FOUR TWO")) is False


def _card_from_fixture(path: Path, ledger: Path | None = None) -> dict:
    data = load_call_result(path)
    return build_attestation_card(
        data["turns"],
        nonce="4f2a91",
        expected_code="BLUE ORANGE SEVEN 42",
        ledger_path=ledger,
    )


def test_card_verified_fixture():
    card = _card_from_fixture(EXAMPLE_VERIFIED)
    assert card["skill"] == "call-attest-challenge-auth"
    assert card["analysis_mode"] == "heuristic"
    assert card["attestation"] == "VERIFIED"
    assert card["reason"] is None
    assert card["recommended_action"]["action"] == "accept_and_continue"
    assert "disclaimer" in card and card["disclaimer"]
    kinds = {e["kind"] for e in card["evidence"]}
    assert kinds == {"challenge_spoken", "response_heard"}


def test_card_mismatch_fixture():
    card = _card_from_fixture(EXAMPLE_MISMATCH)
    assert card["attestation"] == "FAILED_MISMATCH"
    assert card["recommended_action"]["action"] == "reject_caller"


def test_card_no_response_after_challenge():
    turns = [
        {"speaker": "agent", "text": "Coordination check. My word is 4f2a91. Please reply with the response code."},
        {"speaker": "agent", "text": "No reply? Ending the call."},
    ]
    card = build_attestation_card(turns, nonce="4f2a91", expected_code="BLUE ORANGE SEVEN 42")
    assert card["attestation"] == "FAILED_NO_RESPONSE"
    assert card["reason"] == "no_response_after_challenge"
    assert card["recommended_action"]["action"] == "reject_caller"


def test_card_challenge_not_spoken():
    turns = [
        {"speaker": "agent", "text": "Hello, this is an automated assistant calling about your order."},
        {"speaker": "callee", "text": "BLUE ORANGE SEVEN 42"},
    ]
    card = build_attestation_card(turns, nonce="4f2a91", expected_code="BLUE ORANGE SEVEN 42")
    assert card["attestation"] == "FAILED_NO_RESPONSE"
    assert card["reason"] == "challenge_not_spoken"


def test_card_replay_detected_and_not_reappended():
    with tempfile.TemporaryDirectory() as td:
        ledger = Path(td) / "ledger.jsonl"
        ledger.write_text(json.dumps({"nonce": "4f2a91", "used_at": "2026-09-18T00:00:00+00:00"}) + "\n", encoding="utf-8")
        card = _card_from_fixture(EXAMPLE_VERIFIED, ledger=ledger)
        assert card["attestation"] == "REPLAY_SUSPECTED"
        assert card["recommended_action"]["action"] == "investigate_replay"
        assert len(ledger.read_text(encoding="utf-8").strip().splitlines()) == 1


def test_card_verified_appends_nonce_to_ledger():
    with tempfile.TemporaryDirectory() as td:
        ledger = Path(td) / "ledger.jsonl"
        card = _card_from_fixture(EXAMPLE_VERIFIED, ledger=ledger)
        assert card["attestation"] == "VERIFIED"
        lines = [json.loads(line) for line in ledger.read_text(encoding="utf-8").strip().splitlines()]
        assert len(lines) == 1
        assert lines[0]["nonce"] == "4f2a91"
        assert "used_at" in lines[0]


def test_card_masks_digits_in_evidence():
    turns = [
        {"speaker": "agent", "text": "Coordination check. My word is 4f2a91. Reply with the code or call 415 555 0155."},
        {"speaker": "callee", "text": "BLUE ORANGE SEVEN 42"},
    ]
    card = build_attestation_card(turns, nonce="4f2a91", expected_code="BLUE ORANGE SEVEN 42")
    for entry in card["evidence"]:
        assert "5550155" not in json.dumps(entry)
        assert "415" not in entry["span"] or "#" in entry["span"]


def test_card_no_ledger_still_verifies():
    card = _card_from_fixture(EXAMPLE_VERIFIED, ledger=None)
    assert card["attestation"] == "VERIFIED"
