"""Gathering, schema compilation and the live gates."""

import json
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from concord.collector import (
    answers_from_result,
    build_payload,
    build_task,
    idempotency_key,
    recipient_result_schema,
    window_is_open,
)
from concord.judge import rule_all
from concord.models import Answer, Audit, ConcordError, Criterion, Rubric

ROOT = Path(__file__).resolve().parents[1]


def load():
    return (
        Audit.load(str(ROOT / "fixtures" / "example-audit.json")),
        Rubric.load(str(ROOT / "rubrics" / "emergency-contraception.json")),
    )


class TestSchemaCompilation(unittest.TestCase):
    """The rubric is the source of truth for what the call may return."""

    def test_every_criterion_becomes_a_required_field(self):
        _, rubric = load()
        schema = recipient_result_schema(rubric)
        for criterion in rubric.criteria:
            self.assertIn(criterion.field, schema["required"])
            self.assertIn(f"{criterion.field}_quote", schema["properties"])

    def test_options_become_an_enum(self):
        _, rubric = load()
        schema = recipient_result_schema(rubric)
        first = rubric.criteria[0]
        self.assertEqual(schema["properties"][first.field]["enum"], list(first.options))

    def test_a_new_criterion_changes_the_schema(self):
        _, rubric = load()
        before = json.dumps(recipient_result_schema(rubric), sort_keys=True)
        trimmed = Rubric(rubric.id, rubric.title, rubric.scenario, rubric.criteria[:2])
        self.assertNotEqual(before, json.dumps(recipient_result_schema(trimmed), sort_keys=True))


class TestCallTask(unittest.TestCase):
    def test_task_discloses_ai_and_the_organisation(self):
        audit, rubric = load()
        task = build_task(audit, rubric)
        self.assertIn("AI assistant", task)
        self.assertIn(audit.org, task)

    def test_task_forbids_identifying_the_person(self):
        audit, rubric = load()
        task = build_task(audit, rubric).lower()
        self.assertIn("do not ask for their name", task)

    def test_task_forbids_coaching_or_grading(self):
        audit, rubric = load()
        self.assertIn("Do not coach, correct, argue with or grade", build_task(audit, rubric))

    def test_task_prefers_unclear_over_guessing(self):
        audit, rubric = load()
        self.assertIn("rather than choosing the nearest", build_task(audit, rubric))


class TestPayload(unittest.TestCase):
    def test_one_recipient_per_branch(self):
        audit, rubric = load()
        payload = build_payload(audit, rubric)
        self.assertEqual(len(payload["recipients"]), len(audit.branches))

    def test_metadata_records_the_unit_of_analysis(self):
        audit, rubric = load()
        self.assertEqual(build_payload(audit, rubric)["metadata"]["unit_of_analysis"], "branch")


class TestIdempotency(unittest.TestCase):
    """The key is derived from the approved audit, not the retry attempt."""

    def test_same_audit_yields_the_same_key(self):
        audit, rubric = load()
        self.assertEqual(idempotency_key(audit, rubric), idempotency_key(audit, rubric))

    def test_different_branches_yield_a_different_key(self):
        audit, rubric = load()
        trimmed = Audit(
            audit.id, audit.org, audit.rubric_id, audit.branches[:2],
            audit.timezone, audit.call_window, audit.requested_by,
        )
        self.assertNotEqual(idempotency_key(audit, rubric), idempotency_key(trimmed, rubric))

    def test_rewording_a_question_yields_a_different_key(self):
        audit, rubric = load()
        first = rubric.criteria[0]
        changed = Criterion(
            first.id,
            "Can I just buy it?",
            first.policy,
            first.field,
            first.expect,
            first.options,
        )
        reworded = Rubric(
            rubric.id,
            rubric.title,
            rubric.scenario,
            (changed, *rubric.criteria[1:]),
        )
        self.assertNotEqual(
            idempotency_key(audit, rubric), idempotency_key(audit, reworded)
        )


class TestInputValidation(unittest.TestCase):
    def test_task_refuses_audit_rubric_mismatch(self):
        from types import SimpleNamespace

        from concord.cli import cmd_task

        args = SimpleNamespace(
            audit=str(ROOT / "fixtures" / "example-audit.json"),
            rubric=str(ROOT / "rubrics" / "repair-warranty.json"),
        )
        with self.assertRaises(ConcordError):
            cmd_task(args)


