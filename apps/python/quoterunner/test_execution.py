"""Tests for the CALL-E execution layer.

Nothing here dials. The CallsAPI is a fake, which is the point: the gates that
stop a real call have to be testable without placing one.

    python -m unittest test_execution -v
"""

from __future__ import annotations

import json
import os
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import execution
import quoterunner
from execution import (
    QuoteError,
    SimulatedCalls,
    call_arguments,
    check_confirmation,
    compare,
    confirmation_token,
    idempotency_key,
    parse_amount,
    render_comparison,
    run_batch,
    sanitise_quote,
    validate_base_url,
)
from quoterunner import Candidate

FIXTURE = Path(__file__).parent / "example-candidates.json"
OPEN_ALL_DAY = "Mo-Su 00:00-23:59"
MOMENT = datetime(2026, 8, 7, 10, 0, 0)

GOOD_QUOTE = {
    "does_this_job": "yes",
    "quoted_price": "245",
    "currency": "USD",
    "price_covers": "parts_and_labour",
    "earliest_date": "2026-08-11",
    "job_duration": "about 2 hours",
    "warranty_months": "12",
    "callback_required": "no",
    "evidence_summary": "Quoted for an OEM-equivalent screen.",
}


def candidate(name="Northgate Auto Glass", phone="+15555550100", hours=OPEN_ALL_DAY):
    return Candidate(name=name, phone=phone, opening_hours=hours, source_id="osm/1")


class FakeCalls:
    """Records what it was asked to do and returns whatever it was told to."""

    def __init__(self, result=None, *, create_raises=None, wait_raises=None,
                 call_id="call-1", status="completed"):
        self.created: list[dict] = []
        self.waited: list[str] = []
        self._result = result if result is not None else dict(GOOD_QUOTE)
        self._create_raises = create_raises
        self._wait_raises = wait_raises
        self._call_id = call_id
        self._status = status

    def create(self, **kwargs):
        self.created.append(kwargs)
        if self._create_raises:
            raise self._create_raises
        return {"id": self._call_id, "status": "queued"} if self._call_id else {"status": "queued"}

    def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
        self.waited.append(call_id)
        if self._wait_raises:
            raise self._wait_raises
        return {"id": call_id, "status": self._status, "structured_result": self._result}


# ---------------------------------------------------------------- token --
class TestConfirmationToken(unittest.TestCase):
    """The token exists so that approving one list cannot dial another."""

    def test_stable_for_the_same_batch(self):
        batch = [candidate(), candidate("B", "+15555550101")]
        self.assertEqual(confirmation_token(batch, "job"),
                         confirmation_token(list(batch), "job"))

    def test_changes_when_a_number_changes(self):
        a = [candidate(), candidate("B", "+15555550101")]
        b = [candidate(), candidate("B", "+15555550102")]
        self.assertNotEqual(confirmation_token(a, "job"), confirmation_token(b, "job"))

    def test_changes_when_a_candidate_is_added(self):
        a = [candidate()]
        b = [candidate(), candidate("B", "+15555550101")]
        self.assertNotEqual(confirmation_token(a, "job"), confirmation_token(b, "job"))

    def test_changes_when_the_job_changes(self):
        batch = [candidate()]
        self.assertNotEqual(confirmation_token(batch, "windscreen"),
                            confirmation_token(batch, "gearbox"))

    def test_order_does_not_matter(self):
        a = [candidate("A", "+15555550100"), candidate("B", "+15555550101")]
        self.assertEqual(confirmation_token(a, "job"),
                         confirmation_token(list(reversed(a)), "job"))

    def test_missing_token_is_refused_and_the_right_one_is_shown(self):
        batch = [candidate()]
        with self.assertRaises(QuoteError) as caught:
            check_confirmation(batch, "job", None)
        self.assertIn(confirmation_token(batch, "job"), str(caught.exception))

    def test_wrong_token_is_refused(self):
        with self.assertRaises(QuoteError):
            check_confirmation([candidate()], "job", "000000000000")

    def test_right_token_passes(self):
        batch = [candidate()]
        check_confirmation(batch, "job", confirmation_token(batch, "job"))

    def test_token_is_case_insensitive_and_trimmed(self):
        batch = [candidate()]
        token = confirmation_token(batch, "job")
        check_confirmation(batch, "job", f"  {token.upper()}  ")


