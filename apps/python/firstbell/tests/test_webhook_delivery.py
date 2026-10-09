"""The webhook path, end to end, with nothing mocked between the two ends.

`webhook_url` was accepted by the scheduler, forwarded to CALL-E on every `calls.create`,
and set by nobody. Two reviewers found it independently: one read `dispatch/scheduler.py`
and said polling scales badly beside an event, the other read the constructor and called
the parameter dead plumbing. A parameter that is forwarded and never supplied is worse than
one that does not exist, because it reads as a capability.

So it is supplied now, and this is the test that says it works rather than the docstring.
A real HTTP receiver, the real double, the real dispatcher: what arrives at the receiver is
whatever CALL-E's emulation decided to send, delivered over a socket.

The run still polls. That is deliberate and it is not a hedge. The report cannot be printed
until every call has reached a terminal state, and a webhook that has not arrived is not a
result. The event is for the district's own system, which wants to know at the moment the
call ends rather than whenever this process next looks.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from calle_double import CalleDouble, build_client
from calle_double.server import deliver_webhooks
from dispatch.models import WorkItem
from dispatch.scheduler import WaveDispatcher
from firstbell.cli import RESULT_SCHEMA, build_task
from firstbell.scenario import apply_demo_outcomes


class _Receiver(BaseHTTPRequestHandler):
    """A district's endpoint, near enough: it takes a POST and remembers it."""

    received: list[dict] = []

    def do_POST(self):  # noqa: N802  (the name is the interface)
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        _Receiver.received.append(json.loads(body.decode("utf-8")))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_args):
        """Silent. A test that prints one line per request buries its own failure."""


def _serve() -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Receiver)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/hook"


def _items() -> list[WorkItem]:
    return [
        WorkItem(id="S-9001", phones=("+15550000001",), locale="en-US",
                 context={"student_name": "A. Test", "absence_date": "2026-09-07",
                          "school_name": "the school"}),
        WorkItem(id="S-9002", phones=("+15550000002",), locale="en-US",
                 context={"student_name": "B. Test", "absence_date": "2026-09-07",
                          "school_name": "the school"}),
    ]


def test_calle_notifies_the_endpoint_the_run_was_told_to_use():
    _Receiver.received = []
    server, url = _serve()
    try:
        double = CalleDouble(latency_seconds=0.0)
        apply_demo_outcomes(double)
        dispatcher = WaveDispatcher(
            build_client(double),
            task_builder=build_task,
            result_schema=RESULT_SCHEMA,
            concurrency=2,
            poll_interval_seconds=0.0,
            webhook_url=url,
        )
        report = dispatcher.run(_items())
        assert len(report.results) == 2

        delivered = deliver_webhooks(double)
        assert delivered, (
            "the run asked CALL-E to notify an endpoint and the double queued nothing, so "
            "the url is being accepted and dropped"
        )
    finally:
        server.shutdown()

    kinds = {event["type"] for event in _Receiver.received}
    assert kinds, "nothing reached the receiver over the socket"
    assert kinds <= {"call.completed", "call.failed", "call.result_validation_failed"}, (
        f"the endpoint was sent an event kind nothing documents: {sorted(kinds)}"
    )
    # A receiver is handed an identifier and told to go and look, not handed the answer.
    # CALL-E's own webhooks are unsigned, so anything acted on directly out of a POST is
    # acted on without provenance, and the double reproduces that rather than the nicer
    # behaviour. This asserts the shape a receiver has to be written against.
    for event in _Receiver.received:
        assert "data" in event, f"an event with no data payload: {event}"
        assert event["data"].get("id"), (
            "an event a receiver cannot re-fetch from, which is the only safe way to use "
            "an unsigned one"
        )


def test_a_run_told_nothing_asks_for_nothing():
    """The default has to stay silent.

    Forwarding a `webhook_url` of `None` and having the double queue a delivery anyway
    would mean every offline demonstration was trying to POST somewhere. The rule is that
    nothing is sent unless somebody named a destination.
    """
    double = CalleDouble(latency_seconds=0.0)
    apply_demo_outcomes(double)
    dispatcher = WaveDispatcher(
        build_client(double),
        task_builder=build_task,
        result_schema=RESULT_SCHEMA,
        concurrency=2,
        poll_interval_seconds=0.0,
    )
    dispatcher.run(_items())
    assert double.delivered_webhooks == [], (
        "a run nobody gave an endpoint to queued a delivery anyway"
    )
