"""Tests for the read-only API surface (api/).

Everything here runs against a server on a random loopback port, driven
with urllib from the standard library - the same shape as the rest of
this suite. No test reaches a provider, and in this phase the server has
no code path that could: it cannot start a resolution and imports no
CALL-E client.
"""

from __future__ import annotations

import http.client
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

from api.serialize import case_metadata
from api.store import CaseNotFoundError, CaseStore
from evidence.model import load_case

HERE = Path(__file__).resolve().parent.parent
LIVE_FIXTURE = "ghost-appointment-live-test"


@contextmanager
def api_server_and_backend() -> Iterator[tuple[str, Any]]:
    """The HTTP server and the fake CALL-E backend, started and stopped
    separately - the same split create_server() enforces in production
    code, so a test cannot accidentally depend on one starting the other.
    """
    from api.backend import FakeCallBackend
    from api.server import create_server

    backend = FakeCallBackend()
    backend.start()
    server = create_server("127.0.0.1", 0, backend=backend)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    try:
        yield f"http://{host}:{port}", backend
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        backend.stop()


@contextmanager
def api_server() -> Iterator[str]:
    with api_server_and_backend() as (base_url, _):
        yield base_url


def post(base_url: str, path: str, payload: Any) -> tuple[int, Any, dict[str, str]]:
    data = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}{path}", data=data, method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.loads(response.read()), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read()), dict(exc.headers)


def request(base_url: str, path: str, method: str = "GET") -> tuple[int, Any, dict[str, str]]:
    req = urllib.request.Request(f"{base_url}{path}", method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read()), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read()), dict(exc.headers)


def walk_strings(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        for key, inner in value.items():
            yield str(key)
            yield from walk_strings(inner)
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)
    elif isinstance(value, str):
        yield value


# --- A. health -------------------------------------------------------


def test_health_returns_ok_and_nothing_else() -> None:
    with api_server() as base_url:
        status, body, headers = request(base_url, "/api/health")

        assert status == 200
        assert headers["Content-Type"] == "application/json"
        assert int(headers["Content-Length"]) > 0
        assert body["status"] == "ok"
        assert body["mode"] == "fake"
        assert body["engine_version"]
        # A health endpoint is where configuration classically leaks.
        assert set(body) == {"status", "mode", "engine_version"}


# --- B. cases --------------------------------------------------------


def test_cases_lists_both_shipped_cases_with_masked_numbers() -> None:
    with api_server() as base_url:
        status, body, _ = request(base_url, "/api/cases")

        assert status == 200
        names = [case["name"] for case in body["cases"]]
        assert "critical-service-escalation" in names
        assert "ghost-appointment" in names

        for case in body["cases"]:
            assert case["call_phone_masked"].startswith("+...")
            assert case["use_case"]
            assert case["deadline"].endswith("Z")
            assert case["decision_options"]
            assert case["evidence"]
            assert "call_phone" not in case
            assert "call_task_hint" not in case


def test_no_clear_phone_number_appears_anywhere_in_the_cases_response() -> None:
    """Checked against the real numbers read off disk, not a pattern:
    a regex could pass simply by being wrong.
    """
    real_numbers = {
        load_case(HERE / "cases" / f"{name}.json").call_phone
        for name in ("critical-service-escalation", "ghost-appointment")
    }
    with api_server() as base_url:
        _, body, _ = request(base_url, "/api/cases")

        raw = json.dumps(body)
        for number in real_numbers:
            assert number not in raw, "a case file's call_phone reached the client in the clear"
        assert not re.search(r"\+\d{7,15}", raw), "an unmasked E.164 number reached the client"


# --- C. the untracked live fixture -----------------------------------


def test_local_live_fixture_is_never_served_even_when_present_on_disk() -> None:
    """cases/ doubles as the operator's scratch directory for real-call
    testing, so exposure is opt-in by name. This is the test that would
    fail if the store ever started globbing the directory.
    """
    store = CaseStore()
    assert LIVE_FIXTURE not in store.names()
    with pytest.raises(CaseNotFoundError):
        store.get(LIVE_FIXTURE)

    with api_server() as base_url:
        _, body, _ = request(base_url, "/api/cases")
        assert LIVE_FIXTURE not in [case["name"] for case in body["cases"]]


def test_store_refuses_a_name_outside_the_allowlist(tmp_path: Path) -> None:
    """Including anything shaped like a traversal: the name is matched
    against a fixed tuple before it is ever used to build a path.
    """
    store = CaseStore()
    for name in ("../client", "../../README", "does-not-exist", ""):
        with pytest.raises(CaseNotFoundError):
            store.get(name)


# --- D/E/F. routing and methods --------------------------------------


def test_unknown_route_is_a_json_404_without_a_traceback() -> None:
    with api_server() as base_url:
        status, body, _ = request(base_url, "/api/nope")

        assert status == 404
        assert body["error"]["code"] == "not_found"
        assert "Traceback" not in json.dumps(body)
        assert "/api/nope" not in json.dumps(body), "the response should not reflect the path back"


def test_unknown_route_is_404_even_for_post() -> None:
    """Route before method: an unknown path is 404 whatever the verb, and
    405 stays reserved for an endpoint that exists.
    """
    with api_server() as base_url:
        status, body, _ = request(base_url, "/api/does-not-exist", method="POST")

        assert status == 404
        assert body["error"]["code"] == "not_found"


