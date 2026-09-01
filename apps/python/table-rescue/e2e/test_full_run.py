import shutil
from pathlib import Path

from table_rescue.cli import main
from table_rescue.stores import read_jsonl

APP_ROOT = Path(__file__).resolve().parents[1]
DIALLED = {"CONFIRMED", "CANCELLED", "RESCHEDULED", "NO_ANSWER", "ACCEPTED", "DECLINED"}


def test_full_dry_run_recovers_cancelled_table(tmp_path):
    data_dir = tmp_path / "data"
    (data_dir / "fixtures").mkdir(parents=True)
    shutil.copy(APP_ROOT / "data" / "reservations.sample.jsonl", data_dir / "reservations.jsonl")
    shutil.copy(APP_ROOT / "data" / "waitlist.sample.jsonl", data_dir / "waitlist.jsonl")
    shutil.copy(
        APP_ROOT / "data" / "fixtures" / "dry_run_outcomes.jsonl",
        data_dir / "fixtures" / "dry_run_outcomes.jsonl",
    )
    state_dir = tmp_path / "state"
    exit_code = main(
        [
            "run",
            "--data-dir", str(data_dir),
            "--state-dir", str(state_dir),
            "--run-id", "e2e-1",
            "--call-window-start", "00:00",
            "--call-window-end", "23:59",
        ]
    )
    assert exit_code == 0
    statuses = {
        row["booking_id"]: row["status"]
        for row in read_jsonl(data_dir / "reservations.jsonl")
    }
    assert statuses["R-001"] == "RECOVERED"
    assert statuses["R-002"] == "CONFIRMED"
    assert statuses["R-003"] == "PENDING_CONFIRM"
    waitlist_statuses = {
        row["entry_id"]: row["status"]
        for row in read_jsonl(data_dir / "waitlist.jsonl")
    }
    assert waitlist_statuses["W-001"] == "DECLINED"
    assert waitlist_statuses["W-002"] == "WAITING"
    assert waitlist_statuses["W-003"] == "ACCEPTED"
    audit = read_jsonl(state_dir / "runs" / "e2e-1" / "audit.jsonl")
    dialed = [row for row in audit if row["status"] in DIALLED]
    assert len(dialed) == 4
    assert [(row["target_id"], row["status"]) for row in dialed] == [
        ("R-001", "CANCELLED"),
        ("W-001", "DECLINED"),
        ("W-003", "ACCEPTED"),
        ("R-002", "CONFIRMED"),
    ]
    skipped = [row for row in audit if row["status"] == "SKIPPED_NO_CONSENT"]
    assert len(skipped) == 1
    assert skipped[0]["target_id"] == "R-003"
    report = (state_dir / "runs" / "e2e-1" / "report.md").read_text(encoding="utf-8")
    assert "Slots recovered: 1" in report
