"""The recorded R4 no-answer cassette must replay without overclaiming."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from warrantyops.cassettes import (
    CASSETTE_DIR,
    load_cassette,
    registry_rows,
    replay_cassette,
)

APP = Path(__file__).resolve().parents[1]
RECEIPT_PATH = APP / "proof" / "receipts" / "r4.public.json"


def test_r4_is_the_recorded_no_answer_registry_row():
    row = {entry.row: entry for entry in registry_rows()}["R4"]
    assert row.status == "recorded"
    assert row.evidence_class == "Recorded CALL-E result"
    assert row.cassette == "tests/cassettes/r4.json"
    assert row.receipt == "proof/receipts/r4.public.json"
    assert "zero retries" in row.note


def test_the_public_cassette_passes_the_export_gate_and_replays():
    cassette = load_cassette(CASSETTE_DIR / "r4.json")
    assert cassette["row"] == "R4"
    assert cassette["evidence_class"] == "Recorded CALL-E result"
    assert cassette["call"]["status"] == "failed"
    assert cassette["call"]["task_completed"] is False
    assert cassette["transcript_turns"] == []
    assert cassette["expected"]["person_reached"] is False
    assert cassette["structured_result"]["claim_status"] == "UNKNOWN"

    replay = replay_cassette(cassette)
    assert replay["transport_state"] == "failed"
    assert replay["terminal_state"] == "TRANSPORT_FAILED"
    assert replay["claim_status"] == "UNKNOWN"
    assert replay["evidence_class"] == "Recorded CALL-E result"


def test_the_public_receipt_matches_the_recorded_outcome_and_artifacts():
    receipt = json.loads(RECEIPT_PATH.read_text(encoding="utf-8"))
    cassette_path = CASSETTE_DIR / "r4.json"
    cassette_hash = hashlib.sha256(cassette_path.read_bytes()).hexdigest()

    assert receipt["row"] == "R4"
    assert receipt["calls_created"] == 1
    assert receipt["calls_retried"] == 0
    assert receipt["transport"] == "failed"
    assert receipt["claim_status"] == "UNKNOWN"
    assert receipt["person_reached"] is False
    assert receipt["transcript_turns"] == 0
    assert receipt["write_back"] == "WITHHELD_PENDING_HUMAN_REVIEW"
    assert receipt["cassette_sha256"] == cassette_hash
    assert receipt["observed"]["claim_status"] == "UNKNOWN"