def test_post_to_health_is_405_with_an_allow_header() -> None:
    with api_server() as base_url:
        status, body, headers = request(base_url, "/api/health", method="POST")

        assert status == 405
        assert body["error"]["code"] == "method_not_allowed"
        assert headers["Allow"] == "GET"


def test_post_to_cases_is_405() -> None:
    with api_server() as base_url:
        status, body, headers = request(base_url, "/api/cases", method="POST")

        assert status == 405
        assert body["error"]["code"] == "method_not_allowed"
        assert headers["Allow"] == "GET"


def test_no_cors_header_is_sent_by_default() -> None:
    with api_server() as base_url:
        _, _, headers = request(base_url, "/api/health")

        assert "Access-Control-Allow-Origin" not in headers


# --- G. no credential required ---------------------------------------


def test_api_serves_without_any_calle_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    with api_server() as base_url:
        assert request(base_url, "/api/health")[0] == 200
        assert request(base_url, "/api/cases")[0] == 200


# --- H. anti-secret sweep --------------------------------------------


def test_no_response_leaks_a_credential_or_internal_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """A sentinel key is planted in the environment first: the point is
    not that the server has nothing to leak, it is that it leaks nothing
    even when something is there.
    """
    sentinel = "iams_live_sentinel_key_that_must_never_appear"
    monkeypatch.setenv("CALLE_API_KEY", sentinel)

    forbidden = (sentinel, "CALLE_API_KEY", "Authorization", "Bearer", "idempotency", "api.heycall-e.com")
    with api_server() as base_url:
        for path in ("/api/health", "/api/cases", "/api/nope"):
            _, body, _ = request(base_url, path)
            raw = json.dumps(body)
            for needle in forbidden:
                assert needle.lower() not in raw.lower(), f"{needle!r} leaked from {path}"
            for text in walk_strings(body):
                assert "C:\\" not in text and "/Users/" not in text, "a server path leaked"


# --- I. import safety ------------------------------------------------


def test_the_http_layer_makes_no_decision_of_its_own() -> None:
    """The HTTP layer now calls pipeline.resolve(), and that is the only
    engine call it is allowed to make.

    This replaces a narrower check that simply asserted the pipeline was
    not imported at all - true while there was no resolution endpoint,
    and superseded the moment there was one. The guarantee worth keeping
    is stronger and is the one that stops the engine being reimplemented
    behind HTTP: the handler may not score rules, build a compliance
    context, run or filter checks, reconcile a result, or construct a
    provider client. Exactly one function orchestrates a resolution, for
    the CLI and for HTTP alike.
    """
    import api.server as server_module

    source = Path(server_module.__file__).read_text(encoding="utf-8")
    for forbidden in (
        "evaluate(",
        "run_precall_checks(",
        "apply_use_case(",
        "reconcile(",
        "PreCallContext(",
        "CallEClient(",
        "create_call(",
        "poll_until_terminal(",
        "decision_options[",
    ):
        assert forbidden not in source, f"{forbidden} in the HTTP layer duplicates the pipeline"

    assert "resolve(request)" in source, "the handler must delegate the whole run to the pipeline"


def test_importing_the_server_starts_nothing() -> None:
    for name in [m for m in list(sys.modules) if m.startswith("api")]:
        del sys.modules[name]
    before = threading.active_count()

    import api.server  # noqa: F401

    assert threading.active_count() == before, "importing the module must not start a listener"


def test_create_server_does_not_serve_until_asked() -> None:
    from api.server import create_server

    server = create_server("127.0.0.1", 0)
    try:
        host, port = server.server_address[:2]
        assert port != 0
        # The socket is bound, so the OS completes the TCP handshake from
        # the listen backlog - but nothing is reading it, so the request
        # never gets a reply. Timing out is the evidence that no request
        # loop is running; a served port would answer immediately.
        with pytest.raises((urllib.error.URLError, TimeoutError, OSError)):
            urllib.request.urlopen(f"http://{host}:{port}/api/health", timeout=0.4)
    finally:
        server.server_close()


# --- serializer unit checks ------------------------------------------


def test_case_metadata_masks_the_number_and_omits_the_task_hint() -> None:
    case = load_case(HERE / "cases" / "critical-service-escalation.json")
    payload = case_metadata(case)

    assert payload["call_phone_masked"] == "+...0187"
    assert case.call_phone not in json.dumps(payload)
    assert "call_task_hint" not in payload
    assert payload["decision_options"]["if_confirmed"] == "CONTINUE_DISPATCH"
    assert payload["evidence"][0]["freshness_hours"] == 72


# --- keep-alive: a request body must not desync the connection -------
#
# urllib opens a fresh connection per request, so none of the tests above
# could see this. These use http.client directly and reuse one
# connection, which is what a browser - and therefore the web UI - does.


@contextmanager
def keepalive_connection(base_url: str) -> Iterator[http.client.HTTPConnection]:
    host, port = base_url.removeprefix("http://").split(":")
    connection = http.client.HTTPConnection(host, int(port), timeout=5)
    try:
        yield connection
    finally:
        connection.close()


def read(response: http.client.HTTPResponse) -> tuple[int, str, str]:
    body = response.read().decode("utf-8", "replace")
    return response.status, response.getheader("Content-Type") or "", body


