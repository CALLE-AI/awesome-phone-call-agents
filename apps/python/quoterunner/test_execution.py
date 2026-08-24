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


def candidate(name="Northgate Auto Glass", phone="+15555550100", hours=OPEN_ALL_DAY,
              tz="America/Chicago"):
    return Candidate(name=name, phone=phone, opening_hours=hours, source_id="osm/1",
                     timezone=tz)


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
        # A real completed call carries the attestation. The fake has to as
        # well, or every test would be exercising the unattested path by
        # accident -- which is exactly the case the gate now rejects.
        return {"id": call_id, "status": self._status,
                "task_completed": True,
                "structured_result": self._result}


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


# --------------------------------------------------- the published SDK --
class TestSDKContract(unittest.TestCase):
    """Check that what we send still fits the SDK that is actually published.

    Without this, a signature change in `calle-ai` goes unnoticed until a call
    fails live. The only times this app runs live are in front of a camera or
    in front of a real business, which are the two worst moments to find out.

    No call is placed: signatures only.
    """

    @classmethod
    def setUpClass(cls):
        try:
            import calle  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("calle-ai not installed (pip install calle-ai)")

    def test_client_takes_api_key_and_base_url(self):
        import inspect
        from calle import CalleClient
        p = inspect.signature(CalleClient.__init__).parameters
        self.assertIn("api_key", p)
        self.assertIn("base_url", p)

    def test_create_accepts_every_field_we_send(self):
        import inspect
        from calle.calls import CalleCalls
        accepted = set(inspect.signature(CalleCalls.create).parameters)
        sent = set(call_arguments(candidate(), "job", "Ivan"))
        missing = sent - accepted
        self.assertFalse(missing, "the SDK does not accept: %s" % sorted(missing))

    def test_recipients_is_the_plural_list_form(self):
        """`create` takes both `recipient` and `recipients`. We use the list."""
        import inspect
        from calle.calls import CalleCalls
        self.assertIn("recipients", inspect.signature(CalleCalls.create).parameters)
        self.assertIsInstance(
            call_arguments(candidate(), "job", "Ivan")["recipients"], list)

    def test_wait_for_result_takes_our_keywords(self):
        import inspect
        from calle.calls import CalleCalls
        p = inspect.signature(CalleCalls.wait_for_result).parameters
        self.assertIn("timeout_seconds", p)
        self.assertIn("interval_seconds", p)

    def test_the_sdk_default_origin_is_the_one_we_pin(self):
        import inspect
        from calle import CalleClient
        d = inspect.signature(CalleClient.__init__).parameters["base_url"].default
        self.assertEqual(d, execution.DEFAULT_BASE_URL)


