"""Tests for the CALL-E double.

The most important test in here is `test_enums_match_the_real_sdk`. Everything else
checks that the double behaves; that one checks that the behaviour is the *right* shape,
by comparing against the enums the installed SDK actually ships rather than against my
transcription of them. If CALL-E changes its surface, that test fails and the double
stops being a lie.
"""

from __future__ import annotations

import pytest

from calle_double import (
    API_ERROR_CODES,
    ATTEMPT_SIP_CODES,
    ATTEMPT_STATUSES,
    CALL_STATUSES,
    RECIPIENT_STATUSES,
    WEBHOOK_EVENTS,
    CalleDouble,
    Outcome,
    build_client,
)
from calle_double import regions


CONFIRMED = {"reason": "illness", "expected_return": "2026-09-08"}
CHAT = [("bot", "Calling about this morning."), ("user", "He is unwell, back Monday.")]


@pytest.fixture
def double() -> CalleDouble:
    return CalleDouble()


@pytest.fixture
def client(double: CalleDouble):
    return build_client(double)


# --------------------------------------------------------------------------
# Fidelity: does the double describe the same platform the SDK does?
# --------------------------------------------------------------------------

def test_enums_match_the_real_sdk():
    from calle.generated.models.call_status import CALL_STATUS_VALUES
    from calle.generated.models.recipient_status import RECIPIENT_STATUS_VALUES
    from calle.generated.models.attempt_status import ATTEMPT_STATUS_VALUES
    from calle.generated.models.webhook_event_type import WEBHOOK_EVENT_TYPE_VALUES
    from calle.generated.models.api_error_code import API_ERROR_CODE_VALUES

    assert set(CALL_STATUSES) == set(CALL_STATUS_VALUES)
    assert set(RECIPIENT_STATUSES) == set(RECIPIENT_STATUS_VALUES)
    assert set(ATTEMPT_STATUSES) == set(ATTEMPT_STATUS_VALUES)
    assert set(WEBHOOK_EVENTS) == set(WEBHOOK_EVENT_TYPE_VALUES)
    assert set(API_ERROR_CODES) == set(API_ERROR_CODE_VALUES)


def test_india_supports_tamil_and_australia_does_not():
    assert regions.supports_language(regions.REGIONS["IN"], "Tamil")
    assert regions.supports_language(regions.REGIONS["IN"], "Hindi")
    assert not regions.supports_language(regions.REGIONS["AU"], "Tamil")
    assert "LK" in regions.TAMIL_REGIONS and "IN" in regions.TAMIL_REGIONS


def test_calling_code_resolution_prefers_the_longer_prefix():
    # +91 must not be swallowed by +1.
    #
    # Every subscriber part here is a 555 run, which is the convention the rest of this
    # repository uses for a number that cannot be dialled: Singapore has no 5-prefixed
    # mobile range and neither does Sri Lanka. This test reads the country code and
    # nothing else, so the digits after it were arbitrary, and `+6591234567` is a
    # perfectly ordinary Singapore mobile that somebody almost certainly owns.
    assert regions.resolve("+9155500001").code == "IN"
    assert regions.resolve("+6555500000").code == "SG"
    assert regions.resolve("+9455500000").code == "LK"
    assert regions.resolve("+99912345") is None


# --------------------------------------------------------------------------
# The three terminal outcomes
# --------------------------------------------------------------------------

def test_answered_returns_a_schema_valid_result(double, client):
    """Where the result lands is decided by which schema the request carried.

    This test used to send no schema at all and still assert that a schema-valid result
    came back, off the per-recipient field. Both halves were wrong, and the double was
    covering for them: there is nothing to extract against without a schema, and the
    per-recipient field belongs to `recipient_result_schema`, which this call does not send.
    Every call this project places sends `result_schema`, so this is the shape that matters.
    """
    double.set_outcome("+9155500001", Outcome.answered(CONFIRMED, CHAT))
    created = client.calls.create(
        task="Ask why the student is absent.",
        recipient={"phone": "+9155500001"},
        result_schema={"type": "object", "required": ["reason"]},
    )
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    assert final["status"] == "completed"
    assert final["structured_result"] == CONFIRMED
    assert final["recipients"][0]["structured_result"] is None, (
        "no recipient_result_schema was sent, so there is no per-recipient result to give"
    )
    turns = final["recipients"][0]["attempts"][0]["transcript_turns"]
    assert [t["speaker"] for t in turns] == ["bot", "user"]
    assert turns[1]["text"].startswith("He is unwell")


