import json
import socket
import sqlite3
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import outcomes
import receiver

CASES = ["booked", "declined", "callback", "unanswered", "unknown"]


def test_all_outcomes_replay_offline_and_keep_delivery_separate(
    tmp_path, monkeypatch, capsys
):
    def no_network(*args, **kwargs):
        pytest.fail("offline examples must not access the network")

    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "getaddrinfo", no_network)
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    schema = json.loads((APP / "outcome-schema.json").read_text())
    assert schema["properties"]["outcome"]["enum"] == CASES
    database = tmp_path / "outcomes.sqlite3"
    for case in CASES:
        path = APP / "fixtures" / f"call-{case}.json"
        event = json.loads(path.read_text())
        result = event["data"]["structured_result"]
        if result is not None:
            assert set(result) == set(schema["required"])
            assert all(isinstance(value, str) for value in result.values())
        for duplicate in (False, True):
            assert (
                receiver.main(
                    ["--database", str(database), "--replay", str(path)],
                    client_factory=no_network,
                )
                == 0
            )
            assert json.loads(capsys.readouterr().out) == {
                "received": True,
                "duplicate": duplicate,
            }
        assert outcomes.main([str(path)]) == 0
        decision = json.loads(capsys.readouterr().out)
        assert decision["outcome"] == case
        assert decision["next_action"] == outcomes.ACTIONS[case]
    with sqlite3.connect(database) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM events WHERE verification_mode = 'fixture'"
            ).fetchone()[0]
            == 5
        )


def test_missing_or_invalid_evidence_never_becomes_a_business_answer():
    valid = {"outcome": "booked", "outcome_evidence": "Synthetic confirmation."}
    for status in ("queued", "in_progress", "failed", "canceled"):
        assert (
            outcomes.application_outcome({"status": status, "structured_result": valid})
            == "unknown"
        )
    for result in (
        None,
        {},
        [],
        "booked",
        {"outcome": "booked"},
        {**valid, "outcome": []},
        {**valid, "outcome": "not_an_outcome"},
        {**valid, "outcome_evidence": None},
        {**valid, "outcome_evidence": " "},
        {**valid, "unexpected": True},
        {**valid, "outcome": "unknown"},
    ):
        assert (
            outcomes.application_outcome(
                {"status": "completed", "structured_result": result}
            )
            == "unknown"
        )
    for name in ("call-failed.json", "call-result-validation-failed.json"):
        call = json.loads((APP / "fixtures" / name).read_text())["data"]
        assert outcomes.application_outcome(call) == "unknown"


def test_invalid_fixture_has_no_decision(tmp_path, capsys):
    path = tmp_path / "invalid.json"
    valid = json.loads((APP / "fixtures/call-booked.json").read_text())
    for value in (None, {}, {**valid, "data": {**valid["data"], "status": "failed"}}):
        path.write_text(json.dumps(value))
        assert outcomes.main([str(path)]) == 1
        assert json.loads(capsys.readouterr().out) == {"error": "invalid_fixture"}
