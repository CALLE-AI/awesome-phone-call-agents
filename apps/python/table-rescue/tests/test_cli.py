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


def test_run_missing_data_files_fails_cleanly(tmp_path, capsys):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    exit_code = main(
        [
            "run",
            "--data-dir", str(empty_dir),
            "--state-dir", str(tmp_path / "state"),
            "--run-id", "x",
        ]
    )
    assert exit_code == 1
    assert "not found" in capsys.readouterr().err


def test_run_live_requires_region(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    exit_code = main(
        [
            "run", "--live",
            "--data-dir", str(data_dir),
            "--state-dir", str(tmp_path / "state"),
            "--run-id", "live-1",
        ]
    )
    assert exit_code == 1
    assert "--region" in capsys.readouterr().err


def test_run_live_requires_allowlist_file(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    exit_code = main(
        [
            "run", "--live", "--region", "US",
            "--data-dir", str(data_dir),
            "--state-dir", str(tmp_path / "state"),
            "--run-id", "live-1",
        ]
    )
    assert exit_code == 1
    assert "authorized_destinations" in capsys.readouterr().err


def test_run_live_aborts_on_missing_authorization(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    (data_dir / "authorized_destinations.jsonl").write_text(
        '{"phone": "+15550101", "authorized_by": "op", '
        '"authorized_at": "2026-09-07T00:00:00+07:00"}\n',
        encoding="utf-8",
    )
    exit_code = main(
        [
            "run", "--live", "--region", "US",
            "--data-dir", str(data_dir),
            "--state-dir", str(tmp_path / "state"),
            "--run-id", "live-1",
        ]
    )
    assert exit_code == 1
    err = capsys.readouterr().err
    # W-001 is not authorized; the raw phone is never printed, only masked.
    assert "+15550111" not in err
    assert "+******11" in err


def test_run_live_fictional_number_never_reaches_dial(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    (data_dir / "authorized_destinations.jsonl").write_text(
        '{"phone": "+15550101", "authorized_by": "op", '
        '"authorized_at": "2026-09-07T00:00:00+07:00"}\n'
        '{"phone": "+15550111", "authorized_by": "op", '
        '"authorized_at": "2026-09-07T00:00:00+07:00"}\n',
        encoding="utf-8",
    )
    exit_code = main(
        [
            "run", "--live", "--region", "US", "--yes",
            "--call-window-start", "00:00",
            "--call-window-end", "23:59",
            "--data-dir", str(data_dir),
            "--state-dir", str(tmp_path / "state"),
            "--run-id", "live-1",
        ]
    )
    assert exit_code == 1
    captured = capsys.readouterr()
    assert "FICTIONAL_NUMBER" in captured.err
    # The live manifest masks every phone before printing or persistence.
    assert "+15550101" not in captured.out
    assert "+15550111" not in captured.out
    assert "+******01" in captured.out


def test_preflight_fails_on_missing_authorization(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    (data_dir / "authorized_destinations.jsonl").write_text(
        '{"phone": "+15550101", "authorized_by": "op", '
        '"authorized_at": "2026-09-07T00:00:00+07:00"}\n',
        encoding="utf-8",
    )
    exit_code = main(
        [
            "preflight",
            "--data-dir", str(data_dir),
            "--region", "US",
            "--calle-command", "definitely-not-calle",
        ]
    )
    captured = capsys.readouterr()
    assert exit_code == 1
    assert "FAIL operator_authorization" in captured.out
    assert "FAIL calle_auth" in captured.out
    assert "PASS destinations_e164" in captured.out
    # Preflight detail never prints a raw phone.
    assert "+15550111" not in captured.out
    assert "+******11" in captured.out


def test_preflight_json_output(tmp_path, capsys):
    import json as jsonlib

    data_dir = write_sample_data(tmp_path)
    exit_code = main(
        [
            "preflight",
            "--data-dir", str(data_dir),
            "--region", "US",
            "--calle-command", "definitely-not-calle",
            "--json",
        ]
    )
    payload = jsonlib.loads(capsys.readouterr().out)
    names = {check["name"] for check in payload["checks"]}
    assert names == {
        "destinations_e164",
        "region_rules",
        "operator_authorization",
        "origin_pinned",
        "calle_auth",
        "budget_configured",
    }
    assert payload["ok"] is False
    assert exit_code == 1


def _write_uncertain_then_accept_fixtures(data_dir):
    (data_dir / "fixtures" / "first.jsonl").write_text(
        '{"target_id": "R-001", "status": "CANCELLED", "new_slot": null, '
        '"notes": "cannot make it"}\n'
        '{"target_id": "W-001", "status": "UNCERTAIN", "new_slot": null, '
        '"notes": "line went quiet", "uncertainty_reason": "PROVIDER_FAILED"}\n',
        encoding="utf-8",
    )
    (data_dir / "fixtures" / "second.jsonl").write_text(
        '{"target_id": "W-001", "status": "ACCEPTED", "new_slot": null, '
        '"notes": "we will come"}\n'
        '{"target_id": "R-001", "status": "CANCELLED", "new_slot": null, '
        '"notes": "cannot make it"}\n',
        encoding="utf-8",
    )


def test_resume_completes_story_after_uncertain_stop(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    _write_uncertain_then_accept_fixtures(data_dir)
    state_dir = tmp_path / "state"
    first = main(
        [
            "run",
            "--data-dir", str(data_dir),
            "--state-dir", str(state_dir),
            "--run-id", "story-1",
            "--fixture", str(data_dir / "fixtures" / "first.jsonl"),
            "--call-window-start", "00:00",
            "--call-window-end", "23:59",
        ]
    )
    assert first == 2  # reconciliation required
    waitlist = read_jsonl(data_dir / "waitlist.jsonl")
    assert waitlist[0]["status"] == "NEEDS_REVIEW"
    report = (state_dir / "runs" / "story-1" / "report.md").read_text(encoding="utf-8")
    assert "Needs review" in report

    second = main(
        [
            "resume",
            "--run-id", "story-1",
            "--data-dir", str(data_dir),
            "--state-dir", str(state_dir),
            "--run-id-new", "story-2",
            "--fixture", str(data_dir / "fixtures" / "second.jsonl"),
            "--call-window-start", "00:00",
            "--call-window-end", "23:59",
        ]
    )
    assert second == 0
    reservations = read_jsonl(data_dir / "reservations.jsonl")
    waitlist = read_jsonl(data_dir / "waitlist.jsonl")
    assert reservations[0]["status"] == "RECOVERED"
    assert waitlist[0]["status"] == "ACCEPTED"
    report2 = (state_dir / "runs" / "story-2" / "report.md").read_text(encoding="utf-8")
    assert "Resumed from run: story-1" in report2


def test_resume_skips_settled_targets(tmp_path):
    data_dir = write_sample_data(tmp_path)
    _write_uncertain_then_accept_fixtures(data_dir)
    state_dir = tmp_path / "state"
    main(
        ["run", "--data-dir", str(data_dir), "--state-dir", str(state_dir),
         "--run-id", "skip-1", "--fixture", str(data_dir / "fixtures" / "first.jsonl"),
         "--call-window-start", "00:00", "--call-window-end", "23:59"]
    )
    # R-001 was CANCELLED (settled, certain) in run skip-1; the second fixture
    # would return CANCELLED again if re-dialed. Resume must NOT dial R-001:
    second = main(
        ["resume", "--run-id", "skip-1",
         "--data-dir", str(data_dir), "--state-dir", str(state_dir),
         "--run-id-new", "skip-2",
         "--fixture", str(data_dir / "fixtures" / "second.jsonl"),
         "--call-window-start", "00:00", "--call-window-end", "23:59"]
    )
    assert second == 0
    audit = read_jsonl(state_dir / "runs" / "skip-2" / "audit.jsonl")
    dialed = [row["target_id"] for row in audit if row["status"] in
              {"CONFIRMED", "CANCELLED", "RESCHEDULED", "ACCEPTED", "DECLINED",
               "NO_ANSWER", "UNCERTAIN"}]
    assert dialed == ["W-001"]  # only the needs-review target is retried


def test_resume_missing_source_run_fails_cleanly(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    exit_code = main(
        ["resume", "--run-id", "nope",
         "--data-dir", str(data_dir), "--state-dir", str(tmp_path / "state")]
    )
    assert exit_code == 1
    assert "no audit log" in capsys.readouterr().err


def test_resume_refuses_operator_cancelled_run(tmp_path, capsys):
    data_dir = write_sample_data(tmp_path)
    state_dir = tmp_path / "state"
    main(["cancel", "--run-id", "stopped-1", "--state-dir", str(state_dir)])
    exit_code = main(
        ["resume", "--run-id", "stopped-1",
         "--data-dir", str(data_dir), "--state-dir", str(state_dir)]
    )
    assert exit_code == 1
    assert "cancelled by the operator" in capsys.readouterr().err


def test_module_entrypoint_runs():
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", "table_rescue.cli", "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "table-rescue" in result.stdout


def test_run_malformed_phone_fails_cleanly(tmp_path, capsys):
    data_dir = tmp_path / "data"
    (data_dir / "fixtures").mkdir(parents=True)
    (data_dir / "reservations.jsonl").write_text(
        '{"booking_id": "R-001", "name": "Guest", "phone": "not-a-phone", '
        '"party_size": 2, "slot": "2026-09-10T19:00:00+07:00", "consent": true}\n',
        encoding="utf-8",
    )
    waitlist_path = data_dir / "waitlist.jsonl"
    waitlist_path.write_text("", encoding="utf-8")
    exit_code = main(
        ["run", "--data-dir", str(data_dir), "--state-dir", str(tmp_path / "state"),
         "--run-id", "bad-1"]
    )
    assert exit_code == 1
    assert "INVALID_E164" in capsys.readouterr().err
