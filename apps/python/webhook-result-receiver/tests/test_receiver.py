from __future__ import annotations

import copy
import hashlib
import http.client
import io
import json
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import pytest


APP_DIR = Path(__file__).parents[1]
FIXTURES = APP_DIR / "fixtures"
sys.path.insert(0, str(APP_DIR))
import receiver  # noqa: E402


def fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def fetch_snapshot(event: dict[str, object]) -> dict[str, object]:
    return copy.deepcopy(event["data"])


class Fetcher:
    def __init__(self, snapshot: dict[str, object]):
        self.snapshot = snapshot
        self.call_ids: list[str] = []

    def __call__(self, call_id: str) -> dict[str, object]:
        self.call_ids.append(call_id)
        return copy.deepcopy(self.snapshot)


@contextmanager
def running_server(tmp_path: Path, fetcher):
    database = tmp_path / "nested" / "events.sqlite3"
    server = receiver.create_server(
        host="127.0.0.1",
        port=0,
        database_path=database,
        call_fetcher=fetcher,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, database
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def request(
    server,
    *,
    method: str = "POST",
    path: str = "/calle/webhook",
    body: bytes = b"",
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, object], dict[str, str], bytes]:
    connection = http.client.HTTPConnection(
        "127.0.0.1", server.server_port, timeout=5
    )
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    raw = response.read()
    result_headers = {key: value for key, value in response.getheaders()}
    connection.close()
    return response.status, json.loads(raw), result_headers, raw


def post_event(
    server,
    event: dict[str, object],
    *,
    event_id: str | None = None,
    rendered: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, object], dict[str, str], bytes]:
    body = (
        json.dumps(event, ensure_ascii=False).encode("utf-8")
        if rendered is None
        else rendered
    )
    return request(
        server,
        body=body,
        headers={
            "Content-Type": "application/json",
            "CALL-E-Event-Id": event_id or str(event["id"]),
            **(headers or {}),
        },
    )


def rows(database: Path) -> list[sqlite3.Row]:
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute("SELECT * FROM events ORDER BY event_id").fetchall()
    finally:
        connection.close()


@pytest.mark.parametrize(
    ("fixture_name", "expected_status", "expected_result"),
    [
        ("call-completed.json", "completed", "yes"),
        ("call-failed.json", "failed", None),
        ("call-result-validation-failed.json", "completed", None),
    ],
)
def test_all_terminal_events_commit_only_minimal_authoritative_values(
    tmp_path, fixture_name, expected_status, expected_result
):
    event = fixture(fixture_name)
    authoritative = fetch_snapshot(event)
    authoritative["summary"] = "authoritative secret summary"
    fetcher = Fetcher(authoritative)

    with running_server(tmp_path, fetcher) as (server, database):
        status, payload, _, raw = post_event(server, event)

    assert status == 200
    assert payload == {"received": True, "duplicate": False}
    assert fetcher.call_ids == [event["data"]["id"]]
    stored = dict(rows(database)[0])
    canonical = json.dumps(
        event, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    assert stored == {
        "event_id": event["id"],
        "payload_digest": hashlib.sha256(canonical).hexdigest(),
        "event_type": event["type"],
        "call_id": authoritative["id"],
        "call_status": expected_status,
        "workflow_id": authoritative["metadata"]["workflow_id"],
        "wants_human_callback": expected_result,
        "verification_mode": "api",
        "received_at": stored["received_at"],
    }
    assert stored["received_at"].endswith("+00:00")
    assert b"authoritative secret summary" not in database.read_bytes()
    assert b"authoritative secret summary" not in raw


def test_schema_contains_exactly_the_allowed_durable_fields(tmp_path):
    event = fixture("call-completed.json")
    with running_server(tmp_path, Fetcher(fetch_snapshot(event))) as (_, database):
        pass

    connection = sqlite3.connect(database)
    try:
        columns = connection.execute("PRAGMA table_info(events)").fetchall()
        tables = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    finally:
        connection.close()

    assert [column[1] for column in columns] == [
        "event_id",
        "payload_digest",
        "event_type",
        "call_id",
        "call_status",
        "workflow_id",
        "wants_human_callback",
        "verification_mode",
        "received_at",
    ]
    assert tables == [("events",)]


def test_route_method_content_type_and_length_contract(tmp_path):
    event = fixture("call-completed.json")
    fetcher = Fetcher(fetch_snapshot(event))
    with running_server(tmp_path, fetcher) as (server, database):
        status, payload, _, _ = request(server, method="POST", path="/wrong")
        assert (status, payload) == (404, {"error": "not_found"})

        status, payload, headers, _ = request(
            server, method="GET", path="/calle/webhook"
        )
        assert (status, payload) == (405, {"error": "method_not_allowed"})
        assert headers["Allow"] == "POST"

        body = json.dumps(event).encode()
        status, payload, _, _ = request(
            server,
            body=body,
            headers={"CALL-E-Event-Id": str(event["id"])},
        )
        assert (status, payload) == (400, {"error": "invalid_content_type"})

        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_port, timeout=5
        )
        connection.putrequest("POST", "/calle/webhook")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("CALL-E-Event-Id", str(event["id"]))
        connection.endheaders()
        response = connection.getresponse()
        assert response.status == 400
        assert json.loads(response.read()) == {"error": "invalid_content_length"}
        connection.close()

        for invalid in ("not-a-number", "-1"):
            connection = http.client.HTTPConnection(
                "127.0.0.1", server.server_port, timeout=5
            )
            connection.putrequest("POST", "/calle/webhook")
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", invalid)
            connection.putheader("CALL-E-Event-Id", str(event["id"]))
            connection.endheaders()
            response = connection.getresponse()
            assert response.status == 400
            assert json.loads(response.read()) == {
                "error": "invalid_content_length"
            }
            connection.close()

    assert fetcher.call_ids == []
    assert rows(database) == []


