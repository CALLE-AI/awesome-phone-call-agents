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
    assert regions.resolve("+9155500001").code == "IN"
    assert regions.resolve("+6591234567").code == "SG"
    assert regions.resolve("+9412345678").code == "LK"
    assert regions.resolve("+99912345") is None


# --------------------------------------------------------------------------
# The three terminal outcomes
# --------------------------------------------------------------------------

def test_answered_returns_a_schema_valid_result(double, client):
    double.set_outcome("+9155500001", Outcome.answered(CONFIRMED, CHAT))
    created = client.calls.create(
        task="Ask why the student is absent.",
        recipient={"phone": "+9155500001"},
    )
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    assert final["status"] == "completed"
    assert final["recipients"][0]["structured_result"] == CONFIRMED
    turns = final["recipients"][0]["attempts"][0]["transcript_turns"]
    assert [t["speaker"] for t in turns] == ["bot", "user"]
    assert turns[1]["text"].startswith("He is unwell")


def test_no_answer_is_a_failure_not_an_empty_success(double, client):
    double.set_outcome("+9155500001", Outcome.no_answer())
    created = client.calls.create(task="Ask.", recipient={"phone": "+9155500001"})
    final = client.calls.wait_for_result(created["id"], interval_seconds=0)

    assert final["status"] == "failed"
    assert final["recipients"][0]["status"] == "failed"
    assert final["recipients"][0]["attempts"][0]["failure_code"] == "no_answer"


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
    assert recipient["attempts"][0]["failure_code"] == "no_answer"
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
        created = client.calls.create(task="Ask.", recipient={"phone": "+9155500001"})
        final = client.calls.wait_for_result(created["id"], interval_seconds=0)
        assert final["status"] == "completed"
        assert final["recipients"][0]["structured_result"] == CONFIRMED
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
    )