# ---------------------------------------------------------- idempotency --
class TestIdempotency(unittest.TestCase):
    def test_same_business_and_job_gives_the_same_key(self):
        self.assertEqual(idempotency_key(candidate(), "job"),
                         idempotency_key(candidate(), "job"))

    def test_different_business_gives_a_different_key(self):
        self.assertNotEqual(idempotency_key(candidate(), "job"),
                            idempotency_key(candidate("B", "+15555550101"), "job"))

    def test_different_job_gives_a_different_key(self):
        self.assertNotEqual(idempotency_key(candidate(), "windscreen"),
                            idempotency_key(candidate(), "gearbox"))

    def test_key_carries_no_phone_number(self):
        self.assertNotIn("5555550100", idempotency_key(candidate(), "job"))


# ------------------------------------------------------- call arguments --
class TestCallArguments(unittest.TestCase):
    def test_the_real_number_is_what_gets_dialed(self):
        """Masking is for output. The payload has to carry the real number."""
        args = call_arguments(candidate(), "job", "Ivan")
        self.assertEqual(args["recipients"][0]["phones"], ["+15555550100"])

    def test_schema_is_attached(self):
        args = call_arguments(candidate(), "job", "Ivan")
        self.assertEqual(args["result_schema"], execution.QUOTE_SCHEMA)

    def test_locale_is_passed_through(self):
        args = call_arguments(candidate(), "job", "Ivan", locale="es-MX")
        self.assertEqual(args["recipients"][0]["locale"], "es-MX")

    def test_task_names_the_business_and_the_requester(self):
        args = call_arguments(candidate(), "replace a windscreen", "Ivan")
        self.assertIn("Northgate Auto Glass", args["task"])
        self.assertIn("Ivan", args["task"])

    def test_task_forbids_agreeing_to_anything(self):
        args = call_arguments(candidate(), "job", "Ivan")
        self.assertIn("Do not agree to anything", args["task"])

    def test_task_requires_disclosing_it_is_an_ai(self):
        args = call_arguments(candidate(), "job", "Ivan")
        self.assertIn("AI", args["task"])


# ----------------------------------------------------------- the gates --
class TestLiveGates(unittest.TestCase):
    """Four independent gates. Any one of them alone stops the call."""

    def test_env_flag_is_required(self):
        with mock.patch.dict(os.environ, {"CALLE_API_KEY": "k"}, clear=True):
            with self.assertRaises(QuoteError) as caught:
                execution.build_calls_api()
        self.assertIn("CALLE_LIVE_CALLS_ENABLED", str(caught.exception))

    def test_api_key_is_required(self):
        with mock.patch.dict(os.environ, {"CALLE_LIVE_CALLS_ENABLED": "true"}, clear=True):
            with self.assertRaises(QuoteError) as caught:
                execution.build_calls_api()
        self.assertIn("CALLE_API_KEY", str(caught.exception))

    def test_the_flag_must_say_true_not_just_be_set(self):
        with mock.patch.dict(os.environ,
                             {"CALLE_LIVE_CALLS_ENABLED": "1", "CALLE_API_KEY": "k"},
                             clear=True):
            with self.assertRaises(QuoteError):
                execution.build_calls_api()

    def test_official_origin_is_accepted(self):
        self.assertEqual(validate_base_url("https://api.heycall-e.com"),
                         "https://api.heycall-e.com")

    def test_loopback_with_a_port_is_accepted_for_tests(self):
        self.assertEqual(validate_base_url("http://127.0.0.1:8931"),
                         "http://127.0.0.1:8931")

    def test_someone_elses_host_is_refused(self):
        """A base URL is where a live call gets silently redirected."""
        for bad in ("https://api.heycall-e.com.evil.test",
                    "https://evil.test",
                    "http://api.heycall-e.com",
                    "https://user:pass@api.heycall-e.com",
                    "https://api.heycall-e.com/v1?to=elsewhere"):
            with self.subTest(bad=bad), self.assertRaises(QuoteError):
                validate_base_url(bad)