# ---------------------------------------------- raised in review of #118 --
class TestReviewFindings(unittest.TestCase):
    """One test per finding from the review, named after the finding.

    They were all the same shape of mistake: treating something unverified as
    good enough to act on.
    """

    # --- terminal is not the same as successful ------------------------
    def test_a_failed_call_produces_no_quote(self):
        """`failed` is terminal, but it is not a call that went well.

        Its structured_result can satisfy the schema and still be the wreckage
        of a call that did not happen as intended. Ranking it beside a real
        quote puts a price in the table that nobody said out loud.
        """
        fake = FakeCalls(status="failed")
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertIsNone(rows[0]["quote"])
        self.assertIn("not as a completed call", rows[0]["reason"])

    def test_a_canceled_call_produces_no_quote(self):
        rows = run_batch([candidate()], "job", "Ivan",
                         FakeCalls(status="canceled"), moment=MOMENT)
        self.assertIsNone(rows[0]["quote"])

    def test_task_completed_false_produces_no_quote(self):
        """CALL-E saying the agent did not finish what it was sent to do."""
        class Unfinished(FakeCalls):
            def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
                r = super().wait_for_result(
                    call_id, timeout_seconds=timeout_seconds,
                    interval_seconds=interval_seconds)
                r["task_completed"] = False
                return r
        rows = run_batch([candidate()], "job", "Ivan", Unfinished(), moment=MOMENT)
        self.assertIsNone(rows[0]["quote"])
        self.assertIn("not completed", rows[0]["reason"])

    def test_a_completed_call_still_produces_a_quote(self):
        """The fix must not have taken the working path down with it."""
        rows = run_batch([candidate()], "job", "Ivan", FakeCalls(), moment=MOMENT)
        self.assertIsNotNone(rows[0]["quote"])

    def test_succeeded_counts_as_successful_too(self):
        rows = run_batch([candidate()], "job", "Ivan",
                         FakeCalls(status="succeeded"), moment=MOMENT)
        self.assertIsNotNone(rows[0]["quote"])

    # --- hours are read on the shop's own clock ------------------------
    def test_a_candidate_with_no_timezone_is_not_dialled(self):
        """Without a zone we cannot know what time it is there."""
        fake = FakeCalls()
        rows = run_batch([candidate(tz="")], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(fake.created, [])
        self.assertEqual(rows[0]["status"], "not_called")
        self.assertIn("no timezone", rows[0]["reason"])

    def test_the_zone_decides_whether_it_is_open(self):
        """One instant, two zones, two answers. This is the whole bug.

        20:00 in New York is 17:00 in Los Angeles. A shop open 09:00-18:00 is
        closed in the first and open in the second, and both used to be
        resolved against the host clock.
        """
        from datetime import timezone as tzmod, timedelta
        instant = datetime(2026, 8, 7, 20, 0, tzinfo=tzmod(timedelta(hours=-4)))
        hours = "Mo-Su 09:00-18:00"
        east = FakeCalls()
        run_batch([candidate(hours=hours, tz="America/New_York")],
                  "job", "Ivan", east, moment=instant)
        west = FakeCalls()
        run_batch([candidate(hours=hours, tz="America/Los_Angeles")],
                  "job", "Ivan", west, moment=instant)
        self.assertEqual(len(east.created), 0, "20:00 in New York: closed")
        self.assertEqual(len(west.created), 1, "17:00 in Los Angeles: open")

    def test_screen_excludes_zoneless_candidates_on_the_live_path(self):
        _, out = quoterunner.screen([candidate(tz="")], MOMENT, require_timezone=True)
        self.assertIn("no timezone", out[0].reason)

    def test_preview_does_not_require_a_zone(self):
        """Preview still shows them: that is what it is for."""
        keep, _ = quoterunner.screen([candidate(tz="")], MOMENT)
        self.assertEqual(len(keep), 1)

    def test_the_operator_may_declare_the_zone_for_a_batch(self):
        """Declaring it is not inferring it. Inferring is what is forbidden."""
        keep, _ = quoterunner.screen([candidate(tz="")], MOMENT,
                                     default_timezone="America/Chicago")
        self.assertEqual(keep[0].timezone, "America/Chicago")

    def test_an_invented_zone_is_not_taken_on_trust(self):
        _, out = quoterunner.screen([candidate(tz="Mars/Olympus")], MOMENT)
        self.assertIn("Unknown timezone", out[0].reason)

    # --- keys and tokens cover the whole spoken payload ----------------
    def test_changing_the_requester_changes_the_idempotency_key(self):
        """A different name on the call is a different call, not a repeat."""
        self.assertNotEqual(idempotency_key(candidate(), "job", "Ivan"),
                            idempotency_key(candidate(), "job", "Marta"))

    def test_changing_the_locale_changes_the_idempotency_key(self):
        self.assertNotEqual(idempotency_key(candidate(), "job", "Ivan", "en-US"),
                            idempotency_key(candidate(), "job", "Ivan", "es-MX"))

    def test_the_same_script_keeps_the_same_key(self):
        """Real deduplication still has to work."""
        self.assertEqual(idempotency_key(candidate(), "job", "Ivan", "en-US"),
                         idempotency_key(candidate(), "job", "Ivan", "en-US"))

    def test_the_payload_key_matches_the_function(self):
        args = call_arguments(candidate(), "job", "Ivan", "es-MX")
        self.assertEqual(args["idempotency_key"],
                         idempotency_key(candidate(), "job", "Ivan", "es-MX"))

    def test_changing_the_requester_changes_the_confirmation_token(self):
        """An approval must not survive a rewritten script.

        Otherwise you review a batch of English calls on behalf of one person
        and use that same token to place Spanish calls on behalf of another.
        """
        batch = [candidate()]
        self.assertNotEqual(confirmation_token(batch, "job", "Ivan"),
                            confirmation_token(batch, "job", "Marta"))

    def test_changing_the_locale_changes_the_confirmation_token(self):
        batch = [candidate()]
        self.assertNotEqual(confirmation_token(batch, "job", "Ivan", "en-US"),
                            confirmation_token(batch, "job", "Ivan", "es-MX"))

    def test_a_token_from_another_locale_is_refused(self):
        batch = [candidate()]
        stale = confirmation_token(batch, "job", "Ivan", "en-US")
        with self.assertRaises(QuoteError):
            check_confirmation(batch, "job", stale, "Ivan", "es-MX")

    # --- a lost answer is not a refusal --------------------------------
    def test_a_timeout_is_recorded_as_unknown_not_refused(self):
        """The provider may have accepted it and the phone may be ringing.

        Filing that as "refused" invites a retry, and a retry here is a second
        call to a real business.
        """
        fake = FakeCalls(create_raises=TimeoutError("read timeout"))
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(rows[0]["status"], "unknown")
        self.assertIn("may have been accepted", rows[0]["reason"])

    def test_an_unknown_outcome_carries_its_idempotency_key(self):
        """That key is what reconciliation has to match on afterwards."""
        fake = FakeCalls(create_raises=TimeoutError("read timeout"))
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(rows[0]["idempotency_key"],
                         idempotency_key(candidate(), "job", "Ivan", "en-US"))

    def test_a_server_error_is_also_unknown(self):
        class ServerError(Exception):
            status_code = 503
        fake = FakeCalls(create_raises=ServerError("upstream"))
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(rows[0]["status"], "unknown")

    def test_a_rejected_request_is_still_a_refusal(self):
        """A bad key or a malformed payload never rang anybody."""
        class BadRequest(Exception):
            status_code = 400
        fake = FakeCalls(create_raises=BadRequest("invalid"))
        rows = run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT)
        self.assertEqual(rows[0]["status"], "error")
        self.assertIn("refused", rows[0]["reason"])

    def test_outcome_unknown_classifies_by_name_and_code(self):
        self.assertTrue(execution.outcome_unknown(TimeoutError()))
        self.assertTrue(execution.outcome_unknown(ConnectionError()))
        self.assertFalse(execution.outcome_unknown(ValueError()))


