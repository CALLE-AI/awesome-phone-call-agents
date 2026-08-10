#!/usr/bin/env python3
"""
Regression tests for pharmacy_search.py.

Standard library only, no network, no credentials, no calls placed.

    python3 test_pharmacy_search.py
    python3 -m unittest test_pharmacy_search -v

The central invariant, and the reason this file exists:

    A recipient with an unresolved call is never dialled again.

That has regressed twice — once when the ledger keys were namespaced by
configuration (making a live call look absent), and once when attempt fields
were nested under `entry["attempt"]` while the caller still read them from the
top level. Both were silent: the code planned and submitted a second call to a
real person, and nothing in the output said so.

`test_resume_does_not_redial` is the guard. It asserts on the *tool calls made*,
not on return values — the only thing that actually distinguishes "resumed" from
"dialled again" is whether `run_call` was invoked.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import pharmacy_search as ps


TERMINAL_RESPONSE = {
    "status": "COMPLETED",
    "result": {
        "summary": "Stock check completed. Result: in_stock=yes, "
                   "quantity_available=40, unit_price=6.2, currency=GBP",
        "outcome": {
            "task_completed": True,
            "completion_confidence": {"score": 0.9, "label": "high"},
            "evidence": ["They confirmed 40 in stock."],
        },
        "transcript": "[00:00] BOT: Hello…",
    },
    "activity": [],
    "next_step": {"action": "report_result", "instruction": "done"},
}


class FakeToolResult:
    """Mimics the MCP result object `Caller._unwrap` expects.

    A bare dict unwraps to `{}`, which makes `_poll` spin forever — so the
    stub has to carry the same shape the real transport does.
    """

    def __init__(self, payload: dict) -> None:
        self.structured_content = payload
        self.data = payload
        self.content = []


class RecordingClient:
    """Stands in for the MCP client and records which tools were invoked."""

    def __init__(self, calls: list[str], poll_response: dict | None = None) -> None:
        self.calls = calls
        self.poll_response = poll_response or dict(TERMINAL_RESPONSE)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def call_tool(self, name: str, args: dict):
        self.calls.append(name)
        if name == "plan_call":
            return FakeToolResult({
                "plan_id": "pNEW",
                "confirm_token": "cNEW",
                "ready_to_run": True,
                "confirm_expires_at": "2099-01-01T00:00:00Z",
            })
        if name == "run_call":
            return FakeToolResult({"run_id": "rNEW", "status": "PREPARING"})
        if name == "get_call_run":
            return FakeToolResult(dict(self.poll_response))
        raise AssertionError(f"unexpected tool {name}")


def make_caller(tmp: Path, calls: list[str]) -> tuple[ps.Caller, ps.RunStore]:
    """A Caller wired to the recording client, with no credential resolution."""
    store = ps.RunStore(
        path=tmp / "runs.json",
        server_url="https://endpoint.test",
        principal="acct-A",
    )
    budget = ps.CallBudget(max_calls=5, ledger=tmp / "budget.json")

    caller = ps.Caller.__new__(ps.Caller)      # bypass __init__ and its auth
    caller.budget = budget
    caller.store = store
    caller._token = "test-token"
    caller.show_conversation = False           # the shipped default
    caller._client = lambda: RecordingClient(calls)
    return caller, store


class ResumeRegression(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        # Terminal run dumps go to the temp dir, not the working directory.
        # Tests must not leave transcripts lying around.
        self._run_dir = ps.RUN_DIR
        ps.RUN_DIR = self.tmp / "call_runs"
        self.calls: list[str] = []
        self.caller, self.store = make_caller(self.tmp, self.calls)
        self.pharmacy = {"name": "Oakhill", "phone": "+15550101"}
        self.goal = "check stock"
        self.key = self.store.claim_key(self.pharmacy["phone"], self.goal)

    def tearDown(self) -> None:
        ps.RUN_DIR = self._run_dir
        self._tmp.cleanup()

    def _run(self):
        return asyncio.run(
            self.caller.call(self.pharmacy, self.goal, "GB")
        )

    def test_fresh_call_plans_and_dials(self):
        """Baseline: with no prior state, a call is planned and placed."""
        record = self._run()
        self.assertEqual(
            self.calls[:2], ["plan_call", "run_call"],
            "a fresh recipient should be planned and dialled",
        )
        self.assertEqual(self.caller.budget.spent, 1)
        self.assertEqual(record["in_stock"], "yes")

    def test_resume_does_not_redial(self):
        """THE regression: a `running` entry is resumed, never re-dialled.

        Simulates a crash after run_call succeeded — the ledger holds a run_id
        under `attempt`, exactly as `update()` writes it.
        """
        self.store.claim(self.key, "…0101", "GB")
        self.store.update(
            self.key, state="running", plan_id="pOLD", confirm_token="cOLD",
            run_id="rOLD",
        )
        # A fresh process would not hold the in-process claim.
        self.store._active.discard(self.key)
        self.calls.clear()

        self._run()

        self.assertNotIn(
            "run_call", self.calls,
            "REDIAL: an in-flight recipient was called a second time",
        )
        self.assertNotIn(
            "plan_call", self.calls,
            "a new plan was created for a call already in flight",
        )
        self.assertEqual(self.calls, ["get_call_run"])
        self.assertEqual(
            self.caller.budget.spent, 0,
            "resuming must not spend another call",
        )

    def test_resume_reads_attempt_not_top_level(self):
        """Guards the specific shape bug: attempt fields are nested.

        Writing run_id at the top level must NOT be mistaken for a resumable
        run — that is the shape the caller used to read, and reading it there
        again would hide this regression.
        """
        self.store.claim(self.key, "…0101", "GB")
        entry = self.store.get(self.key)
        self.assertIn("attempt", entry)

        self.store.update(self.key, state="running", run_id="rOLD")
        entry = self.store.get(self.key)
        self.assertEqual(entry["attempt"]["run_id"], "rOLD")
        self.assertNotIn(
            "run_id", {k: v for k, v in entry.items() if k != "attempt"},
            "attempt fields must not be flattened to the top level",
        )

    def test_reused_plan_is_not_replanned(self):
        """A crash between plan_call and run_call reuses the stored plan."""
        self.store.claim(self.key, "…0101", "GB")
        self.store.update(
            self.key, plan_id="pOLD", confirm_token="cOLD",
            confirm_expires_at="2099-01-01T00:00:00Z",
        )
        self.store._active.discard(self.key)
        self.calls.clear()

        self._run()

        self.assertNotIn(
            "plan_call", self.calls,
            "a valid stored plan should be reused, not replaced",
        )
        self.assertEqual(self.calls[0], "run_call")


class ExclusionRegression(unittest.TestCase):
    """The claim must span provider configuration."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.path = self.tmp / "runs.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _store(self, principal="acct-A", endpoint="https://endpoint.test"):
        return ps.RunStore(path=self.path, server_url=endpoint, principal=principal)

    def _seed_running(self):
        store = self._store()
        key = store.claim_key("+15550101", "goal")
        store.claim(key, "…0101", "GB")
        store.update(key, state="running", run_id="rOLD")
        return key

    def test_claim_key_ignores_configuration(self):
        a = ps.RunStore.claim_key("+15550101", "goal")
        b = ps.RunStore.claim_key("+15550101", "goal")
        self.assertEqual(a, b)

    def test_region_change_does_not_unlock_a_redial(self):
        key = self._seed_running()
        with self.assertRaises(ps.ConfigurationMismatch):
            self._store().claim(key, "…0101", "US")

    def test_account_change_does_not_resume(self):
        key = self._seed_running()
        with self.assertRaises(ps.ConfigurationMismatch):
            self._store(principal="acct-B").claim(key, "…0101", "GB")

    def test_unknown_principal_fails_closed(self):
        key = self._seed_running()
        with self.assertRaises(ps.ConfigurationMismatch):
            self._store(principal=None).claim(key, "…0101", "GB")

    def test_duplicate_row_in_one_process(self):
        store = self._store()
        key = store.claim_key("+15550101", "goal")
        store.claim(key, "…0101", "GB")
        with self.assertRaises(ps.RunLocked):
            store.claim(key, "…0101", "GB")

    def test_ambiguous_create_is_not_retried(self):
        store = self._store()
        key = store.claim_key("+15550101", "goal")
        store.claim(key, "…0101", "GB")
        store.update(key, state="dialing", plan_id="pOLD")
        store._active.discard(key)
        with self.assertRaises(ps.AmbiguousRun):
            self._store().claim(key, "…0101", "GB")

    def test_old_schema_with_pending_entries_refuses(self):
        self.path.write_text(json.dumps({"abc": {"state": "running"}}))
        with self.assertRaises(ps.StateCorrupted):
            self._store().get("abc")


