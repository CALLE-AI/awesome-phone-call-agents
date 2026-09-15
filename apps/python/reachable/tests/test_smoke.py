"""Phase 0 smoke test: the app builds and reports its mode, with no network."""

from __future__ import annotations

from fastapi.testclient import TestClient

from reachable.cli import build_parser, main
from reachable.config import Config
from reachable.web.app import create_app


def test_app_starts_in_dry_run_by_default():
    client = TestClient(create_app(Config.from_env({})))
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "mode": "DRY-RUN"}


def test_cli_exposes_the_documented_commands():
    parser = build_parser()
    actions = [a for a in parser._actions if getattr(a, "choices", None)]
    commands = set(actions[0].choices)
    assert {"config", "serve"} <= commands


def test_config_command_runs_and_hides_secrets(capsys):
    assert main(["config"]) == 0
    out = capsys.readouterr().out
    assert "REACHABLE_LIVE_CALLS is not set" in out
    assert "unset" in out
