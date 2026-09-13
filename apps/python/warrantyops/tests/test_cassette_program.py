"""The cassette program: scrub, gate, replay, diverge, and stay honest.

§4.2/§4.3 (locked). The scrubber is deterministic; the export gate is the
planted-leak negative control; a cassette replays through the real adapter
contract; the divergence harness keeps FakeCalle inside the platform
vocabulary; and the registry keeps R1 receipt-only, R4 recorded, R8/R3
attempted-and-failed, and the remaining live rows planned/gated so neither
an absent nor a failed row can be silently counted as evidence.
"""

from __future__ import annotations

import json
import re

import pytest

from warrantyops.cassettes import (
    CASSETTE_DIR,
    CASSETTE_SCHEMA_VERSION,
    CassetteExportRefused,
    build_cassette,
    export_violations,
    fake_divergences,
    load_cassette,
    registry_rows,
    replay_cassette,
    scrub_cassette,
)

#: The negative-control plants, assembled at runtime so the repository's own
#: hygiene scanner never sees a literal unlabelled call token, credential or
#: non-reserved number in source. They exist only in memory, which is where
#: the control runs.
UNLABELLED_ID = "call_" + "controlA7b2C9"
UNLABELLED_ID_2 = "call_" + "controlB3c1D8"
UNLABELLED_ID_3 = "call_" + "realleak"
PLANTED_CREDENTIAL = "sk-" + "abcdef123456789"
PLANTED_CREDENTIAL_2 = "sk-" + "1234567890abcdef"
PLANTED_INTERNATIONAL = "+91" + "9876543210"
PLANTED_INTERNATIONAL_2 = "+81" + "9012345678"
PLANTED_INTERNATIONAL_3 = "+44" + "7700900123"

#: A raw artifact shape with deliberately real-looking, planted values. The
#: numbers and ids below are the negative control's plants: real-shaped, not
#: reserved-fictional, and they must never survive the scrubber.
PLANTED_RAW = {
    "row": "synthetic-control",
    "evidence_class": "Synthetic scenario",
    "call": {
        "id": UNLABELLED_ID,
        "status": "completed",
        "recipient": PLANTED_INTERNATIONAL,
        "failure_code": None,
    },
    "transcript_turns": [
        {"speaker": "bot", "text": "What is the status of claim CLM-2001?", "scripted": True},
        {
            "speaker": "user",
            "text": f"It is case BR-4821. You can reach me back on {PLANTED_INTERNATIONAL_3}.",
            "scripted": True,
        },
        {
            "speaker": "user",
            "text": f"off-script remark mentioning {PLANTED_CREDENTIAL}",
            "scripted": False,
        },
    ],
    "structured_result": {
        "reference_kind": "CASE",
        "reference_readback_performed": True,
        "claim_status": "STATED_RETURNED",
        "claim_status_evidence_quote": "It is case BR-4821.",
    },
    "timings": {"started_at": "2026-09-01T12:00:00Z", "completed_at": "2026-09-01T12:03:30Z"},
}

COMPLETE_NUMBER = re.compile(r"\+[1-9]\d{7,14}\b")
CALL_TOKEN = re.compile(r"\bcall_[A-Za-z0-9_-]{2,}\b")
FICTIONAL = re.compile(re.escape("+1" + "20255501") + r"\d{2}\b")


# --- the deterministic scrubber ----------------------------------------------------


def test_scrubbing_twice_is_byte_identical():
    assert scrub_cassette(PLANTED_RAW) == scrub_cassette(PLANTED_RAW)


def test_distinct_plants_map_to_distinct_fictional_numbers():
    first = scrub_cassette(PLANTED_RAW)
    second = scrub_cassette(
        {
            **PLANTED_RAW,
            "call": {**PLANTED_RAW["call"], "recipient": PLANTED_INTERNATIONAL_2},
        }
    )
    numbers = {
        first["call"]["recipient"],
        second["call"]["recipient"],
    }
    assert len(numbers) == 2  # two recipients never collapse into one
    for number in numbers:
        assert FICTIONAL.fullmatch(number), number