def test_no_answer_is_a_failure_not_an_empty_success(double, client):
    double.set_outcome("+9155500001", Outcome.no_answer())
    created = client.calls.create(task="Ask.", recipient={"phone": "+9155500001"})
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    assert final["status"] == "failed"
    assert final["recipients"][0]["status"] == "failed"
    # An attempt carries the numeric SIP code, not our symbolic name for the outcome. The
    # one unanswered call this project recorded came back 603, and the double said
    # "no_answer" here until the two were compared.
    assert final["recipients"][0]["attempts"][0]["failure_code"] == "603"
    assert final["failure_code"] == "call_failed", "the task level speaks the other vocabulary"


def test_completed_with_null_result_is_a_distinct_third_outcome(double, client):
    """The state that breaks naive code: the call succeeded and there is no answer."""
    double.set_outcome("+9155500001", Outcome.ambiguous(
        [("bot", "Why was she absent?"), ("user", "Let me check with her mother.")]
    ))
    created = client.calls.create(
        task="Ask.", recipient={"phone": "+9155500001"},
        webhook_url="https://example.test/hook",
    )
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    assert final["status"] == "completed"
    assert final["recipients"][0]["structured_result"] is None
    assert final["recipients"][0]["status"] == "completed"
    # Anything that branches on status alone would now record this as contacted.
    assert [w["type"] for w in double.delivered_webhooks] == ["call.result_validation_failed"]


# --------------------------------------------------------------------------
# The fallback chain
# --------------------------------------------------------------------------

def test_second_guardian_answers_when_the_first_does_not(double, client):
    double.set_outcome("+9155500001", Outcome.answered(CONFIRMED, CHAT, answers_on=1))
    created = client.calls.create(
        task="Ask.",
        recipients=[{"phones": ["+9155500001", "+9155500002"]}],
    )
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    recipient = final["recipients"][0]
    assert recipient["status"] == "completed"
    assert len(recipient["attempts"]) == 2
    assert recipient["attempts"][0]["failure_code"] == "603"
    assert recipient["attempts"][1]["status"] == "completed"
    assert double.dialled == ["+9155500001", "+9155500002"]


def test_exhausting_every_number_fails_the_recipient(double, client):
    double.set_outcome("+9155500001", Outcome.no_answer())
    created = client.calls.create(
        task="Ask.",
        recipients=[{"phones": ["+9155500001", "+9155500002", "+9155500003"]}],
    )
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    assert final["status"] == "failed"
    assert len(final["recipients"][0]["attempts"]) == 3
    assert len(double.dialled) == 3


# --------------------------------------------------------------------------
# Fan-out
# --------------------------------------------------------------------------

def test_one_task_many_recipients_each_with_its_own_outcome(double, client):
    double.set_outcome("+9155500001", Outcome.answered(CONFIRMED, CHAT))
    double.set_outcome("+9155500002", Outcome.no_answer())
    double.set_outcome("+9155500003", Outcome.ambiguous([("user", "Who is this?")]))

    created = client.calls.create(
        task="Ask each family why their child is absent.",
        recipients=[
            {"phones": ["+9155500001"], "locale": "ta-IN", "region": "IN"},
            {"phones": ["+9155500002"], "locale": "hi-IN", "region": "IN"},
            {"phones": ["+9155500003"], "locale": "en-IN", "region": "IN"},
        ],
        recipient_result_schema={"type": "object", "required": ["reason"]},
    )
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    statuses = [r["status"] for r in final["recipients"]]
    assert statuses == ["completed", "failed", "completed"]
    results = [r["structured_result"] for r in final["recipients"]]
    assert results == [CONFIRMED, None, None]
    # Three recipients means three billed calls, not one. Worth asserting so nobody
    # forgets while writing a batch runner.
    assert len(double.dialled) == 3