@pytest.mark.parametrize(
    ("body", "event_header", "error"),
    [
        (b"not-json", "evt", "invalid_json"),
        (b"[]", "evt", "invalid_event"),
        (
            json.dumps(
                {
                    "id": "evt",
                    "type": "call.completed",
                    "created_at": "now",
                    "data": {},
                }
            ).encode(),
            "evt",
            "invalid_event",
        ),
        (
            json.dumps(
                {
                    "id": "evt",
                    "type": "call.completed",
                    "created_at": "now",
                    "data": {"id": "call"},
                }
            ).encode(),
            "different",
            "event_id_mismatch",
        ),
        (
            json.dumps(
                {
                    "id": "evt",
                    "type": "call.started",
                    "created_at": "now",
                    "data": {"id": "call"},
                }
            ).encode(),
            "evt",
            "unsupported_event_type",
        ),
    ],
)
def test_malformed_and_untrusted_inputs_are_rejected_before_fetch(
    tmp_path, body, event_header, error
):
    fetcher = Fetcher({})
    with running_server(tmp_path, fetcher) as (server, database):
        status, payload, _, _ = request(
            server,
            body=body,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "CALL-E-Event-Id": event_header,
            },
        )

    assert (status, payload) == (400, {"error": error})
    assert fetcher.call_ids == []
    assert rows(database) == []


def test_one_mib_body_is_accepted_and_larger_body_is_rejected_before_read(
    tmp_path,
):
    event = fixture("call-completed.json")
    fetcher = Fetcher(fetch_snapshot(event))
    compact = json.dumps(event, separators=(",", ":")).encode()
    boundary = compact + b" " * (receiver.MAX_BODY_BYTES - len(compact))
    assert len(boundary) == 1_048_576

    with running_server(tmp_path, fetcher) as (server, database):
        status, payload, _, _ = post_event(server, event, rendered=boundary)
        assert (status, payload) == (
            200,
            {"received": True, "duplicate": False},
        )

        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_port, timeout=5
        )
        connection.putrequest("POST", "/calle/webhook")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Content-Length", receiver.MAX_BODY_BYTES + 1)
        connection.putheader("CALL-E-Event-Id", "evt_oversize")
        connection.endheaders()
        response = connection.getresponse()
        assert response.status == 413
        assert json.loads(response.read()) == {"error": "payload_too_large"}
        connection.close()

    assert fetcher.call_ids == [event["data"]["id"]]
    assert len(rows(database)) == 1


