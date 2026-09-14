"""An unexpected response shape must not lose the call id or blame the family.

`_classify` and `_handle` were written against the shapes `calle_double` and the README's
sample run produce. A response CALL-E is free to send but the fake never exercises used to
raise out of `_handle` after the call id had already been dropped from `_in_flight`, so
`run()`'s generic handler recorded a placed, completed, billed call as FAILED with no id
anywhere in the report. The fix is that any such surprise becomes the third outcome,
UNDETERMINED, with the id kept. This file proves each shape that used to crash now does
that instead, and proves a non-JSON 5xx body is retried rather than failed on the spot.
"""

from __future__ import annotations

import json

import pytest

from dispatch import ItemResult, Resolution, RetryPolicy, WaveDispatcher, WorkItem
from tests.fixtures import IN_A

SCHEMA = {
    "type": "object",
    "required": ["reason"],
    "properties": {"reason": {"type": "string"}},
}
GOOD = {"reason": "illness"}


def _dispatcher(client, **kwargs):
    kwargs.setdefault("task_builder", lambda i: "x")
    kwargs.setdefault("result_schema", SCHEMA)
    kwargs.setdefault("poll_interval_seconds", 0)
    kwargs.setdefault("sleep", lambda _s: None)
    return WaveDispatcher(client, **kwargs)


def _client_returning(call_after_creation, call_id="call_9001"):
    """A client that accepts every create() and answers every get() with a fixed call."""
    class calls:
        @staticmethod
        def create(**kwargs):
            return {"id": call_id, "status": "queued"}

        @staticmethod
        def get(_call_id):
            return call_after_creation

    class Client:
        pass

    Client.calls = calls
    return Client()


def _run_one(client) -> ItemResult:
    report = _dispatcher(client).run([WorkItem(id="S-1", phones=(IN_A,))])
    return report.results[0]


# --------------------------------------------------------------------------
# Defect 3: an unexpected response shape reported a placed, completed, billed
# call as FAILED and lost its id.
# --------------------------------------------------------------------------

def test_a_create_response_without_an_id_is_undetermined_not_failed():
    """`call["id"]` raised KeyError here before the fix, caught by run()'s generic
    handler as `dispatcher error: KeyError: 'id'` and reported FAILED."""
    class calls:
        @staticmethod
        def create(**kwargs):
            return {"status": "queued"}  # no "id"

        @staticmethod
        def get(call_id):
            raise AssertionError("nothing to poll: the create response carried no id")

    class Client:
        pass

    Client.calls = calls
    result = _run_one(Client())

    assert result.resolution is Resolution.UNDETERMINED, (
        f"a call the service accepted came back {result.resolution.value}")
    assert result.call_id is None, "there was never an id to lose or keep"


def test_recipients_as_an_object_keyed_by_id_is_undetermined_with_the_call_id_kept():
    """`recipients[0]` raised `KeyError: 0` here before the fix, on a dict."""
    call = {
        "id": "call_9001", "status": "completed",
        "recipients": {"rec_1": {"attempts": [], "structured_result": GOOD}},
    }
    result = _run_one(_client_returning(call))

    assert result.resolution is Resolution.UNDETERMINED, (
        f"a completed, billed call came back {result.resolution.value}")
    assert result.call_id == "call_9001", "the id must survive the shape that broke it"


def test_recipients_as_a_bare_string_is_undetermined_with_the_call_id_kept():
    """`recipient.get(...)` raised `AttributeError` here before the fix: `recipients[0]`
    on a string is a character, and a character has no `.get`."""
    call = {"id": "call_9002", "status": "completed", "recipients": "no attempts recorded"}
    result = _run_one(_client_returning(call, call_id="call_9002"))

    assert result.resolution is Resolution.UNDETERMINED, (
        f"a completed, billed call came back {result.resolution.value}")
    assert result.call_id == "call_9002", "the id must survive the shape that broke it"


