"""The guards inside the offline double that nothing was checking.

The double is not judge-facing and it is not the product. It is the thing every offline
test in this repository is measured against, and a judge running the default command runs
entirely on it, so a wrong branch here is a wrong branch in all of them at once. The guard
sweep in `tests/test_guard_coverage.py` found eleven of its guards that no test noticed
being deleted; this closes ten.

Nine of the ten were reached by the old suite and never violated: the state the rule is
about was never constructed. One, `engine.py:484`, was reached *and* violated, and the
suite still did not notice, which is the worse defect and the reason
`test_reading_a_finished_call_does_not_change_it` is the first one below.

Two are recorded here rather than tested, both confirmed by deleting them rather than by
reasoning about them:

  * `calle_double/regions.py:96`, `if not phone.startswith("+")`. Redundant. Every calling
    code in the table starts with `+`, so a number without one matches no prefix and the
    loop below returns None anyway. `test_a_number_that_is_not_e164_resolves_to_no_region`
    pins the behaviour; it does not kill the guard, and it is not supposed to.
  * `calle_double/server.py:58`, `if not self.require_auth`, is gone. It was dead
    configuration: declared once with a default of True, read once, and set by nothing, so
    the branch that skips the authorisation check could not be taken. Covering it would have
    meant reaching into a private handler class to set an attribute no caller can reach,
    which specifies a mode that does not exist rather than covering one that does. It was
    deleted rather than wired up, because wiring it up would add a supported way to run the
    double with authorisation off, and the API it imitates has no such mode.
"""
from __future__ import annotations

import contextlib
import json
import pathlib
import socket
import urllib.error
import urllib.request

import pytest

from calle_double import CalleDouble, DoubleError, Outcome, build_transport, regions
from calle_double import server
from calle_double.server import serve
from tests.fixtures import IN_A

APP = pathlib.Path(__file__).resolve().parent.parent

SCHEMA = {"type": "object", "required": ["reason"]}
TERMINAL = ("completed", "failed", "canceled")


@pytest.fixture
def double() -> CalleDouble:
    return CalleDouble()


@contextlib.contextmanager
def running(engine: CalleDouble | None = None):
    """The double on a real socket, on a port the OS picked."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = serve(engine or CalleDouble(), port=port)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()


def call(url: str, *, method: str = "GET", key: str | None = "iams_test_anything",
         body: dict | None = None) -> tuple[int, object]:
    """Status and decoded body, whether the server answered 2xx or an error."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, method=method, data=data)
    if key is not None:
        request.add_header("Authorization", f"Bearer {key}")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"null")


# ---------------------------------------------------------------------------
# calle_double/engine.py:484 -- CalleDouble._advance
# ---------------------------------------------------------------------------

def test_reading_a_finished_call_does_not_change_it(double):
    """The only one of the double's guards the old suite reached and still missed.

    `get_call` advances the call as a side effect, which is how the double runs without a
    clock. The guard is what stops it advancing one that has already finished. Without it,
    every read of a completed call moves `completed_at` thirty seconds further on and logs
    another `call.completed` event, so the answer a poller gets depends on how many times
    anybody looked. The dispatcher polls until a terminal status and then classifies what
    it holds, so this is a finished call whose record rewrites itself under the reader.

    The loop is bounded. Unbounded, a regression here would hang the suite instead of
    failing it, which is the failure that cost this project two hours.
    """
    double.set_outcome(IN_A, Outcome.answered({"reason": "illness"}, [("bot", "Hi.")]))
    created = double.create_call(task="Ask.", recipients=[{"phone": IN_A}],
                                 result_schema=SCHEMA)

    for _ in range(50):
        finished = double.get_call(created["id"])
        if finished["status"] in TERMINAL:
            break
    else:
        raise AssertionError("the call never reached a terminal status in 50 reads")

    assert finished["status"] == "completed"
    again = double.get_call(created["id"])
    third = double.get_call(created["id"])
    assert again == finished, "reading a finished call changed it"
    assert third == finished, "and it kept changing on every read after that"


# ---------------------------------------------------------------------------
# calle_double/engine.py:445 and :455 -- get_call and list_events
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("read", ["get_call", "list_events"])
def test_asking_about_a_call_that_does_not_exist_is_a_404_not_a_crash(double, read):
    """The double has to be wrong the way the API is wrong.

    `not_found` on an unknown id is the response the dispatcher's fatal-error table is
    built around: a call this run created coming back not_found means the platform lost
    billable state. Without the guard the double raises `AttributeError` on None instead,
    which is not a response at all, so the branch that handles the real failure could never
    be reached offline.

    What this test covers is the shape of the response, which is all it touches. That the
    run then stops is asserted in `tests/test_dispatch.py`, by
    `test_a_fatal_code_on_a_read_stops_the_run_rather_than_retrying_it`, and it did not
    exist while this docstring claimed it: the dispatcher consulted `FATAL_ERRORS` only on
    create, which is the one path that cannot return this code.
    """
    with pytest.raises(DoubleError) as caught:
        getattr(double, read)("call_nothing_here")
    assert caught.value.code == "not_found"
    assert caught.value.status_code == 404


