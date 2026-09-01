from table_rescue.cli import main
from table_rescue.stores import read_jsonl


def write_sample_data(tmp_path):
    data_dir = tmp_path / "data"
    (data_dir / "fixtures").mkdir(parents=True)
    (data_dir / "reservations.jsonl").write_text(
        '{"booking_id": "R-001", "name": "Fictional Guest One", "phone": "+15550101", '
        '"party_size": 4, "slot": "2026-09-10T19:00:00+07:00", "consent": true, '
        '"status": "PENDING_CONFIRM"}\n',
        encoding="utf-8",
    )
    (data_dir / "waitlist.jsonl").write_text(
        '{"entry_id": "W-001", "name": "Fictional Waitlist One", "phone": "+15550111", '
        '"party_size": 4, "window_start": "2026-09-10T18:00:00+07:00", '
        '"window_end": "2026-09-10T21:00:00+07:00", "priority": 1, "consent": true, '
        '"status": "WAITING"}\n',
        encoding="utf-8",
    )
    (data_dir / "fixtures" / "dry_run_outcomes.jsonl").write_text(
        '{"target_id": "R-001", "status": "CANCELLED", "new_slot": null, '
        '"notes": "cannot make it"}\n'
        '{"target_id": "W-001", "status": "ACCEPTED", "new_slot": null, '
        '"notes": "we will come"}\n',
        encoding="utf-8",
    )
    return data_dir


def test_run_dry_run_recovers_slot(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    state_dir = tmp_path / "state"
    exit_code = main(
        [
            "run",
            "--data-dir", str(data_dir),
            "--state-dir", str(state_dir),
            "--run-id", "run-test",
            "--call-window-start", "00:00",
            "--call-window-end", "23:59",
        ]
    )
    assert exit_code == 0
    reservations = read_jsonl(data_dir / "reservations.jsonl")
    waitlist = read_jsonl(data_dir / "waitlist.jsonl")
    assert reservations[0]["status"] == "RECOVERED"
    assert waitlist[0]["status"] == "ACCEPTED"
    assert (state_dir / "runs" / "run-test" / "report.md").exists()
    audit = read_jsonl(state_dir / "runs" / "run-test" / "audit.jsonl")
    assert len(audit) == 2
    assert "Slots recovered: 1" in capsys.readouterr().out


def test_cancel_marks_run(tmp_path):
    state_dir = tmp_path / "state"
    exit_code = main(["cancel", "--run-id", "run-test", "--state-dir", str(state_dir)])
    assert exit_code == 0
    records = read_jsonl(state_dir / "runs" / "run-test" / "audit.jsonl")
    assert records[-1]["status"] == "CANCELLED_BY_OPERATOR"
