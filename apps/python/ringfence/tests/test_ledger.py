from pathlib import Path

import pytest

from ringfence.ledger import CaseLedger, CorruptLedgerEntry


def test_replay_of_a_missing_file_is_an_empty_dict(tmp_path: Path):
    ledger = CaseLedger(tmp_path / "ledger.jsonl")
    assert ledger.replay() == {}


def test_create_then_replay_round_trips_the_record(tmp_path: Path):
    ledger = CaseLedger(tmp_path / "ledger.jsonl")
    ledger.append("create", "case_1", {"case_id": "case_1", "status": "reserved"})
    assert ledger.replay() == {"case_1": {"case_id": "case_1", "status": "reserved"}}


def test_update_events_merge_into_the_existing_record(tmp_path: Path):
    ledger = CaseLedger(tmp_path / "ledger.jsonl")
    ledger.append("create", "case_1", {"case_id": "case_1", "status": "reserved", "disposition": None})
    ledger.append("update", "case_1", {"status": "dialed"})
    ledger.append("update", "case_1", {"disposition": "ADVISE_ALLOW"})
    assert ledger.replay() == {
        "case_1": {"case_id": "case_1", "status": "dialed", "disposition": "ADVISE_ALLOW"}
    }


def test_multiple_cases_are_tracked_independently(tmp_path: Path):
    ledger = CaseLedger(tmp_path / "ledger.jsonl")
    ledger.append("create", "case_1", {"case_id": "case_1", "status": "reserved"})
    ledger.append("create", "case_2", {"case_id": "case_2", "status": "reserved"})
    ledger.append("update", "case_1", {"status": "dialed"})
    state = ledger.replay()
    assert state["case_1"]["status"] == "dialed"
    assert state["case_2"]["status"] == "reserved"


def test_truncated_final_line_from_a_mid_write_crash_is_skipped_not_fatal(tmp_path: Path):
    path = tmp_path / "ledger.jsonl"
    ledger = CaseLedger(path)
    ledger.append("create", "case_1", {"case_id": "case_1", "status": "reserved"})
    ledger.append("create", "case_2", {"case_id": "case_2", "status": "reserved"})
    # Simulate a crash mid-write: append a half-written JSON line (no closing brace).
    with open(path, "a", encoding="utf-8") as f:
        f.write('{"event": "update", "case_id": "case_2", "record": {"status": "dia')

    state = ledger.replay()
    assert state == {
        "case_1": {"case_id": "case_1", "status": "reserved"},
        "case_2": {"case_id": "case_2", "status": "reserved"},
    }


def test_a_corrupt_line_that_is_not_the_last_one_still_raises(tmp_path: Path):
    path = tmp_path / "ledger.jsonl"
    ledger = CaseLedger(path)
    ledger.append("create", "case_1", {"case_id": "case_1", "status": "reserved"})
    with open(path, "a", encoding="utf-8") as f:
        f.write('{"not valid json\n')  # corrupt, but NOT the final line
    ledger.append("create", "case_2", {"case_id": "case_2", "status": "reserved"})

    with pytest.raises(CorruptLedgerEntry):
        ledger.replay()
