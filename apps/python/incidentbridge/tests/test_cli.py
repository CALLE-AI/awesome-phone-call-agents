import json
from pathlib import Path

import calle

from incidentbridge.cli import main
from tests.test_policy import RAW
from tests.test_runtime import FakeCalls, completed_response


def request_file(tmp_path: Path) -> Path:
    path = tmp_path / "request.json"
    path.write_text(json.dumps(RAW), encoding="utf-8")
    return path


def test_cli_preview_and_simulation(tmp_path, capsys):
    path = request_file(tmp_path)
    assert main(["--request", str(path)]) == 0
    preview = json.loads(capsys.readouterr().out)
    assert preview["mode"] == "preview"

    assert main(["--request", str(path), "--simulate", "acknowledged"]) == 0
    simulation = json.loads(capsys.readouterr().out)
    assert simulation["decision"]["route"] == "vendor_acknowledged"


def test_cli_live_guards(tmp_path, capsys, monkeypatch):
    path = request_file(tmp_path)
    monkeypatch.delenv("CALLE_LIVE_CALLS_ENABLED", raising=False)
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    assert main(["--request", str(path), "--execute"]) == 2
    assert "confirm-authorized-recipient" in capsys.readouterr().err

    assert (
        main(
            [
                "--request",
                str(path),
                "--execute",
                "--confirm-authorized-recipient",
            ]
        )
        == 2
    )
    assert "exact support phone" in capsys.readouterr().err


def test_cli_output_is_exclusive(tmp_path, capsys):
    path = request_file(tmp_path)
    output = tmp_path / "result.json"
    assert main(["--request", str(path), "--output", str(output)]) == 0
    assert output.exists()
    assert main(["--request", str(path), "--output", str(output)]) == 2
    assert "File exists" in capsys.readouterr().err


def test_cli_live_success_and_duplicate_lock(tmp_path, capsys, monkeypatch):
    class FakeClient:
        def __init__(self, *, api_key, base_url):
            assert api_key == "calle_test_key"
            assert base_url == "http://127.0.0.1:8123"
            self.calls = FakeCalls(completed_response())

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

    monkeypatch.setattr(calle, "CalleClient", FakeClient)
    monkeypatch.setenv("CALLE_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("CALLE_API_KEY", "calle_test_key")
    path = request_file(tmp_path)
    database = tmp_path / "ledger.sqlite3"
    args = [
        "--request",
        str(path),
        "--execute",
        "--confirm-authorized-recipient",
        "--allow",
        RAW["support_phone"],
        "--base-url",
        "http://127.0.0.1:8123",
        "--timeout-seconds",
        "5",
        "--database",
        str(database),
    ]

    assert main(args) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["decision"]["route"] == "vendor_acknowledged"

    assert main(args) == 2
    assert "call already reserved" in capsys.readouterr().err


def test_cli_live_environment_guards(tmp_path, capsys, monkeypatch):
    path = request_file(tmp_path)
    base = [
        "--request",
        str(path),
        "--execute",
        "--confirm-authorized-recipient",
        "--allow",
        RAW["support_phone"],
    ]
    monkeypatch.delenv("CALLE_LIVE_CALLS_ENABLED", raising=False)
    assert main(base) == 2
    assert "CALLE_LIVE_CALLS_ENABLED" in capsys.readouterr().err

    monkeypatch.setenv("CALLE_LIVE_CALLS_ENABLED", "true")
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    assert main(base) == 2
    assert "CALLE_API_KEY" in capsys.readouterr().err

    monkeypatch.setenv("CALLE_API_KEY", "test")
    assert main([*base, "--timeout-seconds", "0"]) == 2
    assert "must be positive" in capsys.readouterr().err