# ------------------------------------------------------------ sanitise --
class TestSanitise(unittest.TestCase):
    """The bug this class exists for: a date is eight digits with separators,
    which a phone-number pattern matches. The first version redacted every
    availability date into '[number redacted]'."""

    def test_iso_date_survives(self):
        self.assertEqual(sanitise_quote(GOOD_QUOTE)["earliest_date"], "2026-08-11")

    def test_price_survives(self):
        self.assertEqual(sanitise_quote(GOOD_QUOTE)["quoted_price"], "245")

    def test_price_range_survives(self):
        quote = {**GOOD_QUOTE, "quoted_price": "280-320"}
        self.assertEqual(sanitise_quote(quote)["quoted_price"], "280-320")

    def test_a_phone_number_in_a_date_field_becomes_unknown(self):
        quote = {**GOOD_QUOTE, "earliest_date": "+1 555 0100"}
        self.assertEqual(sanitise_quote(quote)["earliest_date"], "unknown")

    def test_a_phone_number_in_the_price_becomes_unknown(self):
        quote = {**GOOD_QUOTE, "quoted_price": "call +15555550100"}
        self.assertEqual(sanitise_quote(quote)["quoted_price"], "unknown")

    def test_prose_keeps_its_meaning_but_loses_the_number(self):
        quote = {**GOOD_QUOTE,
                 "evidence_summary": "Ask for Dave on +1 555 0199 before Friday."}
        out = sanitise_quote(quote)["evidence_summary"]
        self.assertNotIn("5550199", out.replace(" ", ""))
        self.assertIn("before Friday", out)

    def test_email_in_prose_is_redacted(self):
        quote = {**GOOD_QUOTE, "evidence_summary": "Send the VIN to shop@example.test."}
        self.assertNotIn("shop@example.test", sanitise_quote(quote)["evidence_summary"])

    def test_junk_currency_becomes_unknown(self):
        self.assertEqual(sanitise_quote({**GOOD_QUOTE, "currency": "dollars"})["currency"],
                         "unknown")