# --------------------------------------------------------------------------
# Idempotency
# --------------------------------------------------------------------------

def test_same_key_and_same_body_does_not_dial_twice(double, client):
    double.set_outcome("+9155500001", Outcome.answered(CONFIRMED, CHAT))
    args = dict(task="Ask.", recipient={"phone": "+9155500001"})
    first = client.calls.create(**args, idempotency_key="student-42-2026-09-05")
    second = client.calls.create(**args, idempotency_key="student-42-2026-09-05")

    assert first["id"] == second["id"]
    client.calls.wait_for_result(first["id"], interval_seconds=0)
    assert double.dialled == ["+9155500001"]


def test_same_key_with_a_different_body_is_a_conflict(double, client):
    from calle import CalleAPIError

    client.calls.create(task="Ask.", recipient={"phone": "+9155500001"},
                        idempotency_key="k1")
    with pytest.raises(CalleAPIError) as caught:
        client.calls.create(task="Something else entirely.",
                            recipient={"phone": "+9155500001"},
                            idempotency_key="k1")
    assert caught.value.code == "idempotency_conflict"
    assert caught.value.status_code == 409


# --------------------------------------------------------------------------
# Rejections the real API performs
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "kwargs, expected",
    [
        (dict(task="Ask.", recipient={"phone": "0412345678"}), "invalid_phone"),
        (dict(task="Ask.", recipient={"phone": "+99912345678"}), "unsupported_region"),
        (dict(task="Ask.", recipients=[]), "no_recipients"),
        (dict(task="   ", recipient={"phone": "+9155500001"}), "invalid_request"),
        (dict(task="Ask.", recipient={"phone": "+61412345678", "locale": "ta-AU"}),
         "unsupported_language"),
    ],
)
def test_bad_requests_are_rejected_with_real_error_codes(client, kwargs, expected):
    from calle import CalleAPIError

    with pytest.raises(CalleAPIError) as caught:
        client.calls.create(**kwargs)
    assert caught.value.code == expected


def test_tamil_to_india_is_accepted(client):
    created = client.calls.create(
        task="Ask.",
        recipient={"phone": "+9155500001", "locale": "ta-IN"},
    )
    assert created["status"] == "queued"


def test_injected_platform_failures_surface_as_real_codes(double, client):
    from calle import CalleAPIError

    double.fail_next_request("insufficient_balance",
                             "The project cannot start more calls until billing is resolved.")
    with pytest.raises(CalleAPIError) as caught:
        client.calls.create(task="Ask.", recipient={"phone": "+9155500001"})
    assert caught.value.code == "insufficient_balance"

    # The failure is consumed, so the next request goes through.
    assert client.calls.create(
        task="Ask.", recipient={"phone": "+9155500001"})["status"] == "queued"


# --------------------------------------------------------------------------
# Cancellation, which the real API does not offer at all
# --------------------------------------------------------------------------

def test_cancel_stops_recipients_that_have_not_been_dialled(double, client):
    double.set_default_outcome(Outcome.answered(CONFIRMED, CHAT))
    created = client.calls.create(
        task="Ask each family.",
        recipients=[{"phones": [f"+9155500000{i}"]} for i in range(1, 5)],
    )
    double.tick(created["id"])          # one recipient handled
    double.cancel(created["id"])

    final = client.calls.get(created["id"])
    assert final["status"] == "canceled"
    assert [r["status"] for r in final["recipients"]].count("skipped") == 3
    assert len(double.dialled) == 1


