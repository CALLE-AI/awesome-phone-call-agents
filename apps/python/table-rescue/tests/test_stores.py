import tempfile
from pathlib import Path

from table_rescue.models import CallOutcome, CallStatus
from table_rescue.safety import mask_phone
from table_rescue.stores import (
    AuditLog,
    read_jsonl,
    write_jsonl_atomic,
)


def test_jsonl_roundtrip_and_atomic_write(tmp_path):
    path = tmp_path / "rows.jsonl"
    rows = [{"booking_id": "R-001"}, {"booking_id": "R-002"}]
    write_jsonl_atomic(path, rows)
    assert read_jsonl(path) == rows
    assert not (tmp_path / "rows.jsonl.tmp").exists()


def test_mask_phone_keeps_last_two_digits():
    assert mask_phone("+15550101") == "+******01"


def test_audit_notes_are_sanitized(tmp_path):
    audit = AuditLog(tmp_path / "runs" / "run-1")
    audit.append(
        CallOutcome(
            run_id="run-1",
            target_id="R-001",
            status=CallStatus.CONFIRMED,
            notes="guest on +14155550100 confirmed",
        )
    )
    record = audit.records()[0]
    assert "+14155550100" not in record["notes"]
    assert "confirmed" in record["notes"]


def test_audit_log_tracks_dials_and_cancellation(tmp_path):
    audit = AuditLog(tmp_path / "runs" / "run-1")
    audit.append(CallOutcome(run_id="run-1", target_id="R-001", status=CallStatus.CANCELLED))
    assert audit.dialed_targets() == {"R-001"}
    audit.append(
        CallOutcome(run_id="run-1", target_id="R-002", status=CallStatus.SKIPPED_NO_CONSENT)
    )
    assert audit.dialed_targets() == {"R-001"}
    assert not audit.is_cancelled()
    audit.append(
        CallOutcome(run_id="run-1", target_id="-", status=CallStatus.CANCELLED_BY_OPERATOR)
    )
    assert audit.is_cancelled()


def test_dialed_targets_counts_uncertain():
    audit = AuditLog(Path(tempfile.mkdtemp()) / "runs" / "run-1")
    audit.append(
        CallOutcome(
            run_id="run-1", target_id="R-001", status=CallStatus.UNCERTAIN,
            uncertainty_reason="UNPARSEABLE_SUMMARY",
        )
    )
    assert audit.dialed_targets() == {"R-001"}
    record = audit.records()[0]
    assert record["uncertainty_reason"] == "UNPARSEABLE_SUMMARY"
