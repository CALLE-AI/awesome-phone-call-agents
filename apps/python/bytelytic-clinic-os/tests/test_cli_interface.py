import pytest
from bytelytic_clinic.cli import main
from unittest.mock import patch


def test_cli_confirmation_dry_run(capsys):
    with patch("sys.argv", ["cli.py", "--campaign", "confirmation"]):
        main()
        captured = capsys.readouterr()
        assert "CONFIRMATION" in captured.out
        assert "Execution Result:" in captured.out
        assert "Audit Ledger Integrity Verified: True" in captured.out


def test_cli_noshow_dry_run(capsys):
    with patch("sys.argv", ["cli.py", "--campaign", "no_show"]):
        main()
        captured = capsys.readouterr()
        assert "NO_SHOW" in captured.out
        assert "wants_rebook" in captured.out


def test_cli_prior_auth_dry_run(capsys):
    with patch("sys.argv", ["cli.py", "--campaign", "prior_auth"]):
        main()
        captured = capsys.readouterr()
        assert "PRIOR_AUTH" in captured.out
        assert "AUTH-882194" in captured.out


def test_cli_custom_phone(capsys):
    with patch("sys.argv", ["cli.py", "--campaign", "confirmation", "--phone", "+15550192834"]):
        main()
        captured = capsys.readouterr()
        assert "+1555***2834" in captured.out


def test_cli_app_entrypoint_matches_server():
    from app import app
    assert app.title == "Bytelytic Clinic OS — Autonomous Healthcare Phone Desk"


def test_client_entrypoint_matches_adapter():
    from client import CalleHealthcareClient
    client = CalleHealthcareClient()
    res = client.dispatch_confirmation_call("+15550192834")
    assert res["status"] == "completed"


def test_cli_recall_dry_run(capsys):
    with patch("sys.argv", ["cli.py", "--campaign", "recall"]):
        main()
        captured = capsys.readouterr()
        assert "RECALL" in captured.out
        assert "interested" in captured.out


def test_cli_survey_dry_run(capsys):
    with patch("sys.argv", ["cli.py", "--campaign", "survey"]):
        main()
        captured = capsys.readouterr()
        assert "SURVEY" in captured.out
        assert "nps_score" in captured.out


def test_cli_list_audit(capsys):
    with patch("sys.argv", ["cli.py", "--list-audit"]):
        main()
        captured = capsys.readouterr()
        assert "=== Audit Ledger ===" in captured.out
        assert "Integrity Verified:" in captured.out


def test_cli_live_mode_blocks_unauthorized():
    with patch("sys.argv", ["cli.py", "--campaign", "confirmation", "--phone", "+15559998888", "--live"]):
        with pytest.raises(PermissionError):
            main()

