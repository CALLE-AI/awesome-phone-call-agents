# -*- coding: utf-8 -*-
"""Witnesses for the file that dials. Still no call, no network, no key.

    python tests_place_call.py

`place_call.place` takes its transport as a parameter, so every path through it
can be exercised with a stub that records what would have left the machine.
The witnesses below assert as much about what is NOT sent as about what is.
"""
from __future__ import annotations
import contextlib
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import place_call                                                # noqa: E402
from bridge import NothingToAsk                                  # noqa: E402
from place_call import collect, main, place, Refused             # noqa: E402

NUM = "+33000000000"          # fictional, never dialled by these tests
KEY = "not-a-key"


class Transport:
    """Records calls instead of making them."""

    def __init__(self, status=201, payload=None):
        self.status, self.payload, self.sent = status, payload or {}, []

    def __call__(self, url, key, body, timeout=45):
        self.sent.append({"url": url, "key": key,
                          "body": json.loads(body) if body else None})
        return self.status, self.payload


class NothingLeavesTheMachine(unittest.TestCase):

    def test_a_missing_key_stops_the_run_before_the_task_is_built(self):
        """A 401 from the provider reads like a permissions problem and sends
        you looking in the wrong place. This one says what is wrong."""
        transport = Transport()
        os.environ.pop("CALLE_API_KEY", None)
        with self.assertRaises(Refused):
            place(NUM, "students only", "Students only", "t", send=transport)
        self.assertEqual(transport.sent, [])

    def test_a_clause_outside_the_families_is_never_dialled(self):
        transport = Transport()
        with self.assertRaises(NothingToAsk):
            place(NUM, "no such family", "anything", "t", key=KEY, send=transport)
        self.assertEqual(transport.sent, [])

    def test_a_schema_the_provider_cannot_fill_is_refused_here(self):
        """The provider accepts a malformed schema at creation and fails only
        at extraction, once the call and someone's minute are spent."""
        transport = Transport()
        original = place_call.call_task
        place_call.call_task = lambda *a, **k: {
            "family": "students only", "quote": "q", "task": "t",
            "result_schema": {"type": "object", "properties": {"x": {"$ref": "#/nope"}},
                              "required": ["x"], "additionalProperties": False}}
        try:
            with self.assertRaises(Refused):
                place(NUM, "students only", "Students only", "t", key=KEY, send=transport)
        finally:
            place_call.call_task = original
        self.assertEqual(transport.sent, [])

    def test_the_command_line_without_a_number_asks_and_sends_nothing(self):
        aide = io.StringIO()
        with contextlib.redirect_stdout(aide):
            code = main([])
        self.assertEqual(code, 2)
        self.assertIn('--to', aide.getvalue())


class WhatIsActuallySent(unittest.TestCase):

    def test_one_request_carrying_the_task_and_the_schema(self):
        transport = Transport(201, {"id": "call_x", "status": "queued"})
        prepared, payload = place(NUM, "students only", "Students only", "t",
                                  key=KEY, send=transport)
        self.assertEqual(len(transport.sent), 1)
        sent = transport.sent[0]
        self.assertEqual(sent["url"], place_call.CALLS)
        self.assertEqual(sent["key"], KEY)
        self.assertEqual(sorted(sent["body"]), ["result_schema", "task"])
        self.assertIn(NUM, sent["body"]["task"])
        self.assertEqual(payload["id"], "call_x")
        self.assertEqual(prepared["family"], "students only")

    def test_the_key_never_reaches_the_body(self):
        transport = Transport(201, {"id": "call_x"})
        place(NUM, "students only", "Students only", "t", key=KEY, send=transport)
        self.assertNotIn(KEY, json.dumps(transport.sent[0]["body"]))

    def test_a_refusal_from_the_provider_is_raised_and_not_swallowed(self):
        transport = Transport(402, {"error": "out of calls"})
        with self.assertRaises(Refused):
            place(NUM, "students only", "Students only", "t", key=KEY, send=transport)


class ReadingTheCallBack(unittest.TestCase):

    def test_without_the_prepared_task_it_returns_the_payload_alone(self):
        transport = Transport(200, {"id": "call_x", "status": "completed"})
        self.assertEqual(collect("call_x", key=KEY, send=transport)["status"], "completed")

    def test_with_it_a_cancelling_answer_becomes_a_contradiction(self):
        prepared = place(NUM, "students only", "Students only", "t", key=KEY,
                         send=Transport(201, {"id": "call_x"}))[0]
        transport = Transport(200, {"structured_result": {
            "open_to_non_students": "yes", "their_words": "anyone can enter"}})
        _, found = collect("call_x", prepared, key=KEY, send=transport)
        self.assertIn("the opposite", found)
        self.assertIn("anyone can enter", found)

    def test_an_unknown_answer_is_not_a_contradiction(self):
        """The absence of an answer is not a denial, and a tool that reports it
        as one manufactures evidence."""
        prepared = place(NUM, "students only", "Students only", "t", key=KEY,
                         send=Transport(201, {"id": "call_x"}))[0]
        transport = Transport(200, {"structured_result": {"open_to_non_students": "unknown"}})
        self.assertIsNone(collect("call_x", prepared, key=KEY, send=transport)[1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