class TestCallWindow(unittest.TestCase):
    def setUp(self):
        self.audit, _ = load()
        self.tz = ZoneInfo(self.audit.timezone)

    def test_open_during_a_weekday_morning(self):
        moment = datetime(2026, 9, 3, 11, 0, tzinfo=self.tz)
        self.assertTrue(window_is_open(self.audit, moment))

    def test_closed_after_hours(self):
        moment = datetime(2026, 9, 3, 17, 52, tzinfo=self.tz)
        self.assertFalse(window_is_open(self.audit, moment))

    def test_closed_at_the_weekend(self):
        saturday = datetime(2026, 9, 5, 11, 0, tzinfo=self.tz)
        self.assertFalse(window_is_open(self.audit, saturday))


class TestResultParsing(unittest.TestCase):
    def test_provider_without_destinations_falls_back_to_request_order(self):
        audit, rubric = load()
        result = {
            "recipients": [
                {"structured_result": {"reached": True, "prescription_required": "no",
                                       "prescription_required_quote": "No prescription needed."}},
            ]
        }
        answers = answers_from_result(rubric, result, audit)
        self.assertEqual(answers[0].branch_id, audit.branches[0].id)
        self.assertEqual(answers[0].value, "no")

    def test_a_silent_branch_is_recorded_not_dropped(self):
        """Every branch in the audit is answered for, however few the provider returns."""
        audit, rubric = load()
        result = {"recipients": [{"structured_result": {}}]}
        answers = answers_from_result(rubric, result, audit)
        self.assertEqual(len(answers), len(audit.branches) * len(rubric.criteria))
        self.assertTrue(all(not a.reached for a in answers))
        findings = rule_all(rubric, answers)
        self.assertTrue(all(f.verdict == "UNCLEAR" for f in findings))

    def test_parsing_produces_no_verdict(self):
        audit, rubric = load()
        result = {"recipients": [{"structured_result": {"reached": True}}]}
        for answer in answers_from_result(rubric, result, audit):
            self.assertFalse(hasattr(answer, "verdict"))


if __name__ == "__main__":
    unittest.main()


class TestSecondRubric(unittest.TestCase):
    """The rubric format has to carry a scenario it was not designed around."""

    def test_a_different_domain_compiles_without_code_changes(self):
        audit = Audit.load(str(ROOT / "fixtures" / "warranty-audit.json"))
        rubric = Rubric.load(str(ROOT / "rubrics" / "repair-warranty.json"))
        schema = recipient_result_schema(rubric)
        self.assertEqual(
            schema["required"],
            ["reached", "covered", "diagnostic_fee_quoted", "collection_offered"],
        )
        self.assertEqual(len(build_payload(audit, rubric)["recipients"]), 2)

    def test_rubrics_do_not_share_an_idempotency_key(self):
        ec_audit, ec_rubric = load()
        war_audit = Audit.load(str(ROOT / "fixtures" / "warranty-audit.json"))
        war_rubric = Rubric.load(str(ROOT / "rubrics" / "repair-warranty.json"))
        self.assertNotEqual(
            idempotency_key(ec_audit, ec_rubric), idempotency_key(war_audit, war_rubric)
        )