# ---------------------------------------------------------------------------
# calle_double/engine.py:388 -- CalleDouble._create_call_locked
# ---------------------------------------------------------------------------

def test_a_recipient_with_no_number_is_refused_at_creation(double):
    """`invalid_recipient` is in `PERMANENT_ERRORS`, so the dispatcher must be able to get it.

    A recipient object with neither `phones` nor `phone` is what a work row with an empty
    phone column produces. The double refusing it is what lets the permanent-error path be
    exercised without a network, and without the guard the call is created with a recipient
    that has nobody to ring.
    """
    with pytest.raises(DoubleError) as caught:
        double.create_call(task="Ask.", recipients=[{}], result_schema=SCHEMA)
    assert caught.value.code == "invalid_recipient"

    # The neighbouring rule, so the pair reads as one decision rather than two.
    with pytest.raises(DoubleError) as caught:
        double.create_call(task="Ask.", recipients=[{"phone": IN_A.lstrip("+")}],
                           result_schema=SCHEMA)
    assert caught.value.code == "invalid_phone"


# ---------------------------------------------------------------------------
# calle_double/engine.py:71 -- DoubleError.__init__
# ---------------------------------------------------------------------------

def test_the_double_cannot_invent_an_error_code_the_api_does_not_have(double):
    """The assertion that keeps the double honest about the surface it is imitating.

    `API_ERROR_CODES` is checked against the installed SDK by
    `test_enums_match_the_real_sdk`. This is the other half: that the double cannot raise
    something outside it. Without it, a typo in a code becomes a fixture, the dispatcher
    grows a branch for an error the platform never sends, and every offline test agrees.
    """
    with pytest.raises(AssertionError, match="not a real CALL-E error code"):
        DoubleError("teapot_unavailable", "Nope.")

    # A real one still constructs, so this is about the vocabulary and not about raising.
    assert DoubleError("not_found", "Call not found.", status_code=404).code == "not_found"


# ---------------------------------------------------------------------------
# calle_double/server.py:103 -- _Handler.do_POST
# ---------------------------------------------------------------------------

def test_the_http_server_rejects_a_create_with_no_api_key():
    """The read side was covered and the write side was not.

    `test_the_http_server_rejects_a_missing_api_key` sends a GET. Placing a call is the
    request that costs money and rings a phone, and it was the one whose authorisation
    check nothing exercised. Without the guard an unauthenticated POST creates a call.
    """
    with running() as base:
        status, body = call(f"{base}/v1/calls", method="POST", key=None,
                            body={"task": "Ask.", "recipients": [{"phone": IN_A}]})
    assert status == 401
    assert body["error"]["code"] == "unauthorized"


# ---------------------------------------------------------------------------
# calle_double/server.py:106 -- _Handler.do_POST
# ---------------------------------------------------------------------------

def test_a_post_to_a_route_the_double_does_not_have_is_a_404():
    """A path check that only runs after authorisation, and so never ran under test.

    Without it every authenticated POST is treated as a call creation whatever its path,
    so a client with a typo in its base URL silently places calls instead of getting a 404.
    """
    with running() as base:
        status, body = call(f"{base}/v1/calls/x/cancel", method="POST",
                            body={"task": "Ask."})
    assert status == 404
    assert body["error"]["code"] == "not_found"


# ---------------------------------------------------------------------------
# calle_double/server.py:76 -- _Handler.do_GET
# ---------------------------------------------------------------------------

def test_the_goals_route_answers_an_empty_list_over_the_wire():
    """Reached only with a key, and the one test that asked for it had no key.

    The SDK calls `/v1/goals` while establishing a client, so a double that 404s it cannot
    stand in for the platform at all. The existing test sends no key and gets a 401 before
    this line is reached, which is why deleting the route cost nothing.
    """
    with running() as base:
        status, body = call(f"{base}/v1/goals")
    assert status == 200
    assert body == {"object": "list", "data": [], "next_cursor": None}


# ---------------------------------------------------------------------------
# calle_double/transport.py:57 -- the in-process transport's goals route
# ---------------------------------------------------------------------------

