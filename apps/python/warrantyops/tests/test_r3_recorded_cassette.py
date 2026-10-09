"""R3 live post-routing-fix cassette: export gate and replay."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from warrantyops.cassettes import load_cassette

CASSETTE_DIR = Path(__file__).parent / "cassettes"
RECEIPT_PATH = Path(__file__).parent.parent / "proof" / "receipts" / "r3.public.json"


def test_the_public_cassette_passes_the_export_gate_and_replays():
    cassette = load_cassette(CASSETTE_DIR / "r3.json")
    assert cassette["row"] == "R3"
    assert cassette["evidence_class"] == "Recorded CALL-E result"
    assert cassette["call"]["status"] == "completed"
    assert cassette["call"]["transport"] == "completed"
    assert cassette["call"]["person_reached"] is True
    assert cassette["call"]["task_completed"] is False
    assert len(cassette["transcript_turns"]) == 18
    assert cassette["call"]["claim_status"] == "UNKNOWN"
    assert cassette["call"]["write_back"] == "WITHHELD_PENDING_HUMAN_REVIEW"


def test_the_public_receipt_matches_the_recorded_outcome_and_artifacts():
    receipt = json.loads(RECEIPT_PATH.read_text(encoding="utf-8"))
    cassette_path = CASSETTE_DIR / "r3.json"
    cassette_hash = hashlib.sha256(cassette_path.read_bytes()).hexdigest()

    assert receipt["row"] == "R3"
    assert receipt["calls_created"] == 1
    assert receipt["calls_retried"] == 0
    assert receipt["transport"] == "completed"
    assert receipt["person_reached"] is True
    assert receipt["transcript_turns"] == 18
    assert receipt["claim_status"] == "UNKNOWN"
    assert receipt["write_back"] == "WITHHELD_PENDING_HUMAN_REVIEW"
    assert receipt["routing"]["region"] == "IN"
    assert receipt["routing"]["locale"] == "en-IN"