def test_attempts_as_a_list_of_strings_is_undetermined_with_the_call_id_kept():
    """`a.get("phone", "")` raised `AttributeError` here before the fix: each attempt was
    a plain string rather than a dict."""
    call = {
        "id": "call_9003", "status": "completed",
        "recipients": [{"attempts": ["ringing", "answered"]}],
    }
    result = _run_one(_client_returning(call, call_id="call_9003"))

    assert result.resolution is Resolution.UNDETERMINED, (
        f"a completed, billed call came back {result.resolution.value}")
    assert result.call_id == "call_9003", "the id must survive the shape that broke it"


# --------------------------------------------------------------------------
# Defect 4: a 5xx with a non-JSON body was not retried and was reported FAILED.
# --------------------------------------------------------------------------

def test_a_malformed_5xx_body_stops_submission_and_is_never_called_a_failure():
    """The SDK calls `response.json()` unconditionally on a 4xx/5xx. A proxy's own error
    page for a bad gateway is HTML, so this raised `json.JSONDecodeError`, which is
    neither `CalleAPIError` nor `CalleTimeoutError` nor `CalleConnectionError`, so it
    escaped both `except` clauses here on attempt one: zero retries, reported FAILED."""
    keys = []

    class calls:
        @staticmethod
        def create(**kwargs):
            keys.append(kwargs["idempotency_key"])
            raise json.JSONDecodeError("Expecting value", "<html>502 Bad Gateway</html>", 0)

        @staticmethod
        def get(call_id):
            raise AssertionError("creation never succeeded; nothing to poll")

    class Client:
        pass

    Client.calls = calls
    dispatcher = _dispatcher(Client(), retry=RetryPolicy(max_attempts=3))
    report = dispatcher.run([WorkItem(id="S-5", phones=(IN_A,))])
    result = report.results[0]

    assert len(keys) == 1, "a malformed submission response must stop automatic retries"
    assert result.possibly_placed_key == keys[0]
    assert result.resolution is Resolution.UNDETERMINED, (
        f"a request that may have reached CALL-E came back {result.resolution.value}")
# --------------------------------------------------------------------------
# Defect 4b: the same body, one layer lower. A reader with the platform's own SDK open
# pointed out that `response.json()` is `json.loads(self.content)` over raw bytes, so a
# body that is not valid UTF-8 raises `UnicodeDecodeError` before any JSON parsing starts.
# The clause fixed for defect 4 named only `json.JSONDecodeError`, so this one still
# escaped it and was reported FAILED: "nobody reached on any number", about a request that
# may have arrived and started a telephone ringing.
# --------------------------------------------------------------------------

def test_a_5xx_body_that_is_not_utf8_stops_and_is_never_called_a_failure():
    """A proxy error page in another encoding. `latin-1` bytes through `json.loads` raise
    UnicodeDecodeError, which is a ValueError and is not a JSONDecodeError."""
    keys = []

    class calls:
        @staticmethod
        def create(**kwargs):
            keys.append(kwargs["idempotency_key"])
            # What httpx does: json.loads over the raw body. The bytes are a real 502 page
            # from a proxy that answers in Latin-1, which is not valid UTF-8.
            json.loads("<html>502 Passerelle indisponible</html>".encode("latin-1")
                       .replace(b"i", b"\xe9"))
            raise AssertionError("those bytes decoded, so this test proves nothing")

        @staticmethod
        def get(call_id):
            raise AssertionError("creation never succeeded; nothing to poll")

    class Client:
        pass

    Client.calls = calls
    dispatcher = _dispatcher(Client(), retry=RetryPolicy(max_attempts=3))
    report = dispatcher.run([WorkItem(id="S-6", phones=(IN_A,))])
    result = report.results[0]

    assert len(keys) == 1, "an undecodable submission response must stop automatic retries"
    assert result.possibly_placed_key == keys[0]
    assert result.resolution is Resolution.UNDETERMINED, (
        f"a request that may have reached CALL-E came back {result.resolution.value}, "
        f"which prints as nobody reached on any number")
    assert "may have been placed" in result.reason, result.reason
