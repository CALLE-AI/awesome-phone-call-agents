"""Tests for the MCP transport.

Every CLI invocation is stubbed, so nothing here plans, runs or dials.
"""

import json
import unittest

from certa.calle import Disposition, interpret
from certa.mcp import CLI_ENV, McpTransport
from certa.schema import derive_recipient_schema
from certa.transport import TransportError

from tests.test_airtable import FIELDS, SCHEMA
from certa.airtable import answer_columns

DERIVED = derive_recipient_schema(answer_columns(SCHEMA, FIELDS))
FICTIONAL = "+15550100471"


def envelope(body: dict) -> dict:
    return {"ok": True, "result": {"structuredContent": body}}


class Stub(McpTransport):
    """Records the commands that would have run, and replays canned output."""

    def __init__(self, replies):
        self.binary = "calle"
        self.timezone = ""
        self.runs = {}
        self._replies = list(replies)
        self.commands = []

    def _run(self, args, *, timeout):
        self.commands.append(args)
        return self._replies.pop(0)


def payload(phones=(FICTIONAL,), **extra):
    recipient = {"phones": list(phones)}
    recipient.update(extra)
    return {"task": "Call Kestrel Logistics to verify employment.", "recipients": [recipient]}


PLANNED = envelope({"plan_id": "pABC", "confirm_token": "cXYZ", "ready_to_run": True})
STARTED = envelope({"run_id": "run_123"})


class Placing(unittest.TestCase):
    def test_plan_then_run(self):
        t = Stub([PLANNED, STARTED])
        self.assertEqual(t.create_call(payload(), idempotency_key="k1")["id"], "run_123")
        self.assertEqual([c[1] for c in t.commands], ["plan", "run"])
        self.assertIn("--to-phone", t.commands[0])
        self.assertIn(FICTIONAL, t.commands[0])

    def test_region_and_language_are_passed_through(self):
        t = Stub([PLANNED, STARTED])
        t.create_call(payload(region="IN", locale="en-IN"), idempotency_key="k1")
        self.assertIn("--region", t.commands[0])
        self.assertIn("en-IN", t.commands[0])

    def test_a_plan_that_is_not_ready_never_runs(self):
        t = Stub([envelope({"ready_to_run": False, "clarifying_questions": ["Which branch?"]})])
        with self.assertRaises(TransportError) as ctx:
            t.create_call(payload(), idempotency_key="k1")
        self.assertIn("Which branch?", str(ctx.exception))
        self.assertEqual([c[1] for c in t.commands], ["plan"])

    def test_a_run_with_no_id_points_at_recover_rather_than_retry(self):
        t = Stub([PLANNED, envelope({})])
        with self.assertRaises(TransportError) as ctx:
            t.create_call(payload(), idempotency_key="k1")
        self.assertIn("recover", str(ctx.exception))

    def test_repeating_a_key_does_not_dial_again(self):
        """MCP has no idempotency header, so refuse rather than dial twice."""
        t = Stub([PLANNED, STARTED])
        first = t.create_call(payload(), idempotency_key="k1")
        second = t.create_call(payload(), idempotency_key="k1")
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second["replayed"])
        self.assertEqual(len(t.commands), 2, "no second plan or run")

    def test_several_recipients_are_refused_not_silently_truncated(self):
        t = Stub([])
        task = payload()
        task["recipients"].append({"phones": ["+15550102038"]})
        with self.assertRaises(TransportError) as ctx:
            t.create_call(task, idempotency_key="k")
        self.assertIn("one destination at a time", str(ctx.exception))

    def test_every_number_on_a_recipient_is_dialled_not_just_the_first(self):
        """Dropping the extras would silently narrow an authorised intent."""
        t = Stub([PLANNED, STARTED])
        t.create_call(payload(phones=[FICTIONAL, "+15550102038"]), idempotency_key="k")
        self.assertEqual(t.commands[0].count("--to-phone"), 2)
        self.assertIn("+15550102038", t.commands[0])

    def test_no_recipient_is_refused(self):
        with self.assertRaises(TransportError):
            Stub([]).create_call({"task": "x", "recipients": []}, idempotency_key="k")


class Reading(unittest.TestCase):
    def test_status_is_mapped_onto_the_shared_vocabulary(self):
        for raw, expected in [("succeeded", "completed"), ("finished", "completed"),
                              ("error", "failed"), ("cancelled", "canceled"),
                              ("ringing", "in_progress")]:
            t = Stub([envelope({"status": raw})])
            self.assertEqual(t.get_call("run_1")["status"], expected, msg=raw)

    def test_summary_and_transcript_become_evidence(self):
        t = Stub([envelope({
            "status": "completed",
            "summary": "HR confirmed employment.",
            "transcript": [{"speaker": "user", "text": "Yes, he works here."}],
        })])
        evidence = t.get_call("run_1")["evidence"]
        self.assertIn("HR confirmed employment.", evidence)
        self.assertTrue(any("Yes, he works here." in e for e in evidence))

    def test_no_structured_result_is_fabricated(self):
        """Extraction is CALL-E's job. Doing it here would be a different product."""
        t = Stub([envelope({"status": "completed", "summary": "Yes, employed."})])
        self.assertIsNone(t.get_call("run_1")["recipients"][0]["structured_result"])

    def test_a_completed_mcp_call_routes_to_a_human(self):
        """The fail-closed rule doing exactly what it was written for."""
        t = Stub([envelope({"status": "completed", "summary": "HR confirmed employment."})])
        result = interpret(t.get_call("run_1"), DERIVED)
        self.assertEqual(result.disposition, Disposition.NEEDS_REVIEW)
        self.assertIn("no structured result", result.reason)

    def test_an_mcp_call_can_never_read_as_verified(self):
        for raw in ("completed", "succeeded", "finished"):
            t = Stub([envelope({"status": raw, "summary": "Yes, definitely employed."})])
            self.assertNotEqual(
                interpret(t.get_call("run_1"), DERIVED).disposition,
                Disposition.VERIFIED, msg=raw,
            )

    def test_events_are_empty_because_mcp_exposes_none(self):
        self.assertEqual(Stub([]).list_events("run_1")["data"], [])


class Attribution(unittest.TestCase):
    def test_install_attribution_is_preserved(self):
        self.assertEqual(CLI_ENV["CALLE_SOURCE"], "skills_sh")
        self.assertIn("CALLE_INTEGRATION_VERSION", CLI_ENV)


class MissingCli(unittest.TestCase):
    def test_a_missing_binary_says_how_to_install_it(self):
        with self.assertRaises(TransportError) as ctx:
            McpTransport(binary="calle-does-not-exist")
        self.assertIn("npm install -g @call-e/cli", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