def test_the_in_process_transport_answers_the_goals_route_too(double):
    """The only guard in the sweep that no test executed even once.

    The two transports have to agree, because every offline test runs through this one and
    every claim about the standalone server is made about the other. This route existed in
    both and was reachable in neither.
    """
    import httpx

    from calle_double.transport import BASE_URL

    with httpx.Client(transport=build_transport(double), base_url=BASE_URL) as http:
        response = http.get("/v1/goals")
    assert response.status_code == 200
    assert response.json() == {"object": "list", "data": [], "next_cursor": None}


# ---------------------------------------------------------------------------
# calle_double/regions.py:96 -- resolve. Recorded, not killed. See the module docstring.
# ---------------------------------------------------------------------------

def test_a_number_that_is_not_e164_resolves_to_no_region():
    """Behaviour worth pinning even though the guard above it is redundant.

    Every calling code in the table starts with `+`, so a number without one matches no
    prefix and the loop returns None with or without the early return. That was confirmed
    by deleting the guard and watching this pass. It is kept because the answer matters:
    an unresolvable number becomes `unsupported_region`, which the dispatcher treats as
    permanent and never retries.
    """
    assert regions.resolve(IN_A.lstrip("+")) is None
    assert regions.resolve("") is None
    assert regions.resolve("not a number") is None
    assert regions.resolve(IN_A) is not None, "a real E.164 number must still resolve"


# ---------------------------------------------------------------------------
# calle_double/server.py -- the bind. Not a guard that existed and went untested: a
# guard that did not exist. A security pass on 7 September found the double accepts any
# bearer token, on purpose, and would bind anywhere it was told to, by default.
# ---------------------------------------------------------------------------

def test_a_bind_only_this_machine_can_reach_needs_no_permission():
    """The default has to stay silent, or the refusal becomes noise people learn to pass.

    Four spellings of the same interface. `localhost` is here because it is what an
    operator types, and refusing it would teach them to reach for the override on a bind
    that was never open.
    """
    for host in ("127.0.0.1", "127.0.0.53", "::1", "localhost"):
        server.refuse_an_open_bind(host, acknowledged=False)
        assert server.is_loopback(host), f"{host} reaches this machine and nothing else"


def test_a_bind_other_machines_can_reach_is_refused_until_it_is_asked_for():
    """The finding this closes: `--host 0.0.0.0` on a server that authorises anybody.

    Any non-empty bearer token is accepted, which is correct for a double and is what
    lets a judge run the whole entry with no CALL-E account. It also means the interface
    is the only thing keeping the server private. The refusal names the host, says what
    is reachable, and says how to proceed anyway, because the data is fictional and an
    operator who wants a reachable double has a real reason to.
    """
    for host in ("0.0.0.0", "192.168.1.9", "::", "example.internal"):
        with pytest.raises(SystemExit) as refused:
            server.refuse_an_open_bind(host, acknowledged=False)
        message = str(refused.value)
        assert host in message, "a refusal that does not name the host is a puzzle"
        assert "--i-know-this-is-open" in message, (
            "the refusal has to say how to proceed, or it reads as a bug in the tool"
        )


def test_an_operator_who_says_they_meant_it_is_not_argued_with():
    """An override that still refuses is an override nobody trusts twice."""
    server.refuse_an_open_bind("0.0.0.0", acknowledged=True)


def test_a_hostname_this_cannot_read_is_refused_rather_than_opened():
    """Which way to be wrong.

    `is_loopback` reads addresses, not DNS. A name it cannot parse could resolve to the
    machine itself or to anything at all, and it will not find out. Refusing costs an
    operator one flag; opening costs them a server they did not know was reachable.
    """
    assert not server.is_loopback("loopback.example.com")
    assert not server.is_loopback("127.0.0.1.evil.test")
    with pytest.raises(SystemExit):
        server.refuse_an_open_bind("loopback.example.com", acknowledged=False)


def test_the_flag_reaches_the_refusal_from_the_command_line():
    """The parser and the guard, together, because either alone can be right and useless.

    A guard nothing calls is decoration, and the way that happens is a flag named one
    thing in `add_argument` and read as another. This drives `main` the way an operator
    does, with the arguments on the command line.
    """
    import subprocess
    import sys

    refused = subprocess.run(
        [sys.executable, "-m", "calle_double.server", "--host", "0.0.0.0", "--port", "0"],
        cwd=str(APP), capture_output=True, text=True, timeout=60,
    )
    assert refused.returncode != 0, "the process bound anyway"
    assert "--i-know-this-is-open" in refused.stderr, refused.stderr[-400:]