PROBE = '{"probe":"MUST_NOT_BE_REFLECTED"}'


def test_post_body_then_get_on_the_same_connection_stays_clean() -> None:
    """The exact sequence that used to break: the 405 was correct, but
    the unread body made the next request parse from the wrong offset,
    producing an HTML 501 that quoted the body back at the client.
    """
    with api_server() as base_url, keepalive_connection(base_url) as connection:
        connection.request("POST", "/api/health", body=PROBE, headers={"Content-Type": "application/json"})
        status, content_type, body = read(connection.getresponse())
        assert status == 405
        assert content_type == "application/json"
        assert json.loads(body)["error"]["code"] == "method_not_allowed"

        connection.request("GET", "/api/health")
        status, content_type, body = read(connection.getresponse())

        assert status == 200, "the reused connection must still answer correctly"
        assert content_type == "application/json"
        payload = json.loads(body)
        assert payload["status"] == "ok"
        assert payload["mode"] == "fake"
        assert "MUST_NOT_BE_REFLECTED" not in body, "the previous body contaminated this response"
        assert "<html" not in body.lower()


@pytest.mark.parametrize(
    ("method", "path", "expected"),
    [
        ("POST", "/api/health", 405),
        ("POST", "/api/cases", 405),
        ("POST", "/api/nope", 404),
        ("GET", "/api/health", 200),
        ("GET", "/api/cases", 200),
    ],
)
def test_every_route_survives_a_body_on_a_reused_connection(method: str, path: str, expected: int) -> None:
    """All three outcomes were affected, not just the 405."""
    with api_server() as base_url, keepalive_connection(base_url) as connection:
        connection.request(method, path, body=PROBE, headers={"Content-Type": "application/json"})
        first_status, _, _ = read(connection.getresponse())
        assert first_status == expected

        connection.request("GET", "/api/health")
        status, content_type, body = read(connection.getresponse())

        assert status == 200
        assert content_type == "application/json"
        assert json.loads(body)["status"] == "ok"
        assert "MUST_NOT_BE_REFLECTED" not in body


def test_several_bodies_in_a_row_on_one_connection() -> None:
    with api_server() as base_url, keepalive_connection(base_url) as connection:
        for index in range(4):
            connection.request(
                "POST", "/api/cases", body=f'{{"n":{index},"pad":"{"x" * 500}"}}',
                headers={"Content-Type": "application/json"},
            )
            assert read(connection.getresponse())[0] == 405

        connection.request("GET", "/api/cases")
        status, content_type, body = read(connection.getresponse())
        assert status == 200
        assert content_type == "application/json"
        assert len(json.loads(body)["cases"]) == 2


def test_a_body_with_no_content_length_does_not_hang_the_request() -> None:
    """No Content-Length means nothing to drain. Reading anyway would
    block until the peer gave up, so the server must not try.
    """
    with api_server() as base_url, keepalive_connection(base_url) as connection:
        connection.putrequest("GET", "/api/health")
        connection.endheaders()  # no Content-Length, no body
        status, content_type, body = read(connection.getresponse())

        assert status == 200
        assert content_type == "application/json"
        assert json.loads(body)["status"] == "ok"


def test_a_chunked_body_closes_the_connection_instead_of_desyncing() -> None:
    """This server does not decode transfer encodings for input no route
    reads. Closing is the honest outcome: it never claims to have
    consumed a body it cannot delimit.
    """
    with api_server() as base_url, keepalive_connection(base_url) as connection:
        connection.putrequest("POST", "/api/health")
        connection.putheader("Transfer-Encoding", "chunked")
        connection.endheaders()
        connection.send(b"5\r\nhello\r\n0\r\n\r\n")
        response = connection.getresponse()
        status, content_type, body = read(response)

        assert status == 405
        assert content_type == "application/json"
        assert "MUST_NOT_BE_REFLECTED" not in body
        assert response.will_close, "a body this server cannot delimit must end the connection"


def test_a_malformed_content_length_closes_the_connection() -> None:
    with api_server() as base_url, keepalive_connection(base_url) as connection:
        connection.putrequest("GET", "/api/health")
        connection.putheader("Content-Length", "not-a-number")
        connection.endheaders()
        response = connection.getresponse()
        status, content_type, _ = read(response)

        assert status == 200
        assert content_type == "application/json"
        assert response.will_close


def test_an_oversized_declared_body_closes_rather_than_being_read() -> None:
    """The server declines to read a gigabyte it has no use for; it drops
    the connection instead of draining, and never allocates the body.
    """
    from api.server import MAX_DRAIN_BYTES

    with api_server() as base_url, keepalive_connection(base_url) as connection:
        connection.putrequest("POST", "/api/health")
        connection.putheader("Content-Length", str(MAX_DRAIN_BYTES + 1))
        connection.endheaders()
        response = connection.getresponse()
        status, content_type, _ = read(response)

        assert status == 405
        assert content_type == "application/json"
        assert response.will_close


# --- 3.1 store bridge -------------------------------------------------


def test_path_for_returns_the_served_case_file() -> None:
    store = CaseStore()
    for name in store.names():
        path = store.path_for(name)
        assert path.is_file()
        assert path.name == f"{name}.json"
        assert path.parent.name == "cases"


