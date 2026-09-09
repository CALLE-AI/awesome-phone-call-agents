"""End-to-end tests for planning and executing a run.

Every test here drives the real pipeline through FixtureTransport and
FixtureAirtable. Nothing dials, and no credential is needed.
"""

import tempfile
import threading
import unittest
from pathlib import Path

from nominee.airtable import FieldMap, FixtureAirtable
from nominee.audit import AuditLog
from nominee.calle import Disposition
from nominee.consent import derive_token
from nominee.runner import PRICE_PER_CALL_USD, RunError, execute, plan, reconcile
from nominee.tasks import TASK_SPEC_VERSION
from nominee.transport import FixtureTransport
from nominee.types import Relationship

from tests.test_airtable import FIELDS, SCHEMA, ON_APPLICATION, SOURCED, record

REQUESTER = "Meridian Lending"
TABLE = "Verification Requests"
VIEW = "Ready to verify"


class Clock:
    """A monotonic fake clock. Dispatch runs on a pool, so it must be
    thread-safe and must never run out of values."""

    def __init__(self, step: float = 1.0) -> None:
        self._t = 0.0
        self._step = step
        self._lock = threading.Lock()

    def __call__(self) -> float:
        with self._lock:
            self._t += self._step
            return self._t


def good_token(request_id="VR-1041", phone=SOURCED, spec=TASK_SPEC_VERSION):
    return derive_token(
        request_id=request_id,
        phone_e164=phone,
        relationship=Relationship.EMPLOYER,
        task_spec_version=spec,
        consent_receipt_id="CR-1",
    )


def consented(**overrides):
    values = {FIELDS.consent_token: good_token()}
    values.update(overrides)
    return record(**values)


def completed_call(**answers):
    result = {
        "reached_employer": "yes",
        "employment_confirmed": "yes",
        "title_matches": "yes",
        "declined_to_answer": "no",
    }
    result.update(answers)
    return {
        "id": "call_1",
        "status": "completed",
        "completion_confidence": {"score": 0.94, "label": "high"},
        "evidence": ["HR confirmed employment, title and start date."],
        "recipients": [{"structured_result": result}],
    }


def scenario(**answers):
    return {
        "create": {"id": "call_1", "status": "queued"},
        "poll": [{"status": "in_progress"}, completed_call(**answers)],
    }


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.audit = AuditLog(Path(self._tmp.name) / "audit.jsonl")
        self.transport = FixtureTransport(scenario())

    def tearDown(self):
        self._tmp.cleanup()

    def client(self, records, view_records=None):
        return FixtureAirtable(SCHEMA, records, view_records=view_records)

    def run_it(self, client, **kwargs):
        return execute(
            client,
            self.transport,
            self.audit,
            table=TABLE,
            view=VIEW,
            requester_name=REQUESTER,
            first_delay=0,
            interval=0,
            sleep=lambda _: None,
            **kwargs,
        )


class Planning(Base):
    def test_plan_places_no_calls_and_writes_nothing(self):
        client = self.client([consented()])
        result = plan(client, table=TABLE, view=VIEW, requester_name=REQUESTER)
        self.assertEqual(result.call_count, 1)
        self.assertEqual(client.writes, [])
        self.assertEqual(self.transport.created, [])
        self.assertEqual(self.audit.count(), 0)

    def test_plan_reports_the_verbatim_task(self):
        result = plan(
            self.client([consented()]), table=TABLE, view=VIEW, requester_name=REQUESTER
        )
        self.assertIn(REQUESTER, result.planned[0].task)
        self.assertIn("Do not ask about salary", result.planned[0].task)

    def test_unconsented_row_is_skipped_with_a_reason_not_dropped(self):
        result = plan(
            self.client([record(**{FIELDS.consent_token: ""})]),
            table=TABLE, view=VIEW, requester_name=REQUESTER,
        )
        self.assertEqual(result.call_count, 0)
        self.assertEqual(len(result.skipped), 1)
        self.assertIn("consent token", result.skipped[0].reason)

    def test_row_without_a_sourced_number_is_skipped_as_unverifiable(self):
        result = plan(
            self.client([consented(**{FIELDS.sourced_number: ""})]),
            table=TABLE, view=VIEW, requester_name=REQUESTER,
        )
        self.assertIn("never dialed", result.skipped[0].reason)

    def test_cancelled_row_is_skipped(self):
        result = plan(
            self.client([consented(**{FIELDS.cancelled: True})]),
            table=TABLE, view=VIEW, requester_name=REQUESTER,
        )
        self.assertIn("cancelled", result.skipped[0].reason)

    def test_hidden_rows_are_surfaced_in_the_plan(self):
        client = self.client([consented()] * 9, view_records=[consented()] * 2)
        result = plan(client, table=TABLE, view=VIEW, requester_name=REQUESTER)
        self.assertEqual(result.scope.hidden, 7)

    def test_cost_estimate_uses_the_published_price(self):
        result = plan(
            self.client([consented()] * 3), table=TABLE, view=VIEW, requester_name=REQUESTER
        )
        self.assertAlmostEqual(result.estimated_cost_usd, 3 * PRICE_PER_CALL_USD, places=2)