def test_canonical_dedupe_skips_refetch_and_conflicting_id_returns_409(tmp_path):
    event = fixture("call-completed.json")
    fetcher = Fetcher(fetch_snapshot(event))
    with running_server(tmp_path, fetcher) as (server, database):
        first = post_event(server, event)
        reordered = json.dumps(
            {key: event[key] for key in reversed(list(event))},
            ensure_ascii=False,
            indent=4,
        ).encode()
        duplicate = post_event(server, event, rendered=reordered)

        conflict = copy.deepcopy(event)
        conflict["data"]["summary"] = "different secret payload"
        conflicting = post_event(server, conflict)

    assert first[:2] == (200, {"received": True, "duplicate": False})
    assert duplicate[:2] == (200, {"received": True, "duplicate": True})
    assert conflicting[:2] == (409, {"error": "event_id_conflict"})
    assert fetcher.call_ids == [event["data"]["id"]]
    assert len(rows(database)) == 1


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (receiver.CalleConnectionError("secret connection"), 503, "upstream_unavailable"),
        (receiver.CalleTimeoutError("secret timeout"), 503, "upstream_unavailable"),
        (
            receiver.CalleRateLimitError(
                code="rate", message="secret rate limit", status_code=429
            ),
            503,
            "upstream_unavailable",
        ),
        (
            receiver.CalleAPIError(
                code="upstream", message="secret api failure", status_code=500
            ),
            503,
            "upstream_unavailable",
        ),
        (
            receiver.CalleAuthenticationError(
                code="auth", message="secret auth failure", status_code=401
            ),
            500,
            "internal_error",
        ),
        (
            receiver.CalleAPIError(
                code="not_found", message="secret rejection", status_code=404
            ),
            409,
            "authoritative_rejected",
        ),
        (RuntimeError("secret unexpected error"), 500, "internal_error"),
    ],
)
def test_fetch_error_policy_is_stable_private_and_never_inserts(
    tmp_path, error, expected_status, expected_code
):
    event = fixture("call-completed.json")

    def fail(_call_id):
        raise error

    with running_server(tmp_path, fail) as (server, database):
        status, payload, _, raw = post_event(server, event)

    assert (status, payload) == (expected_status, {"error": expected_code})
    assert str(error).encode() not in raw
    assert rows(database) == []


def test_transient_failure_can_be_retried_and_committed(tmp_path):
    event = fixture("call-completed.json")
    calls = 0

    def flaky(call_id):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise receiver.CalleTimeoutError("private timeout detail")
        assert call_id == event["data"]["id"]
        return fetch_snapshot(event)

    with running_server(tmp_path, flaky) as (server, database):
        failed = post_event(server, event)
        succeeded = post_event(server, event)

    assert failed[:2] == (503, {"error": "upstream_unavailable"})
    assert succeeded[:2] == (200, {"received": True, "duplicate": False})
    assert calls == 2
    assert len(rows(database)) == 1


@pytest.mark.parametrize(
    "mutate",
    [
        lambda snapshot: snapshot.update(id="different_call"),
        lambda snapshot: snapshot.update(status="failed"),
        lambda snapshot: snapshot.update(metadata={"workflow": "other", "workflow_id": "workflow_fixture_completed"}),
        lambda snapshot: snapshot.update(metadata={"workflow": "webhook-result-receiver", "workflow_id": ""}),
        lambda snapshot: snapshot["metadata"].update(workflow_id="different_workflow"),
    ],
)
def test_authoritative_call_id_status_and_workflow_must_match(tmp_path, mutate):
    event = fixture("call-completed.json")
    authoritative = fetch_snapshot(event)
    mutate(authoritative)
    with running_server(tmp_path, Fetcher(authoritative)) as (server, database):
        status, payload, _, _ = post_event(server, event)

    assert (status, payload) == (409, {"error": "authoritative_mismatch"})
    assert rows(database) == []


@pytest.mark.parametrize("status", ["failed", "canceled"])
def test_failed_event_accepts_only_failed_or_canceled_authoritative_status(
    tmp_path, status
):
    event = fixture("call-failed.json")
    authoritative = fetch_snapshot(event)
    authoritative["status"] = status
    with running_server(tmp_path, Fetcher(authoritative)) as (server, database):
        response = post_event(server, event)

    assert response[:2] == (200, {"received": True, "duplicate": False})
    assert rows(database)[0]["call_status"] == status