def test_path_for_uses_the_same_allowlist_as_get() -> None:
    """A looser check here than in get() would be a bypass with extra
    steps: path_for is what a request reaches.
    """
    store = CaseStore()
    for name in (
        LIVE_FIXTURE,
        f"{LIVE_FIXTURE}.json",
        "../client",
        "../../README",
        "cases/ghost-appointment",
        "ghost-appointment/../ghost-appointment-live-test",
        "/etc/passwd",
        "",
    ):
        with pytest.raises(CaseNotFoundError):
            store.path_for(name)


# --- 3.2 backend lifecycle -------------------------------------------


def test_backend_starts_and_stops_without_leaving_a_listener() -> None:
    from api.backend import BackendNotRunningError, FakeCallBackend

    backend = FakeCallBackend()
    assert backend.running is False
    with pytest.raises(BackendNotRunningError):
        backend.base_url

    backend.start()
    assert backend.running is True
    base_url = backend.base_url
    assert base_url.startswith("http://127.0.0.1:"), "the fake backend must stay on loopback"

    backend.stop()
    assert backend.running is False
    host, port = base_url.removeprefix("http://").split(":")
    with pytest.raises((urllib.error.URLError, OSError)):
        urllib.request.urlopen(f"http://{host}:{port}/v1/calls/x", timeout=1)


def test_backend_start_and_stop_are_idempotent() -> None:
    from api.backend import FakeCallBackend

    backend = FakeCallBackend()
    backend.stop()  # never started
    backend.start()
    first = backend.base_url
    backend.start()  # again
    assert backend.base_url == first
    backend.stop()
    backend.stop()  # again
    assert backend.running is False


def test_create_server_does_not_start_the_backend() -> None:
    """Separate lifecycles: a forgotten stop must be visible, not
    absorbed by the HTTP server's own shutdown.
    """
    from api.server import create_server

    server = create_server("127.0.0.1", 0)
    try:
        assert server.backend.running is False
    finally:
        server.server_close()


# --- 3.3 resolution store --------------------------------------------


def test_resolution_ids_are_opaque_and_unique() -> None:
    from api.store import ResolutionStore

    ids = {ResolutionStore.new_id() for _ in range(200)}
    assert len(ids) == 200, "ids must not collide"
    for value in ids:
        assert value.startswith("res_")
        assert len(value) > 12
        # Nothing about the resolution may be recoverable from its id.
        for leak in ("critical", "ghost", "+1", "2026", "confirmed"):
            assert leak not in value


def test_resolution_store_is_bounded_and_evicts_oldest_first() -> None:
    from api.store import ResolutionNotFoundError, ResolutionStore

    store = ResolutionStore(max_entries=3)
    ids = []
    for index in range(5):
        rid = ResolutionStore.new_id()
        ids.append(rid)
        store.put(rid, {"n": index})

    assert len(store) == 3
    for evicted in ids[:2]:
        with pytest.raises(ResolutionNotFoundError):
            store.get(evicted)
    for kept in ids[2:]:
        assert store.get(kept)["n"] in (2, 3, 4)


# --- 3.5 POST /api/resolutions: the five branches --------------------

NEAR = "2026-09-10T20:00:00Z"
FAR = "2026-09-01T10:00:00Z"
HERO = "critical-service-escalation"


def test_no_call_needed_never_reaches_the_gate_or_the_backend() -> None:
    with api_server_and_backend() as (base_url, backend):
        status, body, _ = post(base_url, "/api/resolutions", {"case": HERO, "now_utc": FAR})

        assert status == 201
        assert body["state"] == "completed"
        assert body["call_decision"] == "NO_CALL_NEEDED"
        assert body["reasoning"]["decision_critical"] is False
        assert body["compliance"] is None
        assert body["call"]["placed"] is False
        assert body["verdict"] == {"status": "NO_CALL_NEEDED", "action": "NO_ACTION_REQUIRED"}
        assert backend.creates == 0


def test_blocked_scenario_is_refused_by_the_real_hard_gate() -> None:
    with api_server_and_backend() as (base_url, backend):
        status, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": "blocked", "now_utc": NEAR}
        )

        assert status == 201
        assert body["reasoning"]["decision_critical"] is True
        assert body["call_decision"] == "CALL_JUSTIFIED"
        assert body["compliance"]["allowed"] is False
        assert body["verdict"]["status"] == "UNRESOLVED_CALL_BLOCKED"
        assert body["verdict"]["action"] == "RETRY_WHEN_PERMITTED"
        assert body["call"]["placed"] is False
        assert backend.creates == 0, "a blocked call must never reach the backend"


def test_confirmed_scenario_resolves_to_the_cases_own_action() -> None:
    with api_server_and_backend() as (base_url, backend):
        status, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": "confirmed", "now_utc": NEAR}
        )

        assert status == 201
        assert body["verdict"] == {"status": "RESOLVED", "action": "CONTINUE_DISPATCH"}
        assert body["call"]["placed"] is True
        assert body["call"]["provider_status"] == "completed"
        assert body["call"]["result"]["subject_intent"] == "confirmed"
        assert backend.creates == 1


def test_cancelled_scenario_resolves_to_the_cases_own_alternate_action() -> None:
    with api_server() as base_url:
        _, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": "cancelled", "now_utc": NEAR}
        )

        assert body["verdict"] == {"status": "RESOLVED_ALT", "action": "REASSIGN_TECHNICIAN"}