class Caps(Base):
    def test_run_over_the_cap_is_refused_before_dialing(self):
        client = self.client([consented()] * 5)
        with self.assertRaises(RunError) as ctx:
            self.run_it(client, max_calls=2)
        self.assertIn("over the cap", str(ctx.exception))
        self.assertEqual(self.transport.created, [])
        self.assertEqual(self.audit.count(), 0)


class Ordering(Base):
    def test_authorization_is_recorded_before_dispatch(self):
        """A record with no call is recoverable. A call with no record is not."""
        self.run_it(self.client([consented()]))
        events = [r["event"] for r in self.audit.records()]
        self.assertLess(events.index("call.authorized"), events.index("call.dispatched"))

    def test_audit_chain_survives_a_run(self):
        self.run_it(self.client([consented()]))
        self.assertTrue(self.audit.verify_chain().ok)

    def test_audit_never_stores_a_raw_number(self):
        self.run_it(self.client([consented()]))
        blob = "".join(str(r) for r in self.audit.records())
        self.assertNotIn(SOURCED, blob)
        self.assertNotIn(ON_APPLICATION, blob)


class Execution(Base):
    def test_clean_run_verifies_and_writes_back(self):
        client = self.client([consented()])
        report = self.run_it(client)
        self.assertEqual(report.by_disposition(), {"verified": 1})
        written = client.writes[0]["fields"]
        self.assertEqual(written[FIELDS.status], "verified")
        self.assertEqual(written["Employment confirmed"], "Yes")

    def test_answers_are_written_with_airtable_choice_labels(self):
        client = self.client([consented()])
        self.run_it(client)
        self.assertEqual(client.writes[0]["fields"]["Reached employer"], "Yes")

    def test_skipped_rows_are_written_back_with_their_reason(self):
        client = self.client([record(**{FIELDS.consent_token: ""})])
        self.run_it(client)
        self.assertEqual(client.writes[0]["fields"][FIELDS.status], "skipped")
        self.assertTrue(client.writes[0]["fields"][FIELDS.reason])

    def test_unreached_employer_never_writes_verified(self):
        self.transport = FixtureTransport(scenario(reached_employer="no"))
        client = self.client([consented()])
        report = self.run_it(client)
        self.assertEqual(
            report.outcomes[0].interpretation.disposition,
            Disposition.EMPLOYER_UNREACHABLE,
        )
        self.assertNotEqual(client.writes[0]["fields"][FIELDS.status], "verified")

    def test_refusal_writes_declined_and_is_not_retryable(self):
        self.transport = FixtureTransport(scenario(declined_to_answer="yes"))
        report = self.run_it(self.client([consented()]))
        self.assertEqual(report.outcomes[0].interpretation.disposition, Disposition.DECLINED)
        self.assertFalse(report.outcomes[0].interpretation.retryable)

    def test_run_records_elapsed_time(self):
        report = execute(
            self.client([consented()]),
            self.transport,
            self.audit,
            table=TABLE, view=VIEW, requester_name=REQUESTER,
            first_delay=0, interval=0, sleep=lambda _: None,
            now=Clock(step=4.0),
        )
        self.assertGreater(report.elapsed_seconds, 0)

    def test_empty_view_dials_nothing(self):
        report = self.run_it(self.client([], view_records=[]))
        self.assertEqual(report.outcomes, [])
        self.assertEqual(self.transport.created, [])


class Timeout(Base):
    def test_never_terminal_stays_pending_rather_than_guessing(self):
        self.transport = FixtureTransport(
            {"create": {"id": "call_1"}, "poll": [{"status": "in_progress"}]}
        )
        report = execute(
            self.client([consented()]),
            self.transport,
            self.audit,
            table=TABLE, view=VIEW, requester_name=REQUESTER,
            first_delay=0, interval=0, timeout=1.0,
            sleep=lambda _: None, now=Clock(step=10.0),
        )
        result = report.outcomes[0].interpretation
        self.assertEqual(result.disposition, Disposition.PENDING)
        self.assertIn("rather than redialing", result.reason)


class Reconciliation(Base):
    def test_events_provide_a_terminal_result_when_status_lags(self):
        transport = FixtureTransport(
            {
                "poll": [{"status": "in_progress"}],
                "events": {"data": [{"data": completed_call()}]},
            }
        )
        derived = plan(
            self.client([consented()]), table=TABLE, view=VIEW, requester_name=REQUESTER
        ).derived
        result = reconcile(transport, self.audit, "call_1", derived)
        self.assertEqual(result.disposition, Disposition.VERIFIED)

    def test_reconcile_never_dispatches(self):
        transport = FixtureTransport({"poll": [completed_call()]})
        derived = plan(
            self.client([consented()]), table=TABLE, view=VIEW, requester_name=REQUESTER
        ).derived
        reconcile(transport, self.audit, "call_1", derived)
        self.assertEqual(transport.created, [])


if __name__ == "__main__":
    unittest.main()
