"""Timing the CALL-E API does not return, recorded from the client side.

Why this exists. `evidence/api-shape.json` enumerates every key CALL-E sends back across
eleven production responses, and none of them is a duration. A call object carries
`started_at` and `completed_at` at one-second granularity and nothing else about time: no
ring, no answer, no first audio, no per-request latency, no signalling. So a question as
ordinary as "how long does `POST /v1/calls` take to come back" has no answer in the data
this project already holds, and neither does "how long after creation does a call reach
`in_progress`".

Both are answerable from outside. An HTTP round trip can be timed by the caller, and a
state machine can be watched by the thing polling it. That is all this module does.

What it deliberately does not record. No phone number, no `Authorization` header, no
request body, no transcript. A trace is an operational measurement and it is going to be
read by strangers; it holds a call id, a path, a status, a duration and an allowlist of
response headers. The number is in the work file and the receipt, both of which already
have a considered policy about who sees them, and copying it into a third file with a
looser one would quietly undo that.

Off unless asked. `FIRSTBELL_TRACE` names a file; absent, every function here returns
immediately and the dialler behaves exactly as it did before. A measurement harness that
is always on is a second code path that ships untested, and this one runs beside real
calls that cost money.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

# Response headers worth keeping. The rate-limit family is here because the SDK drops it
# before a caller can see it, which is a filed defect: a 429 that cannot say when to come
# back leaves a client guessing at a backoff the server already knows. Reading it at the
# transport is the only place left where the answer is still in the room, so a trace can
# settle whether the server sends one at all.
KEEP_HEADERS = (
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-request-id",
    "x-correlation-id",
)

_LOCK = threading.Lock()
_T0 = time.perf_counter()


def path() -> Path | None:
    """Where the trace goes, or None when tracing is off."""
    where = os.environ.get("FIRSTBELL_TRACE", "").strip()
    return Path(where) if where else None


def enabled() -> bool:
    return path() is not None


def _ms() -> float:
    """Milliseconds since this process started timing, to one decimal.

    A monotonic clock, because the question is always about an interval and a wall clock
    can step sideways mid-run. The wall clock is recorded separately so a line can still
    be lined up against a dashboard row afterwards.
    """
    return round((time.perf_counter() - _T0) * 1000, 1)


def record(event: str, **fields: Any) -> None:
    """One JSON object per line, appended under a lock.

    The dispatcher runs calls concurrently, so two threads reach this at once as a matter
    of course. Appending a whole line inside a lock is the cheapest thing that cannot
    interleave two half-written records.
    """
    where = path()
    if where is None:
        return
    line = {"at_ms": _ms(), "wall": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event}
    line.update(fields)
    blob = json.dumps(line, ensure_ascii=False, sort_keys=False)
    with _LOCK:
        where.parent.mkdir(parents=True, exist_ok=True)
        with where.open("a", encoding="utf-8") as fh:
            fh.write(blob + "\n")


def http_client(*, base_url: str, api_key: str, timeout: float):
    """An `httpx.Client` that times every request, for `CalleClient(http_client=...)`.

    The SDK takes one, which is the whole reason this can be done without patching a
    library or vendoring it. The hooks see the response before the SDK's own error
    handling runs, so a 4xx and a timeout are timed the same as a 200: the interesting
    latencies are the failures.
    """
    import httpx

    started: dict[int, float] = {}

    def on_request(request: "httpx.Request") -> None:
        started[id(request)] = time.perf_counter()

    def on_response(response: "httpx.Response") -> None:
        began = started.pop(id(response.request), None)
        # `response.read()` is not called here on purpose. The body belongs to the SDK and
        # a hook that consumes a stream breaks the caller; status, timing and headers are
        # what this is for, and the body arrives in the receipt anyway.
        record(
            "http",
            method=response.request.method,
            # The path only. A query string on this API carries no secret today, and
            # recording one that later does is a decision better not left to luck.
            path=response.request.url.path,
            status=response.status_code,
            ms=round((time.perf_counter() - began) * 1000, 1) if began else None,
            headers={k: v for k, v in response.headers.items()
                     if k.lower() in KEEP_HEADERS},
        )

    return httpx.Client(
        base_url=base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=timeout,
        event_hooks={"request": [on_request], "response": [on_response]},
    )


class Transitions:
    """Which statuses a call passed through, and when it first showed each one.

    Bounded by the poll interval and says so: a status held for less than one poll is
    invisible here, and the timestamp is when this client first *saw* the status, not
    when the platform entered it. At the two-second default that is a 2s box around every
    number, which is why the benchmark run polls faster and records the interval it used.
    """

    def __init__(self) -> None:
        self._seen: dict[str, str] = {}
        self._lock = threading.Lock()

    def saw(self, call_id: str, status: str | None) -> None:
        if not enabled() or not call_id or status is None:
            return
        with self._lock:
            if self._seen.get(call_id) == status:
                return
            was = self._seen.get(call_id)
            self._seen[call_id] = status
        record("status", call_id=call_id, was=was, now=status)