def test_voicemail_is_human_review_and_never_the_cancelled_action() -> None:
    """The absolute rule at the HTTP boundary: silence is not a
    cancellation, and no field of the response may say otherwise.
    """
    with api_server() as base_url:
        _, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": "voicemail", "now_utc": NEAR}
        )

        assert body["verdict"] == {"status": "UNRESOLVED_AMBIGUOUS", "action": "HUMAN_REVIEW"}
        raw = json.dumps(body)
        assert "REASSIGN_TECHNICIAN" not in raw.replace('"if_cancelled": "REASSIGN_TECHNICIAN"', "")
        assert body["verdict"]["action"] != body["case"]["decision_options"]["if_cancelled"]


def test_the_other_shipped_use_case_runs_through_the_same_endpoint() -> None:
    with api_server() as base_url:
        _, body, _ = post(
            base_url, "/api/resolutions", {"case": "ghost-appointment", "now_utc": NEAR}
        )

        assert body["verdict"] == {"status": "RESOLVED", "action": "KEEP_SLOT"}
        assert body["case"]["use_case"] == "appointment_confirmation"


# --- 3.5 GET /api/resolutions/{id} -----------------------------------


def test_a_created_resolution_can_be_read_back_unchanged() -> None:
    with api_server() as base_url:
        _, created, _ = post(base_url, "/api/resolutions", {"case": HERO, "now_utc": NEAR})
        status, fetched, _ = request(base_url, f"/api/resolutions/{created['id']}")

        assert status == 200
        assert fetched == created


def test_an_unknown_resolution_is_a_uniform_404() -> None:
    with api_server() as base_url:
        for path in ("/api/resolutions/res_nope", "/api/resolutions/../cases", "/api/resolutions/x/y"):
            status, body, _ = request(base_url, path)
            assert status == 404
            assert "Traceback" not in json.dumps(body)
            assert path not in json.dumps(body)


def test_the_collection_with_a_trailing_slash_is_still_the_collection() -> None:
    """The path normalizer strips a trailing slash, so /api/resolutions/
    is the collection - which takes POST, not GET. Pinned because it is
    the one place an empty id could otherwise look like a resolution.
    """
    with api_server() as base_url:
        status, _, headers = request(base_url, "/api/resolutions/")
        assert status == 405
        assert headers["Allow"] == "POST"


def test_post_to_a_specific_resolution_is_405() -> None:
    with api_server() as base_url:
        status, _, headers = request(base_url, "/api/resolutions/res_x", method="POST")
        assert status == 405
        assert headers["Allow"] == "GET"


def test_get_on_the_collection_is_405() -> None:
    with api_server() as base_url:
        status, body, headers = request(base_url, "/api/resolutions")
        assert status == 405
        assert headers["Allow"] == "POST"
        assert body["error"]["code"] == "method_not_allowed"


# --- 3.5 request validation and no-bypass ----------------------------


def test_malformed_json_is_400() -> None:
    with api_server() as base_url:
        for payload in (b"{not json", b"", b"[]", b'"a string"'):
            status, body, _ = post(base_url, "/api/resolutions", payload)
            assert status == 400
            assert body["error"]["code"] == "invalid_json"
            assert "Traceback" not in json.dumps(body)


def test_an_unknown_case_is_404_and_reveals_nothing_about_the_filesystem() -> None:
    with api_server() as base_url:
        for name in ("nope", LIVE_FIXTURE, "../client", "ghost-appointment.json"):
            status, body, _ = post(base_url, "/api/resolutions", {"case": name})
            assert status == 404
            assert body["error"]["code"] == "case_not_found"
            assert name not in json.dumps(body), "the response must not echo the requested name"


def test_an_invalid_scenario_is_422() -> None:
    with api_server() as base_url:
        for scenario in ("live", "REAL", "", None, 1, "resolved"):
            status, body, _ = post(
                base_url, "/api/resolutions", {"case": HERO, "scenario": scenario}
            )
            assert status == 422
            assert body["error"]["code"] == "invalid_scenario"


def test_an_invalid_case_field_is_422() -> None:
    with api_server() as base_url:
        for case in (None, 1, "", [], {}):
            status, body, _ = post(base_url, "/api/resolutions", {"case": case})
            assert status == 422
            assert body["error"]["code"] == "invalid_case"


def test_an_invalid_now_utc_is_422() -> None:
    with api_server() as base_url:
        for value in ("yesterday", "2026-13-45", 1757000000, None):
            status, body, _ = post(base_url, "/api/resolutions", {"case": HERO, "now_utc": value})
            assert status == 422
            assert body["error"]["code"] == "invalid_now_utc"


@pytest.mark.parametrize(
    "field",
    ["base_url", "execute", "allow_live", "authorize_destination", "phone", "phone_override",
     "api_key", "CALLE_API_KEY", "case_path", "poll_interval_seconds", "mode"],
)
def test_no_request_field_can_steer_the_engine(field: str) -> None:
    """Every knob that decides who gets called, or whether a real call is
    made, is refused at the door rather than ignored - so a client that
    tries hears about it instead of silently getting fake-mode behaviour
    it did not ask for.
    """
    with api_server_and_backend() as (base_url, backend):
        status, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "now_utc": NEAR, field: "anything"}
        )

        assert status == 422, f"{field} must be refused, not ignored"
        assert body["error"]["code"] == "unknown_field"
        assert backend.creates == 0, "a refused request must not have run anything"