def test_the_scrubber_never_lets_a_plant_survive():
    cassette = build_cassette(PLANTED_RAW)  # raises if the gate sees a plant
    text = json.dumps(cassette)
    assert "+91" not in text and "+44" not in text  # country prefixes of the plants
    for number in COMPLETE_NUMBER.findall(text):
        assert FICTIONAL.fullmatch(number), number
    for token in CALL_TOKEN.findall(text):
        assert "synthetic" in token.lower(), token
    assert PLANTED_CREDENTIAL not in text


def test_a_number_inside_a_scripted_turn_is_scrubbed_too():
    turn = cassette_text_of_turn(build_cassette(PLANTED_RAW), 1)
    assert PLANTED_INTERNATIONAL_3 not in turn
    assert FICTIONAL.search(turn), turn


def cassette_text_of_turn(cassette, index: int) -> str:
    return str(cassette["transcript_turns"][index]["text"])


def test_a_non_scripted_utterance_is_replaced_wholesale():
    cassette = build_cassette(PLANTED_RAW)
    replaced = cassette["transcript_turns"][2]
    assert replaced["text"] == "[non-scripted utterance replaced by the scrubber]"
    assert PLANTED_CREDENTIAL not in replaced["text"]


def test_the_cassette_carries_schema_and_one_evidence_class():
    cassette = build_cassette(PLANTED_RAW)
    assert cassette["schema"] == CASSETTE_SCHEMA_VERSION
    assert cassette["evidence_class"] == "Synthetic scenario"


# --- the planted-leak negative control (gate 6) --------------------------------------


def test_the_gate_fails_a_planted_real_shaped_identifier():
    """The control: plants that reached export unscrubbed are named and refused."""

    bypassed = {
        "row": "control",
        "evidence_class": "Synthetic scenario",
        "call": {"id": UNLABELLED_ID, "status": "completed",
                 "recipient": PLANTED_INTERNATIONAL},
    }
    violations = export_violations(bypassed)
    assert any("real-shaped number" in v for v in violations)
    assert any("unlabelled call id" in v for v in violations)
    # A broken scrubber that passes the raw artifact through unchanged still
    # cannot publish: the gate raises on the same named violations.
    with pytest.raises(CassetteExportRefused) as refused:
        raw_passthrough_scrub(bypassed)
    assert refused.value.violations == violations


def raw_passthrough_scrub(cassette):
    """Stands in for a broken scrubber: identity instead of scrubbing."""

    violations = export_violations(cassette)
    if violations:
        raise CassetteExportRefused(violations)
    return cassette


def test_the_gate_fails_a_credential_and_an_email():
    leaky = {
        "row": "control",
        "evidence_class": "Synthetic scenario",
        "call": {"id": "call_synthetic_ok", "status": "completed",
                 "recipient": "+12025550101"},
        "operator_note": f"key {PLANTED_CREDENTIAL_2} contact desk@example.com",
    }
    violations = export_violations(leaky)
    assert any("credential" in v for v in violations)
    assert any("email" in v for v in violations)


def test_the_gate_passes_the_clean_scrubbed_cassette():
    assert export_violations(build_cassette(PLANTED_RAW)) == []


# --- cassette replay -----------------------------------------------------------------


def test_a_cassette_replays_through_the_real_adapter_contract():
    report = replay_cassette(build_cassette(PLANTED_RAW))
    assert report["terminal_state"] == "INFORMATION_OBTAINED"
    assert report["transport_state"] == "completed"
    assert report["claim_status"] == "STATED_RETURNED"  # grounded quote present
    assert report["evidence_class"] == "Synthetic scenario"


def test_a_cassette_with_an_invalid_result_replays_to_result_invalid():
    raw = {
        "row": "control",
        "evidence_class": "Synthetic scenario",
        "call": {"id": UNLABELLED_ID_2, "status": "completed",
                 "recipient": PLANTED_INTERNATIONAL},
        "transcript_turns": [{"speaker": "user", "text": "It is returned.", "scripted": True}],
        "structured_result": {
            "reference_kind": "CASE",
            "reference_readback_performed": False,
            "claim_status": "STATED_RETURNED",
            "claim_status_evidence_quote": 7,  # type-violating on purpose
        },
    }
    report = replay_cassette(build_cassette(raw))
    assert report["terminal_state"] == "RESULT_INVALID"
    assert report["validation_errors"]


