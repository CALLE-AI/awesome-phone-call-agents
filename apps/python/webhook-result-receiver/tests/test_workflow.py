import copy
import json
import socket
import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import workflow


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("workflow tests must not access the network")

    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.delenv("CALLE_API_KEY", raising=False)


def reserve(tmp_path, workflow_id="workflow_test", **overrides):
    now = datetime.now(UTC)
    values = {
        "phone": "+12025550123",
        "task": "Synthetic authorized follow-up.",
        "not_before": (now - timedelta(minutes=1)).isoformat(),
        "not_after": (now + timedelta(minutes=10)).isoformat(),
    }
    values.update(overrides)
    database = tmp_path / "workflows.sqlite3"
    workflow.reserve(database, workflow_id, **values)
    return database


def row(database, workflow_id="workflow_test"):
    with workflow.connect(database) as connection:
        return workflow.load(connection, workflow_id)


def snapshot(outcome="callback"):
    return {
        "id": "call_test",
        "status": "completed",
        "metadata": {
            "workflow": "webhook-result-receiver",
            "workflow_id": "workflow_test",
        },
        "recipients": [{"phones": ["+12025550123"]}],
        "structured_result": {
            "outcome": outcome,
            "outcome_evidence": "Synthetic evidence.",
        },
    }


def test_lost_response_survives_restart_and_replays_one_immutable_request(tmp_path):
    database = reserve(tmp_path)
    saved = row(database)["request_json"]
    requests = []

    def create(**request):
        assert row(database)["state"] == "submission_unknown"
        assert request == json.loads(saved)
        requests.append(request)
        if len(requests) == 1:
            raise workflow.CalleTimeoutError("response lost after acceptance")
        return {"id": "call_test", "status": "in_progress"}

    client = SimpleNamespace(
        calls=SimpleNamespace(create=create, get=lambda _: snapshot())
    )
    with pytest.raises(workflow.CalleTimeoutError):
        workflow.submit(database, "workflow_test", client)
    with pytest.raises(ValueError):
        workflow.resume(database, "workflow_test", client)
    with pytest.raises(ValueError):
        workflow.submit(database, "workflow_test", client)
    assert len(requests) == 1
    workflow.submit(database, "workflow_test", client, recover_unknown=True)
    workflow.submit(database, "workflow_test", client)
    first = workflow.resume(database, "workflow_test", client)
    second = workflow.resume(database, "workflow_test", client)
    assert len(requests) == 2 and requests[0] == requests[1]
    assert first == second and first["business_state"] == "needs_follow_up"
    assert first["applied_at"] and first["request_json"] == saved
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        reserve(tmp_path, task="Changed intent cannot replace the saved workflow.")
    assert row(database) == first


@pytest.mark.parametrize(
    "case", ["booked", "declined", "callback", "unanswered", "unknown"]
)
def test_existing_outcome_fixtures_apply_once_to_application_record(tmp_path, case):
    database = reserve(tmp_path)
    value = json.loads((APP / "fixtures" / f"call-{case}.json").read_text())["data"]
    value.update(
        id="call_test",
        metadata=snapshot()["metadata"],
        recipients=snapshot()["recipients"],
    )
    calls = SimpleNamespace(
        create=lambda **_: {"id": "call_test", "status": "queued"}, get=lambda _: value
    )
    client = SimpleNamespace(calls=calls)
    workflow.submit(database, "workflow_test", client)
    first = workflow.resume(database, "workflow_test", client)
    assert first["outcome"] == case
    assert first["business_state"] == workflow.BUSINESS_STATES[case]
    assert workflow.resume(database, "workflow_test", client) == first