def test_the_api_never_talks_to_the_real_provider() -> None:
    """base_url comes from the backend this process started. There is no
    request shape that changes it, and no live mode to select.
    """
    import api.server as server_module

    source = Path(server_module.__file__).read_text(encoding="utf-8")
    assert "api.heycall-e.com" not in source
    assert "allow_live=False" in source
    assert "base_url=self.backend.base_url" in source

    with api_server() as base_url:
        _, body, _ = request(base_url, "/api/health")
        assert body["mode"] == "fake"


def test_resolutions_work_without_any_calle_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    with api_server() as base_url:
        status, body, _ = post(base_url, "/api/resolutions", {"case": HERO, "now_utc": NEAR})
        assert status == 201
        assert body["verdict"]["status"] == "RESOLVED"


# --- 3.4 serializer: what must never come out ------------------------


def _every_resolution_response(base_url: str) -> list[dict[str, Any]]:
    bodies = []
    for scenario in ("confirmed", "cancelled", "voicemail", "blocked"):
        _, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": scenario, "now_utc": NEAR}
        )
        bodies.append(body)
    _, body, _ = post(base_url, "/api/resolutions", {"case": HERO, "now_utc": FAR})
    bodies.append(body)
    return bodies


def test_no_provider_internal_reaches_a_resolution_response() -> None:
    case = load_case(HERE / "cases" / f"{HERO}.json")
    with api_server() as base_url:
        for body in _every_resolution_response(base_url):
            raw = json.dumps(body)

            assert case.call_phone not in raw, "the recipient number leaked"
            assert not re.search(r"\+[1-9][0-9]{6,14}", raw), "an unmasked E.164 number leaked"
            assert case.call_task_hint[:40] not in raw, "call_task_hint leaked"
            assert "Required disclosure" not in raw, "the hardened task leaked"
            assert "transcript" not in raw
            assert "Hello from the fake server" not in raw, "a transcript turn leaked"
            assert "provider_call_id" not in raw
            assert "call_fake" not in raw, "a provider id leaked"
            assert "evidence_cited" not in raw
            assert "metadata" not in raw
            assert "attempts" not in raw
            assert "recipients" not in raw


def test_the_call_projection_names_exactly_what_it_exposes() -> None:
    with api_server() as base_url:
        _, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": "confirmed", "now_utc": NEAR}
        )

        assert set(body["call"]) == {"placed", "provider_status", "result"}
        assert set(body["call"]["result"]) <= {
            "subject_intent", "answered_by", "confidence_note",
            "manipulation_attempt_detected", "manipulation_attempt_note",
        }
        assert set(body["verdict"]) == {"status", "action"}
        assert set(body) == {
            "id", "state", "mode", "case", "evidence", "reasoning",
            "call_decision", "compliance", "call", "verdict", "error",
        }


def test_a_compliance_reason_carrying_a_phone_number_is_masked() -> None:
    """The blocked path is the one whose reason quotes the number being
    dialled. It must still explain itself, without the digits.
    """
    with api_server() as base_url:
        _, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": "blocked", "now_utc": NEAR}
        )

        reasons = [check["reason"] for check in body["compliance"]["checks"]]
        joined = " ".join(reasons)
        assert "+442079460123" not in joined
        assert "no jurisdiction mapped" in joined, "the explanation must survive the masking"
        assert "+...0123" in joined, "the number should be masked, not deleted"


def test_the_reason_sanitizer_is_applied_to_every_engine_string() -> None:
    """Checked directly, because the engine could grow another rule that
    interpolates a number and no route-level test would notice.
    """
    from api.serialize import sanitize_reason

    assert sanitize_reason("blocked for '+442079460123'") == "blocked for '+...0123'"
    assert sanitize_reason("two: +12025550187 and +33639980000") == "two: +...0187 and +...0000"
    assert sanitize_reason("no numbers here") == "no numbers here"


def test_state_and_verdict_never_collapse_into_one_field() -> None:
    with api_server() as base_url:
        for body in _every_resolution_response(base_url):
            assert body["state"] == "completed"
            assert body["verdict"] is not None
            assert body["state"] != body["verdict"]["status"]
            # A transport state must never be an engine outcome.
            assert body["state"] not in {
                "RESOLVED", "RESOLVED_ALT", "UNRESOLVED_AMBIGUOUS",
                "UNRESOLVED_CALL_BLOCKED", "NO_CALL_NEEDED",
            }


def test_the_serializer_invents_no_verdict_when_the_pipeline_produced_none() -> None:
    """A dry run stops before a verdict exists. The API never runs one,
    but the serializer must not paper over the case if it ever does.
    """
    import io
    import contextlib as _contextlib

    from api.serialize import resolution_payload
    from client import parse_utc_timestamp
    from pipeline import ResolutionRequest, resolve

    from api.backend import FakeCallBackend

    backend = FakeCallBackend()
    backend.start()
    try:
        with _contextlib.redirect_stdout(io.StringIO()):
            dry = resolve(
                ResolutionRequest(
                    case_path=str(CaseStore().path_for(HERO)),
                    base_url=backend.base_url,
                    execute=False,
                    now_utc=parse_utc_timestamp(NEAR),
                )
            )
    finally:
        backend.stop()

    assert dry.verdict is None
    payload = resolution_payload(dry, "res_x", "completed", "fake")
    assert payload["verdict"] is None
    assert payload["call"]["placed"] is False