@pytest.mark.parametrize(
    ("structured_result", "stored"),
    [
        (None, None),
        ({"wants_human_callback": "yes"}, "yes"),
        ({"wants_human_callback": "no"}, "no"),
        ({"wants_human_callback": "unknown"}, "unknown"),
        ({"wants_human_callback": "YES"}, None),
        ({"wants_human_callback": 1}, None),
        ("free-form private result", None),
    ],
)
def test_structured_result_is_nullable_and_only_enum_value_is_normalized(
    tmp_path, structured_result, stored
):
    event = fixture("call-completed.json")
    authoritative = fetch_snapshot(event)
    authoritative["structured_result"] = structured_result
    with running_server(tmp_path, Fetcher(authoritative)) as (server, database):
        response = post_event(server, event)

    assert response[:2] == (200, {"received": True, "duplicate": False})
    assert rows(database)[0]["wants_human_callback"] == stored


def test_concurrent_first_delivery_creates_one_row(tmp_path):
    event = fixture("call-completed.json")
    barrier = threading.Barrier(2)

    def synchronized_fetch(call_id):
        assert call_id == event["data"]["id"]
        barrier.wait(timeout=5)
        return fetch_snapshot(event)

    with running_server(tmp_path, synchronized_fetch) as (server, database):
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(post_event, server, event) for _ in range(2)]
            responses = [future.result(timeout=10) for future in futures]

    assert sorted((response[0], response[1]["duplicate"]) for response in responses) == [
        (200, False),
        (200, True),
    ]
    assert len(rows(database)) == 1


def test_private_fixture_values_never_appear_in_database_response_or_logs(
    tmp_path, caplog
):
    event = fixture("call-completed.json")
    private_values = [
        "+12025550123",
        event["data"]["task"],
        event["data"]["summary"],
        event["data"]["evidence"][0],
        event["data"]["transcript"][0]["text"],
        event["data"]["structured_result"]["free_form_note"],
    ]

    with running_server(tmp_path, Fetcher(fetch_snapshot(event))) as (
        server,
        database,
    ):
        _, _, _, raw = post_event(server, event)

    durable = database.read_bytes()
    logs = caplog.text.encode()
    for value in private_values:
        encoded = value.encode()
        assert encoded not in durable
        assert encoded not in raw
        assert encoded not in logs


class ForbiddenEnvironment:
    def get(self, key: str, default=None):
        raise AssertionError(f"replay read credential {key}")


def test_replay_uses_fixture_snapshot_without_credentials_client_or_network(tmp_path):
    output = io.StringIO()
    database = tmp_path / "replay.sqlite3"
    fixture_path = FIXTURES / "call-completed.json"

    with redirect_stdout(output), redirect_stderr(io.StringIO()):
        exit_code = receiver.main(
            ["--database", str(database), "--replay", str(fixture_path)],
            environ=ForbiddenEnvironment(),
            client_factory=lambda **kwargs: pytest.fail("replay constructed client"),
        )

    assert exit_code == 0
    assert json.loads(output.getvalue()) == {"received": True, "duplicate": False}
    stored = rows(database)[0]
    assert stored["verification_mode"] == "fixture"
    assert stored["wants_human_callback"] == "yes"


def test_serve_mode_requires_key_and_closes_client_and_server(tmp_path):
    with redirect_stderr(io.StringIO()) as error:
        assert receiver.main([], environ={}) == 2
    assert "CALLE_API_KEY" in error.getvalue()

    class FakeServer:
        def __init__(self):
            self.served = False
            self.closed = False

        def serve_forever(self):
            self.served = True

        def server_close(self):
            self.closed = True

    class FakeClient:
        def __init__(self):
            self.closed = False

            class Calls:
                @staticmethod
                def get(call_id):
                    raise AssertionError("server test fetched a call")

            self.calls = Calls()

        def close(self):
            self.closed = True

    fake_server = FakeServer()
    fake_client = FakeClient()
    with patch.object(receiver, "create_server", return_value=fake_server) as create:
        assert receiver.main(
            ["--host", "127.0.0.1", "--port", "9090", "--database", str(tmp_path / "db.sqlite3")],
            environ={"CALLE_API_KEY": "test-key"},
            client_factory=lambda *, api_key: fake_client,
        ) == 0

    assert fake_server.served and fake_server.closed and fake_client.closed
    create.assert_called_once_with(
        host="127.0.0.1",
        port=9090,
        database_path=tmp_path / "db.sqlite3",
        call_fetcher=fake_client.calls.get,
    )