# ----------------------------------------------------------- run_batch --
class TestRunBatch(unittest.TestCase):
    def test_happy_path_returns_a_quote(self):
        fake = FakeCalls()
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(len(fake.created), 1)
        self.assertEqual(rows[0]["quote"]["quoted_price"], "245")

    def test_a_business_that_closed_since_planning_is_not_dialed(self):
        """The gap between planning and dialing is minutes. Shops close in it."""
        closed = candidate(hours="Mo-Su 00:00-09:00")
        fake = FakeCalls()
        rows = run_batch([closed], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(fake.created, [])
        self.assertEqual(rows[0]["status"], "not_called")
        self.assertIn("closed at dial time", rows[0]["reason"])

    def test_one_refusal_does_not_kill_the_batch(self):
        fake = FakeCalls(create_raises=RuntimeError("rate limited"))
        rows = run_batch([candidate(), candidate("B", "+15555550101")],
                         "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["status"] == "error" for r in rows))

    def test_a_create_without_an_id_is_not_retried(self):
        """Worst case: the call may be live and there is nothing to reconcile."""
        fake = FakeCalls(call_id="")
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(rows[0]["status"], "unknown")
        self.assertEqual(len(fake.created), 1)

    def test_a_lost_result_keeps_the_call_id(self):
        fake = FakeCalls(wait_raises=TimeoutError("gateway"))
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(rows[0]["status"], "unknown")
        self.assertEqual(rows[0]["call_id"], "call-1")

    def test_no_answer_is_never_redialed(self):
        fake = FakeCalls(status="no_answer")
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(len(fake.created), 1)
        self.assertIsNone(rows[0]["quote"])
        self.assertIn("not redialled", rows[0]["reason"])

    def test_an_incomplete_result_is_not_reported_as_a_quote(self):
        fake = FakeCalls(result={"quoted_price": "100"})
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertIsNone(rows[0]["quote"])

    def test_an_out_of_enum_value_is_not_reported_as_a_quote(self):
        fake = FakeCalls(result={**GOOD_QUOTE, "does_this_job": "maybe"})
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertIsNone(rows[0]["quote"])

    def test_calls_go_out_one_at_a_time(self):
        """Twelve simultaneous calls from one number is an autodialer."""
        fake = FakeCalls()
        run_batch([candidate("A", "+15555550100"), candidate("B", "+15555550101")],
                  "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(len(fake.waited), 2)

    def test_every_row_is_masked(self):
        fake = FakeCalls()
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertNotIn("5555550100", json.dumps(rows))


# ------------------------------------------------------------- compare --
class TestCompare(unittest.TestCase):
    def _row(self, name, price, currency="USD"):
        return {"name": name, "phone_masked": "+15****00", "status": "completed",
                "reason": "", "quote": {**GOOD_QUOTE, "quoted_price": price,
                                        "currency": currency}}

    def test_parse_amount_takes_the_low_end_of_a_range(self):
        self.assertEqual(parse_amount("280-320"), 280.0)

    def test_parse_amount_handles_thousands_separators(self):
        self.assertEqual(parse_amount("1,250"), 1250.0)

    def test_parse_amount_returns_none_for_prose(self):
        self.assertIsNone(parse_amount("depends on the glass"))

    def test_parse_amount_returns_none_for_unknown(self):
        self.assertIsNone(parse_amount("unknown"))

    def test_cheapest_wins(self):
        table = compare([self._row("Dear", "300"), self._row("Cheap", "100")])
        self.assertEqual(table["cheapest"], "Cheap")

    def test_a_range_is_ranked_on_its_low_end(self):
        table = compare([self._row("Range", "150-400"), self._row("Flat", "200")])
        self.assertEqual(table["cheapest"], "Range")

    def test_a_priceless_answer_does_not_win(self):
        """An unparseable price must not become a zero that beats every quote."""
        table = compare([self._row("NoPrice", "unknown"), self._row("Real", "300")])
        self.assertEqual(table["cheapest"], "Real")
        self.assertEqual(len(table["no_price"]), 1)

    def test_mixed_currencies_are_not_ranked(self):
        table = compare([self._row("Usd", "100", "USD"), self._row("Mxn", "1800", "MXN")])
        self.assertTrue(table["mixed_currencies"])
        self.assertIsNone(table["cheapest"])

    def test_unreached_rows_are_kept_not_dropped(self):
        rows = [self._row("Quoted", "100"),
                {"name": "Silent", "phone_masked": "+15****01", "status": "no_answer",
                 "reason": "nobody picked up", "quote": None}]
        self.assertEqual(len(compare(rows)["not_reached"]), 1)


# -------------------------------------------------------- end to end --
class TestSimulatedEndToEnd(unittest.TestCase):
    """The whole pipeline over the shipped fixture, with no transport."""

    def setUp(self):
        payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.job = payload["job"]
        self.candidates = quoterunner.load_fixture(FIXTURE)
        self.callable_now, _ = quoterunner.screen(self.candidates, MOMENT)

    def test_the_fixture_produces_a_comparison(self):
        rows = run_batch(self.callable_now, self.job, "Ivan", SimulatedCalls(),
                         moment=MOMENT)
        table = compare(rows)
        self.assertTrue(table["quoted"])
        self.assertIsNotNone(table["cheapest"])

    def test_no_full_number_reaches_the_rendered_comparison(self):
        """The flagship assertion: nothing leaks, on any output path."""
        rows = run_batch(self.callable_now, self.job, "Ivan", SimulatedCalls(),
                         moment=MOMENT)
        rendered = render_comparison(self.job, compare(rows), simulated=True)
        for c in self.candidates:
            digits = c.phone.lstrip("+")
            if len(digits) > 6:
                self.assertNotIn(digits, rendered)
                self.assertNotIn(digits, json.dumps(rows))

    def test_simulation_is_deterministic(self):
        first = run_batch(self.callable_now, self.job, "Ivan", SimulatedCalls(),
                          moment=MOMENT)
        second = run_batch(self.callable_now, self.job, "Ivan", SimulatedCalls(),
                           moment=MOMENT)
        self.assertEqual(json.dumps(first), json.dumps(second))

    def test_simulation_says_it_is_a_simulation(self):
        rows = run_batch(self.callable_now, self.job, "Ivan", SimulatedCalls(),
                         moment=MOMENT)
        self.assertIn("SIMULATED", render_comparison(self.job, compare(rows), True))

    def test_the_cap_still_holds_through_execution(self):
        many = [candidate(f"Shop {i}", f"+1555555{i:04d}") for i in range(20)]
        callable_now, excluded = quoterunner.screen(many, MOMENT)
        self.assertEqual(len(callable_now), quoterunner.MAX_CANDIDATES_PER_RUN)
        fake = FakeCalls()
        run_batch(callable_now, "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(len(fake.created), quoterunner.MAX_CANDIDATES_PER_RUN)
        self.assertTrue(any("cap" in e.reason for e in excluded))


if __name__ == "__main__":
    unittest.main(verbosity=2)