# --- 3.6-b: ResolutionStore under concurrency ------------------------
#
# ThreadingHTTPServer has always given each request its own thread, so
# this store was shared before it was locked. These use a Barrier rather
# than sleeps, so the threads collide at a known instant instead of a
# hoped-for one.
#
# Stated plainly: under CPython's GIL the unlocked version passes these
# too. They assert that the invariants hold under concurrency; they do
# not demonstrate a race that was observed. The lock makes put()'s three
# statements indivisible rather than incidentally atomic.


def test_concurrent_puts_never_exceed_the_cap_or_lose_the_store() -> None:
    from api.store import ResolutionStore

    store = ResolutionStore(max_entries=200)
    threads_count, per_thread = 50, 20
    barrier = threading.Barrier(threads_count)
    failures: list[BaseException] = []

    def writer() -> None:
        try:
            barrier.wait(timeout=10)
            for _ in range(per_thread):
                store.put(ResolutionStore.new_id(), {"payload": True})
        except BaseException as exc:  # noqa: BLE001 - recorded, re-raised below
            failures.append(exc)

    workers = [threading.Thread(target=writer) for _ in range(threads_count)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=30)

    assert not failures, f"a writer raised: {failures[0]!r}"
    assert all(not worker.is_alive() for worker in workers)
    assert len(store) == 200, "the cap must hold exactly under 1000 concurrent puts"


def test_readers_during_a_write_storm_never_see_a_broken_entry() -> None:
    from api.store import ResolutionNotFoundError, ResolutionStore

    store = ResolutionStore(max_entries=200)
    pinned = ResolutionStore.new_id()
    store.put(pinned, {"pinned": True})

    stop = threading.Event()
    failures: list[BaseException] = []
    barrier = threading.Barrier(6)

    def writer() -> None:
        try:
            barrier.wait(timeout=10)
            while not stop.is_set():
                store.put(ResolutionStore.new_id(), {"payload": True})
        except BaseException as exc:  # noqa: BLE001
            failures.append(exc)

    def reader() -> None:
        try:
            barrier.wait(timeout=10)
            while not stop.is_set():
                try:
                    entry = store.get(pinned)
                except ResolutionNotFoundError:
                    return  # legitimately evicted; nothing broken about that
                assert entry == {"pinned": True}, "a reader saw a partial entry"
                assert len(store) <= 200
        except BaseException as exc:  # noqa: BLE001
            failures.append(exc)

    workers = [threading.Thread(target=writer) for _ in range(3)]
    workers += [threading.Thread(target=reader) for _ in range(3)]
    for worker in workers:
        worker.start()
    time.sleep(0.25)
    stop.set()
    for worker in workers:
        worker.join(timeout=10)

    assert not failures, f"a worker raised: {failures[0]!r}"
    assert len(store) <= 200


def test_fifo_eviction_order_is_unchanged_by_the_lock() -> None:
    """The single-threaded guarantee still holds exactly: oldest out
    first, cap respected, survivors readable.
    """
    from api.store import ResolutionNotFoundError, ResolutionStore

    store = ResolutionStore(max_entries=3)
    ids = [ResolutionStore.new_id() for _ in range(5)]
    for index, rid in enumerate(ids):
        store.put(rid, {"n": index})

    assert len(store) == 3
    for evicted in ids[:2]:
        with pytest.raises(ResolutionNotFoundError):
            store.get(evicted)
    assert [store.get(rid)["n"] for rid in ids[2:]] == [2, 3, 4]


def test_forty_concurrent_posts_stay_consistent_over_http() -> None:
    """The same guarantee through the real server, which is where the
    threads actually come from.
    """
    with api_server_and_backend() as (base_url, backend):
        barrier = threading.Barrier(40)
        results: list[tuple[int, str]] = []
        lock = threading.Lock()

        def worker(index: int) -> None:
            scenario = ("confirmed", "cancelled", "voicemail")[index % 3]
            barrier.wait(timeout=20)
            status, body, _ = post(
                base_url,
                "/api/resolutions",
                {"case": HERO, "scenario": scenario, "now_utc": NEAR},
            )
            with lock:
                results.append((status, body["id"]))

        workers = [threading.Thread(target=worker, args=(i,)) for i in range(40)]
        for worker_thread in workers:
            worker_thread.start()
        for worker_thread in workers:
            worker_thread.join(timeout=60)

        assert len(results) == 40, "every concurrent POST must have answered"
        assert all(status == 201 for status, _ in results), "the 201 contract holds under load"
        ids = [rid for _, rid in results]
        assert len(set(ids)) == 40, "ids collided under concurrency"
        assert backend.creates == 40

        # Every one of them is still readable through its own id.
        for rid in ids[-10:]:
            status, fetched, _ = request(base_url, f"/api/resolutions/{rid}")
            assert status == 200
            assert fetched["id"] == rid


# --- 3.6-a: the polling loop is bounded ------------------------------