class TestReviewRegressions(unittest.TestCase):
    """Findings from maintainer review of PR #303. Each held a documented promise."""

    def test_credential_never_leaves_a_trusted_https_origin(self):
        from concord.calle import CalleAPIError, CalleClient

        for bad in ("http://api.heycall-e.com", "https://evil.example.com", "ftp://x"):
            with self.assertRaises(CalleAPIError):
                CalleClient(api_key="k", base_url=bad)
        CalleClient(api_key="k", base_url="https://api.heycall-e.com")

    def test_rewording_a_question_invalidates_the_approval_token(self):
        import copy, json, os, tempfile
        from concord.cli import approval_token

        audit, rubric = load()
        before = approval_token(audit, rubric)
        raw = json.loads((ROOT / "rubrics" / "emergency-contraception.json").read_text())
        for mutate in (
            lambda d: d["criteria"][0].__setitem__("question", "Can I just buy it?"),
            lambda d: d["criteria"][0].__setitem__("policy", "Anything goes."),
            lambda d: d["criteria"][0]["options"].append("maybe"),
            lambda d: d.__setitem__("scenario", "Something else entirely."),
        ):
            edited = copy.deepcopy(raw)
            mutate(edited)
            handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
            json.dump(edited, handle)
            handle.close()
            try:
                self.assertNotEqual(before, approval_token(audit, Rubric.load(handle.name)))
            finally:
                os.unlink(handle.name)

    def test_changing_the_disclosed_organisation_invalidates_the_token(self):
        from concord.cli import approval_token

        audit, rubric = load()
        renamed = Audit(
            audit.id, "Someone Else Entirely", audit.rubric_id, audit.branches,
            audit.timezone, audit.call_window, audit.requested_by,
        )
        self.assertNotEqual(approval_token(audit, rubric), approval_token(renamed, rubric))

    def test_changing_the_call_window_invalidates_the_token(self):
        from concord.cli import approval_token

        audit, rubric = load()
        widened = Audit(
            audit.id, audit.org, audit.rubric_id, audit.branches,
            audit.timezone, ("00:00", "23:59"), audit.requested_by,
        )
        self.assertNotEqual(approval_token(audit, rubric), approval_token(widened, rubric))

    def test_reordering_the_call_intent_invalidates_the_token(self):
        from concord.cli import approval_token

        audit, rubric = load()
        reordered_audit = Audit(
            audit.id, audit.org, audit.rubric_id, tuple(reversed(audit.branches)),
            audit.timezone, audit.call_window, audit.requested_by,
        )
        reordered_rubric = Rubric(
            rubric.id, rubric.title, rubric.scenario, tuple(reversed(rubric.criteria))
        )
        self.assertNotEqual(
            approval_token(audit, rubric), approval_token(reordered_audit, rubric)
        )
        self.assertNotEqual(
            approval_token(audit, rubric), approval_token(audit, reordered_rubric)
        )

    def test_live_results_are_correlated_by_destination_not_position(self):
        audit, rubric = load()
        third = audit.branches[2]
        result = {
            "recipients": [
                {"phones": [third.phone],
                 "structured_result": {"reached": True, "prescription_required": "no",
                                       "prescription_required_quote": "No, buy it at the counter."}}
            ]
        }
        answers = answers_from_result(rubric, result, audit)
        matched = [a for a in answers if a.branch_id == third.id and a.criterion_id == "C1"][0]
        self.assertEqual(matched.value, "no")
        self.assertTrue(matched.reached)

    def test_a_branch_the_provider_omits_still_reaches_the_report(self):
        audit, rubric = load()
        result = {
            "recipients": [
                {"phones": [audit.branches[0].phone],
                 "structured_result": {"reached": True, "prescription_required": "no",
                                       "prescription_required_quote": "No, buy it at the counter."}}
            ]
        }
        answers = answers_from_result(rubric, result, audit)
        self.assertEqual(len(answers), len(audit.branches) * len(rubric.criteria))
        omitted = [a for a in answers if a.branch_id != audit.branches[0].id]
        self.assertTrue(all(not a.reached for a in omitted))
        findings = rule_all(rubric, answers)
        self.assertTrue(
            all(f.verdict == "UNCLEAR" for f in findings if f.branch_id != audit.branches[0].id)
        )

    def test_the_live_path_scrubs_a_spoken_name(self):
        """The scrub guarded fixture parsing but not live results, which is the
        only path where a real person's name can actually occur."""
        audit, rubric = load()
        result = {
            "recipients": [
                {"phones": [audit.branches[0].phone],
                 "structured_result": {
                     "reached": True,
                     "prescription_required": "no",
                     "prescription_required_quote": "This is Sarah, no you can buy it at the counter.",
                 }}
            ]
        }
        answers = answers_from_result(rubric, result, audit)
        quote = [a for a in answers if a.criterion_id == "C1"][0].quote
        self.assertNotIn("Sarah", quote)
        self.assertIn("counter", quote)

    def test_e164_rejects_non_ascii_digits(self):
        from concord.models import Branch, ConcordError

        with self.assertRaises(ConcordError):
            Branch.parse({"id": "B", "name": "N", "phone": "+९९३९२०५६३८", "authorization": "r"})

    def test_a_value_without_a_quote_is_never_a_deviation(self):
        """Every COMPLIANT or DEVIATION finding cites what was said. A provider
        that returns a bare value with no supporting words is unresolved."""
        from concord.judge import rule_one

        _, rubric = load()
        answer = Answer("B1", "C1", "yes", "", reached=True)
        finding = rule_one(rubric.criteria[0], answer)
        self.assertEqual(finding.verdict, "UNCLEAR")
        self.assertTrue(finding.needs_human_review)