def test_events_paginate(double, client):
    created = client.calls.create(task="Ask.", recipient={"phone": "+9155500001"})
    client.calls.wait_for_result(created["id"], interval_seconds=0)

    page = client.calls.list_events(created["id"], limit=1)
    assert len(page["data"]) == 1
    assert page["next_cursor"] == "1"
    page2 = client.calls.list_events(created["id"], cursor=page["next_cursor"], limit=50)
    assert page2["data"]


def test_status_codes_map_onto_the_sdk_error_subclasses(double, client):
    """401/403 become CalleAuthenticationError and 429 becomes CalleRateLimitError.

    Anything retrying on rate limits branches on those subclasses, so the double has to
    produce the status codes that create them.
    """
    from calle import CalleAuthenticationError, CalleRateLimitError

    double.fail_next_request("rate_limit_exceeded", "Slow down.", status_code=429)
    with pytest.raises(CalleRateLimitError):
        client.calls.create(task="Ask.", recipient={"phone": "+9155500001"})

    double.fail_next_request("forbidden", "No access to that region.", status_code=403)
    with pytest.raises(CalleAuthenticationError):
        client.calls.create(task="Ask.", recipient={"phone": "+9155500001"})


# --------------------------------------------------------------------------
# The standalone server, for clients that cannot use an in-process transport
# --------------------------------------------------------------------------

def test_the_http_server_serves_the_real_sdk_over_the_wire():
    """A real CalleClient pointed at a real socket, still dialling nobody."""
    import socket
    from calle import CalleClient
    from calle_double.server import serve

    with socket.socket() as probe:      # let the OS pick a free port
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    engine = CalleDouble()
    engine.set_outcome("+9155500001", Outcome.answered(CONFIRMED, CHAT))
    server = serve(engine, port=port)
    try:
        client = CalleClient(api_key="iams_test_anything",
                             base_url=f"http://127.0.0.1:{port}")
        created = client.calls.create(
            task="Ask.", recipient={"phone": "+9155500001"},
            result_schema={"type": "object", "required": ["reason"]})
        final = client.calls.wait_for_result(created["id"], interval_seconds=0)
        assert final["status"] == "completed"
        # Task level, because the request carries result_schema and not
        # recipient_result_schema. Same rule over a real socket as in process.
        assert final["structured_result"] == CONFIRMED
        assert engine.dialled == ["+9155500001"]
    finally:
        server.shutdown()


def test_the_http_server_rejects_a_missing_api_key():
    import socket
    import urllib.error
    import urllib.request
    from calle_double.server import serve

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = serve(CalleDouble(), port=port)
    try:
        request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/goals")
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=5)
        assert caught.value.code == 401
        import json as _json
        assert _json.loads(caught.value.read())["error"]["code"] == "unauthorized"
    finally:
        server.shutdown()


# --------------------------------------------------------------------------
# Concurrency. The HTTP server is threaded, so the engine has to be safe, and a
# wave scheduler needs something to assert its concurrency cap against.
# --------------------------------------------------------------------------

def test_concurrent_creates_do_not_lose_or_collide():
    """Hammer create from many threads; every call must survive with a unique id."""
    import concurrent.futures

    double = CalleDouble(latency_seconds=0.01)
    double.set_default_outcome(Outcome.answered(CONFIRMED, CHAT))
    client = build_client(double)
    count = 60

    def make(i: int) -> str:
        return client.calls.create(
            task=f"Ask family {i}.",
            recipient={"phone": f"+9155500000{i:05d}"},
        )["id"]

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        ids = list(pool.map(make, range(count)))

    assert len(ids) == count, "a create was lost"
    assert len(set(ids)) == count, f"id collision: {count - len(set(ids))} duplicates"
    assert double.peak_in_flight == count