@contextmanager
def wedged_provider(poll_seconds: float = 0.05) -> Iterator[None]:
    """Make the provider look permanently in progress, and shorten the
    poll bound so the test is quick.

    Injected at CallEClient.get_call, which is exactly what
    poll_until_terminal loops on - so the loop under test runs for real,
    against a real fake backend, with nothing slowed down and
    fake_server.py untouched. A status outside TERMINAL_STATUSES simply
    never ends the loop, which is the condition the bound exists for.

    Restores both attributes itself rather than leaning on pytest's
    monkeypatch fixture, which unwinds at the end of the test and not at
    the end of a with block - the difference matters here, because these
    tests need the provider working again afterwards.
    """
    import api.server as server_module
    from client import CallEClient

    original_get_call = CallEClient.get_call
    original_bound = server_module.MAX_POLL_SECONDS
    CallEClient.get_call = lambda self, call_id: {"id": call_id, "status": "in_progress"}  # type: ignore[method-assign]
    server_module.MAX_POLL_SECONDS = poll_seconds
    try:
        yield
    finally:
        CallEClient.get_call = original_get_call  # type: ignore[method-assign]
        server_module.MAX_POLL_SECONDS = original_bound


def test_a_call_that_never_terminates_fails_technically_without_a_verdict() -> None:
    with api_server_and_backend() as (base_url, backend):
        with wedged_provider():
            started = time.monotonic()
            status, body, _ = post(
                base_url,
                "/api/resolutions",
                {"case": HERO, "scenario": "confirmed", "now_utc": NEAR},
            )
            elapsed = time.monotonic() - started

        assert status == 502
        assert body["error"]["code"] == "resolution_failed"

        # A technical failure is a technical failure. No verdict is
        # invented, and nothing in the reply can be read as one.
        raw = json.dumps(body)
        assert "verdict" not in body
        for forbidden in (
            "RESOLVED", "RESOLVED_ALT", "CANCELLED", "UNRESOLVED_AMBIGUOUS",
            "REASSIGN_TECHNICIAN", "CONTINUE_DISPATCH", "HUMAN_REVIEW",
        ):
            assert forbidden not in raw, f"{forbidden} appeared in a technical failure"
        assert "Traceback" not in raw
        assert set(body) == {"error"}

        # The request returned instead of pinning a worker thread forever.
        assert elapsed < 5.0, f"the request took {elapsed:.1f}s; the poll bound did not fire"
        assert backend.creates == 1, "the call was created; only its completion never came"


def test_a_timed_out_resolution_is_not_stored() -> None:
    from api.backend import FakeCallBackend
    from api.server import create_server
    from api.store import ResolutionStore

    backend = FakeCallBackend()
    backend.start()
    resolutions = ResolutionStore()
    server = create_server("127.0.0.1", 0, backend=backend, resolutions=resolutions)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    base_url = f"http://{host}:{port}"
    try:
        assert len(resolutions) == 0
        with wedged_provider():
            status, _, _ = post(
                base_url, "/api/resolutions", {"case": HERO, "scenario": "confirmed", "now_utc": NEAR}
            )
        assert status == 502
        assert len(resolutions) == 0, "a failed run must leave nothing behind"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        backend.stop()


def test_the_server_still_works_after_a_timeout() -> None:
    """A wedged poll must not wedge the server: the next request has to
    behave as if nothing happened.
    """
    threads_before = threading.active_count()

    with api_server_and_backend() as (base_url, _):
        with wedged_provider():
            assert post(base_url, "/api/resolutions", {"case": HERO, "now_utc": NEAR})[0] == 502

        # The context restored both the provider and the real bound, so
        # this second run is the ordinary path again.
        status, body, _ = post(
            base_url, "/api/resolutions", {"case": HERO, "scenario": "confirmed", "now_utc": NEAR}
        )
        assert status == 201
        assert body["verdict"] == {"status": "RESOLVED", "action": "CONTINUE_DISPATCH"}
        assert request(base_url, "/api/health")[0] == 200

    deadline = time.monotonic() + 5
    while threading.active_count() > threads_before and time.monotonic() < deadline:
        time.sleep(0.05)
    assert threading.active_count() <= threads_before, "a request thread was left running"


def test_the_poll_bound_is_armed_on_the_http_path() -> None:
    """The constant exists and is actually handed to the pipeline. A
    bound nobody passes is not a bound.
    """
    from api.server import MAX_POLL_SECONDS

    assert MAX_POLL_SECONDS == 10.0
    source = Path(__import__("api.server", fromlist=["x"]).__file__).read_text(encoding="utf-8")
    assert "poll_timeout_seconds=MAX_POLL_SECONDS" in source


def test_the_normal_branches_are_unaffected_by_the_bound() -> None:
    """Ten seconds is orders of magnitude above what any branch needs, so
    none of them should come near it.
    """
    with api_server() as base_url:
        for scenario, expected in (
            ("confirmed", "RESOLVED"),
            ("cancelled", "RESOLVED_ALT"),
            ("voicemail", "UNRESOLVED_AMBIGUOUS"),
            ("blocked", "UNRESOLVED_CALL_BLOCKED"),
        ):
            started = time.monotonic()
            status, body, _ = post(
                base_url, "/api/resolutions", {"case": HERO, "scenario": scenario, "now_utc": NEAR}
            )
            elapsed = time.monotonic() - started
            assert status == 201
            assert body["verdict"]["status"] == expected
            assert elapsed < 5.0, f"{scenario} took {elapsed:.1f}s, uncomfortably close to the bound"