class RedactionRegression(unittest.TestCase):
    """Nothing conversation-derived reaches a log or stdout unredacted.

    The provider's activity feed quotes the call as it happens, and
    `pharmacist_notes` is lifted out of the same conversation. Both used to be
    printed verbatim, which put a third party's words — and any number they
    spoke — into terminal scrollback, CI logs and screen recordings.
    """

    def test_phone_numbers_are_redacted(self):
        for text, expected_tail in [
            ("Call them on 0207 946 0123", "0123"),
            ("Try +44 7700 900123 instead", "0123"),
            ("Their number is (555) 010-0199", "0199"),
            ("reach us at 02079460123", "0123"),
        ]:
            out = ps.redact(text)
            self.assertIn("[redacted", out, f"not redacted: {text!r}")
            self.assertIn(expected_tail, out, "last four digits should survive")
            self.assertNotIn("946", out.replace(expected_tail, ""))

    def test_prices_and_quantities_survive(self):
        for text in [
            "They have 40 units at 6.20 each",
            "Only 8 left, £4.50 per capsule",
            "Hold for 48 hours",
            "amoxicillin 500mg, 21 capsules",
        ]:
            self.assertEqual(
                ps.redact(text), text,
                f"redaction damaged a non-phone number: {text!r}",
            )

    def test_speech_activity_is_withheld_by_default(self):
        self.assertIsNone(
            ps.redact_activity("callee_realtime", "Callee said: yes we have it"),
            "a pharmacist's speech must not be logged by default",
        )

    def test_speech_activity_still_redacted_when_opted_in(self):
        out = ps.redact_activity(
            "callee_realtime", "Callee said: ring 0207 946 0123",
            show_conversation=True,
        )
        self.assertIsNotNone(out)
        self.assertIn("[redacted", out)
        self.assertNotIn("946 0123", out)

    def test_progress_activity_is_logged(self):
        self.assertEqual(
            ps.redact_activity("progress", "calling task status=calling"),
            "calling task status=calling",
            "progress events describe the system, not the conversation",
        )

    def test_rendered_notes_are_redacted(self):
        record = {
            "pharmacy": "Oakhill", "in_stock": "yes", "quantity_available": 40,
            "unit_price": 6.2, "currency": "GBP", "requires_prescription": "yes",
            "can_hold": "yes", "hold_duration_hours": 24, "confidence": 0.9,
            "verified": True,
            "pharmacist_notes": "Try the Mill Lane branch on 0207 946 0123",
            "alternative_suggested": "co-amoxiclav, call 02079460124",
        }
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            ps.render([record])
        printed = buffer.getvalue()

        self.assertNotIn("946 0123", printed)
        self.assertNotIn("02079460124", printed)
        self.assertIn("[redacted", printed)
        self.assertIn("Mill Lane", printed, "the useful part should survive")
        self.assertIn("6.2", printed, "prices must not be redacted")

    def test_poll_does_not_log_speech(self):
        """End-to-end: a call whose activity quotes the pharmacist logs none
        of it."""
        speech = "Callee said: we have 40, ring 0207 946 0123 for the branch"
        response = dict(TERMINAL_RESPONSE)
        response["activity"] = [
            {"ts": "1", "kind": "progress", "message": "calling task created"},
            {"ts": "2", "kind": "callee_realtime", "message": speech},
        ]

        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            calls: list[str] = []
            caller, store = make_caller(tmp, calls)
            caller._client = lambda: RecordingClient(calls, response)
            ps_run_dir, ps.RUN_DIR = ps.RUN_DIR, tmp / "call_runs"
            try:
                with self.assertLogs("pharmacy-stock-check", level="INFO") as logged:
                    asyncio.run(caller.call(
                        {"name": "Oakhill", "phone": "+15550101"}, "goal", "GB"))
            finally:
                ps.RUN_DIR = ps_run_dir

        joined = "\n".join(logged.output)
        self.assertNotIn("Callee said", joined, "speech leaked into the log")
        self.assertNotIn("946 0123", joined, "a spoken number leaked into the log")
        self.assertIn("calling task created", joined, "progress should still log")