def test_load_cassette_refuses_a_drifted_file(tmp_path):
    drifted = tmp_path / "r9.json"
    drifted.write_text(
        json.dumps(
            {
                "schema": CASSETTE_SCHEMA_VERSION,
                "row": "R9",
                "evidence_class": "Synthetic scenario",
                "call": {"id": UNLABELLED_ID_3, "status": "completed",
                         "recipient": PLANTED_INTERNATIONAL_2},
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(CassetteExportRefused):
        load_cassette(drifted)


def test_load_cassette_refuses_a_schema_mismatch(tmp_path):
    old = tmp_path / "r9.json"
    old.write_text(
        json.dumps(
            {
                "schema": 0,
                "row": "R9",
                "evidence_class": "Synthetic scenario",
                "call": {"id": "call_synthetic_x", "status": "completed",
                         "recipient": "+12025550101"},
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(CassetteExportRefused, match="schema"):
        load_cassette(old)


def test_r3_and_r4_are_the_only_checked_in_cassettes():
    """R3 and R4 are recorded; R1 remains receipt-only."""

    assert sorted(path.name for path in CASSETTE_DIR.glob("*.json")) == [
        "r3.json",
        "r4.json",
    ]


# --- the FakeCalle divergence harness ---------------------------------------------------


def test_every_fake_scenario_stays_inside_the_platform_vocabulary():
    assert fake_divergences() == []


def test_the_harness_catches_an_invented_platform_behavior(tmp_path):
    inventing = tmp_path / "case_invented.json"
    inventing.write_text(
        json.dumps(
            {
                "recipient_e164": "+12025550142",
                "transport": {"state": "wormhole_transit", "call_id": "call_synthetic_w"},
                "transcript_turns": [{"speaker": "sysadmin", "text": "hello"}],
                "structured_result": {"teleported": True},
            }
        ),
        encoding="utf-8",
    )
    divergences = fake_divergences(fixture_dir=tmp_path)
    assert any("platform vocabulary" in d for d in divergences)
    assert any("scripted vocabulary" in d for d in divergences)
    assert any("extraction schema" in d for d in divergences)


def test_a_scenario_that_never_places_a_call_has_no_shape_to_break():
    """transport: null is a gate-refusal scenario, not a divergence."""

    from warrantyops.providers.fake import FIXTURE_DIR

    scenario = json.loads(
        (FIXTURE_DIR / "case_b_source_sufficient.json").read_text(encoding="utf-8")
    )
    assert scenario["transport"] is None  # the source already answers
    assert fake_divergences() == []


# --- the registry: recorded, failed, and unexecuted rows ------------------------------


def test_the_registry_pins_every_row_status():
    by_row = {row.row: row for row in registry_rows()}
    assert by_row["R1"].status == "recorded"
    assert by_row["R1"].cassette is None
    assert by_row["R1"].cassette_unavailable
    assert "unavailable" in by_row["R1"].note
    assert by_row["R2"].status == "synthetic-only"
    assert by_row["R8"].status == "attempted/failed"
    assert by_row["R8"].cassette is None
    assert by_row["R8"].receipt is None
    assert "404/call_failed" in by_row["R8"].note
    assert by_row["R3"].status == "recorded"
    assert by_row["R3"].cassette == "tests/cassettes/r3.json"
    assert by_row["R3"].receipt == "proof/receipts/r3.public.json"
    assert "post-routing-fix" in by_row["R3"].note
    assert by_row["R4"].status == "recorded"
    assert by_row["R4"].cassette == "tests/cassettes/r4.json"
    assert by_row["R4"].receipt == "proof/receipts/r4.public.json"
    for number in (5, 6, 7, 9):
        assert by_row[f"R{number}"].status == "planned/gated"
        assert by_row[f"R{number}"].cassette is None
        assert by_row[f"R{number}"].receipt is None


def test_the_r1_receipt_exists_and_no_r1_cassette_does():
    from warrantyops.proof_screen import DEFAULT_OUTPUT

    receipt = DEFAULT_OUTPUT.parent / "runtime-proof-receipt.public.json"
    assert receipt.exists()
    assert not (CASSETTE_DIR / "r1.json").exists()


def test_evidence_classes_match_row_status():
    for row in registry_rows():
        if row.status == "attempted/failed":
            assert row.evidence_class == ""
        else:
            assert row.evidence_class in (
                "Recorded CALL-E result",
                "Synthetic scenario",
                "Fictional case data",
            )