def test_peak_in_flight_lets_a_scheduler_prove_its_concurrency_cap():
    """A wave scheduler capped at N must never have more than N calls open.

    The double records the peak, so the assertion is about observed behaviour rather
    than about the scheduler's own bookkeeping, which is the whole point: a scheduler
    that miscounts its own semaphore would still pass a self-reported check.
    """
    import concurrent.futures
    import threading

    double = CalleDouble(latency_seconds=0.01)
    double.set_default_outcome(Outcome.answered(CONFIRMED, CHAT))
    client = build_client(double)
    cap = 4
    gate = threading.Semaphore(cap)

    def one_call(i: int) -> None:
        with gate:                                    # this is the cap under test
            created = client.calls.create(
                task=f"Ask family {i}.",
                recipient={"phone": f"+9155500001{i:05d}"},
            )
            client.calls.wait_for_result(created["id"], interval_seconds=0)

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(one_call, range(40)))

    assert double.peak_in_flight <= cap, (
        f"scheduler exceeded its cap: peak {double.peak_in_flight} > {cap}"
    )
    assert len(double.dialled) == 40


def test_an_uncapped_dispatcher_is_caught_by_the_same_check():
    """The cap assertion above is only meaningful if it can fail. This proves it does."""
    import concurrent.futures

    engine = CalleDouble(latency_seconds=0.01)
    engine.set_default_outcome(Outcome.answered(CONFIRMED, CHAT))
    client = build_client(engine)

    def one_call(i: int) -> None:
        created = client.calls.create(
            task=f"Ask family {i}.",
            recipient={"phone": f"+9155500002{i:05d}"},
        )
        client.calls.wait_for_result(created["id"], interval_seconds=0)

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(one_call, range(40)))

    assert engine.peak_in_flight > 4, (
        "an uncapped dispatcher should blow past a cap of 4; if this fails the "
        "peak_in_flight metric is not measuring anything"
    )# --------------------------------------------------------------------------
# Does this double still look like the real thing
# --------------------------------------------------------------------------

def test_the_double_emits_every_field_the_real_api_returns():
    """The shape of the double, checked against the shape production actually sent.

    `test_enums_match_the_real_sdk` next door does this for the vocabulary. This does it
    for the response body, and it is here because the answer was no. Four task-level
    fields the API returns on every response were missing from the double, one of them
    (`failure_code`) asserted on by a test that could therefore only ever run against a
    recorded response. Offline, nothing noticed for the life of the project.

    The comparison is deliberately lopsided. The left side is computed now, by driving
    this double through every outcome it has. The right side is read from
    `evidence/api-shape.json`, which was recorded from real responses held outside this
    repository. So the recorded half is data and the live half is the thing under test,
    and editing the double cannot make its own gate agree with it. A record that also
    supplied the current behaviour would pass forever.

    Extra paths in the double are fine: it models more than any eleven responses reached.
    A path production returns and the double never emits is not fine, because code can
    depend on it and every offline test would still be green.
    """
    import json
    from pathlib import Path
    import sys

    app = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(app))
    from tools.double_conformance import double_paths

    record_path = app / "evidence" / "api-shape.json"
    assert record_path.exists(), (
        "evidence/api-shape.json is the recorded shape of the production API and this "
        "test has nothing to check against without it"
    )
    record = json.loads(record_path.read_text(encoding="utf-8"))
    recorded = record["api_paths"]
    assert len(recorded) > 20, (
        f"only {len(recorded)} recorded paths, which is too few to be the real response "
        "shape; the record was probably regenerated against an empty sample"
    )
    assert record["responses_compared"] >= 11, (
        "the record claims fewer responses than were recorded, so it is not the one "
        "this project measured"
    )

    mine = {path: sorted(types) for path, types in double_paths().items()}

    missing = sorted(set(recorded) - set(mine))
    assert not missing, (
        "the production API returns these and the double never emits them, so no offline "
        f"test can reach them: {missing}"
    )

    disagreed = sorted(
        f"{path}: API sent {recorded[path]}, double sends {mine[path]}"
        for path in set(recorded) & set(mine)
        if not set(recorded[path]) & set(mine[path])
    )
    assert not disagreed, disagreed


