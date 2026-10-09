import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import callback  # noqa: E402


def test_place_callback_raises_without_api_key(monkeypatch):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="CALLE_API_KEY"):
        callback.place_callback("Call back and confirm.", "+15550001111")


def test_place_callback_uses_calle_sdk():
    fake_client = MagicMock()
    fake_client.calls.create_and_wait.return_value = {"status": "completed", "task_completed": True}

    with patch("calle.CalleClient", return_value=fake_client) as mock_cls:
        result = callback.place_callback("Call back and confirm.", "+15550001111", api_key="test-key")

    mock_cls.assert_called_once_with(api_key="test-key")
    fake_client.calls.create_and_wait.assert_called_once_with(
        task="Call back and confirm.", recipient={"phone": "+15550001111"}
    )
    fake_client.close.assert_called_once()
    assert result["status"] == "completed"


def test_demo_result_shape():
    result = callback._demo_result("Call back and confirm.", "+15550001111")
    assert result["status"] == "completed"
    assert "DEMO MODE" in result["note"]


def test_cli_demo_mode_needs_no_credentials(monkeypatch, tmp_path):
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).parent.parent / "callback.py"), "--demo", "delivery"],
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert proc.returncode == 0
    payload = json.loads(proc.stdout)
    assert payload["status"] == "completed"
    assert "DEMO MODE" in payload["note"]


def test_cli_live_without_confirm_is_refused():
    proc = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).parent.parent / "callback.py"),
            "--live",
            "--task",
            "Call back and confirm.",
            "--to-phone",
            "+15550001111",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode != 0
    assert "--confirm" in proc.stderr