if __name__ == "__main__":
    unittest.main(verbosity=2)


# --------------------------------- third review round on #118 (8888ab6) --
class TestThirdReviewRound(unittest.TestCase):
    """The reviewer's third pass. All three were real."""

    def test_missing_attestation_is_not_a_quote(self):
        """Silence is not consent.

        The gate rejected only an explicit False, so a completed call with
        `task_completed` absent or null slipped through and its answers were
        ranked as a real quote. Nobody attested that the call finished.
        """
        class SinAtestar(FakeCalls):
            def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
                r = super().wait_for_result(
                    call_id, timeout_seconds=timeout_seconds,
                    interval_seconds=interval_seconds)
                r.pop("task_completed", None)
                return r
        rows = run_batch([candidate()], "job", "Ivan", SinAtestar(), moment=MOMENT)
        self.assertIsNone(rows[0]["quote"])
        self.assertIn("did not attest", rows[0]["reason"])

    def test_null_attestation_is_not_a_quote(self):
        class Nula(FakeCalls):
            def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
                r = super().wait_for_result(
                    call_id, timeout_seconds=timeout_seconds,
                    interval_seconds=interval_seconds)
                r["task_completed"] = None
                return r
        rows = run_batch([candidate()], "job", "Ivan", Nula(), moment=MOMENT)
        self.assertIsNone(rows[0]["quote"])

    def test_explicit_true_still_produces_a_quote(self):
        """The fix must not have closed the working path."""
        class Atestada(FakeCalls):
            def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
                r = super().wait_for_result(
                    call_id, timeout_seconds=timeout_seconds,
                    interval_seconds=interval_seconds)
                r["task_completed"] = True
                return r
        rows = run_batch([candidate()], "job", "Ivan", Atestada(), moment=MOMENT)
        self.assertIsNotNone(rows[0]["quote"])

    def test_a_create_without_an_id_keeps_its_idempotency_key(self):
        """That key is the only handle left to reconcile the call by."""
        rows = run_batch([candidate()], "job", "Ivan", FakeCalls(call_id=""),
                         moment=MOMENT)
        self.assertEqual(rows[0]["status"], "unknown")
        self.assertEqual(rows[0]["idempotency_key"],
                         idempotency_key(candidate(), "job", "Ivan", "en-US"))

    def test_the_call_is_recorded_before_the_wait(self):
        """An interrupted run must still know what it started.

        The call lives on CALL-E's side. Killing this process does not stop it,
        so the record cannot be written only after the call ends.
        """
        vistos = []

        class LentaYRota(FakeCalls):
            def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
                # Lo que veria un Ctrl+C a mitad de la espera.
                raise KeyboardInterrupt("interrumpido a mitad de llamada")

        fake = LentaYRota()
        with self.assertRaises(KeyboardInterrupt):
            run_batch([candidate()], "job", "Ivan", fake, moment=MOMENT,
                      on_accepted=vistos.append)

        self.assertEqual(len(vistos), 1, "no se aviso de la llamada aceptada")
        self.assertEqual(vistos[0]["call_id"], "call-1")
        self.assertEqual(vistos[0]["status"], "in_flight")
        self.assertEqual(vistos[0]["idempotency_key"],
                         idempotency_key(candidate(), "job", "Ivan", "en-US"))

    def test_on_accepted_fires_before_the_result_arrives(self):
        orden = []

        class Ordenada(FakeCalls):
            def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
                orden.append("wait")
                return super().wait_for_result(
                    call_id, timeout_seconds=timeout_seconds,
                    interval_seconds=interval_seconds)

        run_batch([candidate()], "job", "Ivan", Ordenada(), moment=MOMENT,
                  on_accepted=lambda f: orden.append("accepted"))
        self.assertEqual(orden, ["accepted", "wait"])

    def test_the_row_carries_the_call_id_while_in_flight(self):
        filas = []
        run_batch([candidate()], "job", "Ivan", FakeCalls(), moment=MOMENT,
                  on_accepted=filas.append)
        self.assertEqual(filas[0]["status"], "in_flight")
        self.assertIn("call_id", filas[0])

    def test_a_lost_result_keeps_call_id_and_key(self):
        rows = run_batch([candidate()], "job", "Ivan",
                         FakeCalls(wait_raises=TimeoutError("gateway")),
                         moment=MOMENT)
        self.assertEqual(rows[0]["status"], "unknown")
        self.assertEqual(rows[0]["call_id"], "call-1")
        self.assertIn("idempotency_key", rows[0])