def test_unbound_or_unready_results_do_not_update_business_state(tmp_path):
    database = reserve(tmp_path)
    calls = SimpleNamespace(create=lambda **_: {"id": "call_test", "status": "queued"})
    client = SimpleNamespace(calls=calls)
    workflow.submit(database, "workflow_test", client)
    for change in (
        {"id": "other"},
        {"metadata": {}},
        {"recipients": []},
        {"recipients": [{"phones": ["+12025550124"]}]},
        {"status": "surprise"},
    ):
        value = {**snapshot(), **change}
        calls.get = lambda _, value=value: value
        with pytest.raises(ValueError):
            workflow.resume(database, "workflow_test", client)
        assert row(database)["business_state"] == "pending"
    calls.get = lambda _: {**snapshot(), "status": "in_progress"}
    assert workflow.resume(database, "workflow_test", client)["state"] == "accepted"
    calls.get = lambda _: {**snapshot(), "structured_result": None}
    assert (
        workflow.resume(database, "workflow_test", client)["business_state"]
        == "needs_review"
    )


def test_failed_write_can_be_resumed_without_resubmitting_call(tmp_path):
    database = reserve(tmp_path)
    client = SimpleNamespace(
        calls=SimpleNamespace(
            create=lambda **_: {"id": "call_test", "status": "queued"},
            get=lambda _: snapshot(),
        )
    )
    workflow.submit(database, "workflow_test", client)
    with workflow.connect(database) as connection:
        connection.execute(
            "CREATE TRIGGER fail_apply BEFORE UPDATE OF outcome ON workflows "
            "BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="simulated write failure"):
        workflow.resume(database, "workflow_test", client)
    assert row(database)["state"] == "accepted" and row(database)["applied_at"] is None
    with workflow.connect(database) as connection:
        connection.execute("DROP TRIGGER fail_apply")
    client.calls.create = lambda **_: pytest.fail(
        "recovery must not resubmit a known call"
    )
    assert workflow.resume(database, "workflow_test", client)["state"] == "applied"


def test_window_cancel_and_cli_preview_never_create_calls(tmp_path, capsys):
    future = datetime.now(UTC) + timedelta(hours=1)
    database = reserve(
        tmp_path,
        not_before=future.isoformat(),
        not_after=(future + timedelta(hours=1)).isoformat(),
    )
    client = SimpleNamespace(
        calls=SimpleNamespace(create=lambda **_: pytest.fail("unexpected call"))
    )
    with pytest.raises(ValueError):
        workflow.submit(database, "workflow_test", client)
    before = copy.deepcopy(row(database))
    assert (
        workflow.main(
            ["submit", "--database", str(database), "--workflow-id", "workflow_test"]
        )
        == 0
    )
    output = json.loads(capsys.readouterr().out)
    assert output["preview"] and "+12025550123" not in json.dumps(output)
    assert row(database) == before
    assert workflow.cancel(database, "workflow_test")["state"] == "canceled"
    with pytest.raises(ValueError):
        workflow.submit(database, "workflow_test", client)
    with pytest.raises(ValueError):
        workflow.timestamp("2026-09-21T12:00:00")


def test_acknowledged_webhook_can_resume_a_missing_business_update(tmp_path):
    import receiver

    database = reserve(tmp_path)
    value = snapshot()
    client = SimpleNamespace(
        calls=SimpleNamespace(
            create=lambda **_: {"id": "call_test", "status": "queued"},
            get=lambda _: value,
        )
    )
    workflow.submit(database, "workflow_test", client)
    event = {
        "id": "evt_test",
        "type": "call.completed",
        "created_at": "2026-09-21T00:00:00Z",
        "data": value,
    }
    store = receiver.EventStore(tmp_path / "receipts.sqlite3")
    for duplicate in (False, True):
        status, receipt = receiver.process_event(
            store, event, "evt_test", call_fetcher=client.calls.get
        )
        assert status == 200 and receipt["duplicate"] is duplicate
        # The host can restart after acknowledging delivery but before updating its DB.
        assert row(database)["business_state"] == "pending"
    first = workflow.resume(database, "workflow_test", client)
    assert first["business_state"] == "needs_follow_up"
    assert workflow.resume(database, "workflow_test", client) == first