def test_an_attempt_carries_a_sip_code_and_the_task_carries_a_name(double, client):
    """Two vocabularies, one per level, and the double used to speak only one.

    A path-and-type comparison cannot catch this: both levels hold a string either way.
    The double sent its own symbolic name on the attempt where production sends a numeric
    SIP code, and the dispatcher's SIP table missed it, so the same unanswered call
    produced one message offline and a different one against the real response.
    """
    double.set_outcome("+9155500001", Outcome.no_answer())
    created = client.calls.create(task="Ask.", recipient={"phone": "+9155500001"},
                                  result_schema={"type": "object", "required": ["reason"]})
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    attempt_code = final["recipients"][0]["attempts"][0]["failure_code"]
    assert attempt_code.isdigit(), (
        f"an attempt should carry a numeric SIP code, not {attempt_code!r}"
    )
    assert final["failure_code"] == "call_failed"
    assert final["failure_code"] not in ATTEMPT_SIP_CODES, (
        "the task level speaks the symbolic vocabulary, not the wire one"
    )


def test_a_busy_line_and_a_switched_off_handset_can_still_be_modelled(double, client):
    """One recorded code is one recorded code, so the others stay reachable and unclaimed.

    Everything this project received back was 603. The API documents more, the dispatcher
    translates more, and a double that could only produce the one code we happened to get
    would make those translations untestable.
    """
    double.set_outcome("+9155500001", Outcome.no_answer(sip_code="486"))
    created = client.calls.create(task="Ask.", recipient={"phone": "+9155500001"},
                                  result_schema={"type": "object", "required": ["reason"]})
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)
    assert final["recipients"][0]["attempts"][0]["failure_code"] == "486"


# --------------------------------------------------------------------------
# The clock, which is a field a consumer compares against its own
# --------------------------------------------------------------------------

def test_the_clock_does_not_drift_away_from_the_caller_on_a_large_run():
    """A hundred and fifty rows must not turn a known provenance into an unknown one.

    The double advanced one shared clock 30 simulated seconds per step and never pulled it
    back, so `created_at` ran ahead of the caller's real clock in proportion to the number
    of calls. Past roughly a hundred it crossed the one-hour skew guard the dispatcher uses
    in `_was_placed_now`, which then answers None: 0 unknown at 60 rows, 138 of 200. The
    demonstration file has seven rows, so nothing showed it, and `--max-calls` exists
    precisely to invite the bigger run.

    Reported as unknown is the honest answer to a question that cannot be answered, and
    here it was answerable. The clock was the only thing making it not so.
    """
    from dispatch import WaveDispatcher, WorkItem

    double = CalleDouble()
    double.set_default_outcome(Outcome.answered(CONFIRMED, CHAT))
    items = [WorkItem(id=f"S-{i}", phones=(f"+9155500{i:05d}",)) for i in range(150)]
    report = WaveDispatcher(
        build_client(double), task_builder=lambda i: "Ask.",
        result_schema={"type": "object", "required": ["reason"],
                       "properties": {"reason": {"type": "string"}}},
        concurrency=4, poll_interval_seconds=0, sleep=lambda _s: None,
    ).run(items)

    unknown = [r.item.id for r in report.results if r.placed_by_this_run is None]
    assert not unknown, (
        f"{len(unknown)} of {len(items)} calls came back with an unknown provenance, so "
        "the double's clock has drifted out of the window the consumer compares against")
    assert all(r.placed_by_this_run is True for r in report.results)


def test_a_pinned_clock_still_gives_the_same_timestamps_every_run():
    """The fix must not cost the determinism a test asks for with `now=`."""
    from datetime import datetime, timezone

    pinned = datetime(2026, 9, 14, 8, 30, tzinfo=timezone.utc)
    stamps = []
    for _ in range(2):
        double = CalleDouble(now=pinned)
        double.set_default_outcome(Outcome.answered(CONFIRMED, CHAT))
        client = build_client(double)
        made = [client.calls.create(task="Ask.", recipients=[{"phones": [phone]}],
                                   result_schema=None)
                for phone in ("+915550000001", "+915550000002")]
        stamps.append([call["created_at"] for call in made])

    assert stamps[0] == stamps[1], "a pinned double stopped being deterministic"
    assert all(s.startswith("2026-09-14T08:30") for s in stamps[0]), stamps[0]