class BudgetRegression(unittest.TestCase):
    def test_ceiling_is_enforced(self):
        with tempfile.TemporaryDirectory() as d:
            budget = ps.CallBudget(max_calls=2, ledger=Path(d) / "b.json")
            budget.reserve(1)
            budget.reserve(1)
            with self.assertRaises(ps.BudgetExceeded):
                budget.reserve(1)

    def test_corrupt_ledger_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            ledger = Path(d) / "b.json"
            ledger.write_text("{ not json")
            with self.assertRaises(ps.BudgetExceeded):
                ps.CallBudget(max_calls=5, ledger=ledger).reserve(1)


class ValidationRegression(unittest.TestCase):
    def test_e164(self):
        self.assertEqual(ps.validate_e164("+1 555 0100"), "+15550100")
        for bad in ("07700900123", "5550100", "+0155501001", "abc"):
            with self.assertRaises(ps.InvalidPhoneNumber):
                ps.validate_e164(bad)

    def test_mask(self):
        self.assertEqual(ps.mask("+447827929230"), "…9230")

    def test_incomplete_call_reports_no_stock(self):
        final = {
            "status": "NO ANSWER",
            "result": {
                "summary": "Result: in_stock=yes, quantity_available=99",
                "outcome": {"task_completed": False,
                            "completion_confidence": {"score": 0.2}},
            },
        }
        record = ps.to_record(final, {"name": "Ghost", "phone": "+15550100"})
        self.assertEqual(record["in_stock"], "unknown")
        self.assertIsNone(record["quantity_available"])
        self.assertFalse(record["verified"])

    def test_confident_no_outranks_unverified_yes(self):
        ranked = ps.rank([
            {"pharmacy": "unverified yes", "in_stock": "yes", "unit_price": 1.0,
             "can_hold": "yes", "confidence": 0.3, "verified": False},
            {"pharmacy": "confident no", "in_stock": "no", "unit_price": None,
             "can_hold": "no", "confidence": 0.95, "verified": True},
        ])
        self.assertEqual(ranked[0]["pharmacy"], "confident no")


if __name__ == "__main__":
    unittest.main(verbosity=2)