@pytest.mark.parametrize("phone", [
    "+91 5550 000001",   # the one an office spreadsheet produces
    "+91-5550-000001",
    "915550000001",      # no plus at all
    "+01234567890",      # a country code starting at zero
    "+1555",             # too short to be anybody
    "+9155500000012345", # too long for E.164
    "+91555000000a",
])
def test_a_number_that_is_not_e164_is_refused_by_shape(client, phone):
    """The double called `startswith('+')` E.164, so a malformed number was dialled.

    A double exists so a class of production refusal can be met offline. A number the real
    service rejects for its shape was one this one could not show anybody, and the office
    spreadsheet that feeds this app is the likeliest source of a number typed with spaces.
    """
    from calle import CalleAPIError

    with pytest.raises(CalleAPIError) as raised:
        client.calls.create(task="Ask.", recipients=[{"phones": [phone]}],
                            result_schema=None)
    assert raised.value.code == "invalid_phone", raised.value.code


def test_the_numbers_this_repository_uses_are_still_accepted(client):
    """The check above must not refuse the reserved ranges every fixture here is built on."""
    for phone in ("+915550000001", "+15551000001", "+61455500000"):
        created = client.calls.create(task="Ask.", recipients=[{"phones": [phone]}],
                                      result_schema=None)
        assert created["id"]


def test_the_double_declares_which_sdk_release_it_was_checked_against():
    """A double carrying only its own version cannot say what it is pretending to be.

    `tools/double_conformance.py` compares these shapes against real API responses, and
    that comparison is only meaningful against a named release. `CONFORMS_TO` is that
    name, and it has to be the release this repository actually pins, or the double is
    declaring conformance to something nobody here has run.
    """
    from pathlib import Path

    import calle_double

    assert calle_double.__version__, "the double has no version of its own"
    assert calle_double.CONFORMS_TO.startswith("calle-ai=="), (
        f"CONFORMS_TO is {calle_double.CONFORMS_TO!r}, which does not name an SDK release"
    )
    pinned = [
        line.strip()
        for line in (Path(__file__).resolve().parent.parent / "requirements.txt")
        .read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("calle-ai==")
    ]
    assert pinned == [calle_double.CONFORMS_TO], (
        f"the double says it conforms to {calle_double.CONFORMS_TO} and "
        f"requirements.txt pins {pinned}"
    )
    assert calle_double.__version__ not in calle_double.CONFORMS_TO, (
        "the double's own version and the SDK release it mirrors are the same string, "
        "which is the confusion the two fields exist to prevent"
    )


def test_the_double_is_installable_on_its_own():
    """The claim is that a developer can take this without taking the app.

    Checked by reading the packaging rather than by building a wheel in a unit test. The
    trap it exists for is real and was shipped once: `packages.find` with `where = ["."]`,
    in a pyproject that sits inside the package directory, looks for `calle_double/` under
    `calle_double/` and builds an empty wheel that imports nothing.
    """
    import re
    from pathlib import Path

    import calle_double

    text = (Path(__file__).resolve().parent.parent / "calle_double" / "pyproject.toml"
            ).read_text(encoding="utf-8")
    assert 'name = "calle-double"' in text
    assert 'packages = ["calle_double"]' in text, (
        "the distribution does not name the package it ships"
    )
    assert re.search(r'^calle_double = "\."$', text, re.M), (
        "the package directory is not mapped to the pyproject's own directory, so the "
        "build looks for calle_double/calle_double/ and ships nothing"
    )
    assert 'version = { attr = "calle_double.__version__" }' in text, (
        "the version is written in the packaging as well as in the package, so the two "
        "can disagree"
    )
    assert 'email = "kesavk659@gmail.com"' in text
    for line in text.splitlines():
        if line.startswith("version = ") and "attr" not in line:
            raise AssertionError(f"a second, literal version: {line}")
