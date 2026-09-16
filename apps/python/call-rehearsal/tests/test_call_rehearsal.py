"""Tests for call-rehearsal.

These run offline and place no calls, which is the whole point of the tool.
"""

from __future__ import annotations

import contextlib
import io
import json
import unittest
from pathlib import Path

from callrehearsal import analysis, expressions
from callrehearsal.__main__ import EXIT_BLOCKED, EXIT_INPUT_ERROR, EXIT_OK, main
from callrehearsal.outcomes import OUTCOMES_BY_ID
from callrehearsal.plan import PlanError, build_plan, load_plan, suggest_decision_fields

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
UNSAFE = EXAMPLES / "delivery-confirmation-unsafe.json"
SAFE = EXAMPLES / "delivery-confirmation-safe.json"


def minimal_plan(**overrides) -> dict:
    plan = {
        "name": "minimal",
        "task": "Ask whether the appointment still works.",
        "result_schema": {
            "type": "object",
            "properties": {"confirmed": {"type": "boolean"}},
        },
        "fields": {"decision": "confirmed"},
        "decision_rule": {
            "expression": "confirmed == true",
            "on_true": {"action": "book it", "side_effect": True},
            "on_false": {"action": "do nothing", "side_effect": False},
        },
    }
    plan.update(overrides)
    return plan


class ExpressionTests(unittest.TestCase):
    def test_missing_field_is_falsy_not_an_error(self):
        self.assertFalse(expressions.evaluate("confirmed == true", {}))

    def test_negation_of_a_missing_field_is_true(self):
        # This is the silent default that dispatches on voicemail.
        self.assertTrue(expressions.evaluate("not declined", {}))

    def test_missing_is_not_equal_to_false(self):
        self.assertTrue(expressions.evaluate("confirmed != false", {}))

    def test_booleans_do_not_compare_equal_to_numbers(self):
        self.assertFalse(expressions.evaluate("confirmed == 1", {"confirmed": True}))

    def test_is_missing_and_is_present(self):
        self.assertTrue(expressions.evaluate("is_missing(confirmed)", {}))
        self.assertTrue(expressions.evaluate("is_present(confirmed)", {"confirmed": False}))

    def test_ordering_against_a_missing_field_is_false(self):
        self.assertFalse(expressions.evaluate("score > 3", {}))

    def test_referenced_fields_ignores_literals_and_helpers(self):
        fields = expressions.referenced_fields("confirmed == true and is_missing(notes)")
        self.assertEqual(fields, {"confirmed", "notes"})

    def test_arbitrary_calls_are_rejected(self):
        with self.assertRaises(expressions.ExpressionError):
            expressions.evaluate('__import__("os").system("true")', {})

    def test_attribute_access_is_rejected(self):
        with self.assertRaises(expressions.ExpressionError):
            expressions.evaluate("(1).__class__", {})

    def test_subscripting_is_rejected(self):
        with self.assertRaises(expressions.ExpressionError):
            expressions.evaluate("result['confirmed']", {})


class PlanTests(unittest.TestCase):
    def test_decision_field_must_be_declared(self):
        raw = minimal_plan(fields={})
        with self.assertRaises(PlanError) as caught:
            build_plan(raw)
        self.assertIn("fields.decision", str(caught.exception))

    def test_decision_field_must_exist_in_schema(self):
        raw = minimal_plan(fields={"decision": "nope"})
        with self.assertRaises(PlanError):
            build_plan(raw)

    def test_unknown_field_role_is_rejected(self):
        raw = minimal_plan(fields={"decision": "confirmed", "mood": "confirmed"})
        with self.assertRaises(PlanError):
            build_plan(raw)

    def test_expression_cannot_read_unknown_fields(self):
        raw = minimal_plan()
        raw["decision_rule"]["expression"] = "mystery == true"
        with self.assertRaises(PlanError):
            build_plan(raw)

    def test_side_effect_must_be_declared_explicitly(self):
        raw = minimal_plan()
        del raw["decision_rule"]["on_true"]["side_effect"]
        with self.assertRaises(PlanError):
            build_plan(raw)

    def test_suggestions_are_offered_but_never_applied(self):
        schema = {"properties": {"confirmed": {"type": "boolean"}, "notes": {"type": "string"}}}
        self.assertEqual(suggest_decision_fields(schema), ["confirmed"])


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.plan = load_plan(SAFE)

    def test_unreached_call_leaves_the_decision_absent(self):
        result = analysis.project(self.plan, OUTCOMES_BY_ID["voicemail"])
        self.assertNotIn("confirmed", result)
        self.assertEqual(result["call_status"], "voicemail")

    def test_wrong_person_agrees_but_identity_is_false(self):
        result = analysis.project(self.plan, OUTCOMES_BY_ID["wrong_person"])
        self.assertTrue(result["confirmed"])
        self.assertFalse(result["identity_verified"])

    def test_only_a_verified_consenting_yes_counts_as_confirmation(self):
        self.assertTrue(OUTCOMES_BY_ID["human_confirmed"].is_confirmation)
        for identifier in ("wrong_person", "consent_refused", "voicemail", "human_deferred"):
            self.assertFalse(OUTCOMES_BY_ID[identifier].is_confirmation, identifier)


class AnalysisTests(unittest.TestCase):
    def test_unsafe_plan_dispatches_on_voicemail(self):
        plan = load_plan(UNSAFE)
        rehearsals = analysis.rehearse(plan)
        voicemail = next(r for r in rehearsals if r.outcome.identifier == "voicemail")
        self.assertTrue(voicemail.side_effect)

        findings = analysis.analyse(plan, rehearsals)
        critical = [f for f in findings if f.severity == analysis.CRITICAL]
        self.assertTrue(critical)
        self.assertIn("voicemail", {f.outcome for f in critical})
        self.assertEqual(analysis.worst_severity(findings), analysis.CRITICAL)

    def test_safe_plan_has_no_findings(self):
        plan = load_plan(SAFE)
        findings = analysis.analyse(plan, analysis.rehearse(plan))
        self.assertEqual(findings, [])

    def test_safe_plan_never_side_effects_without_a_confirmation(self):
        plan = load_plan(SAFE)
        for item in analysis.rehearse(plan):
            if item.side_effect:
                self.assertTrue(item.outcome.is_confirmation, item.outcome.identifier)

    def test_every_outcome_is_rehearsed(self):
        plan = load_plan(SAFE)
        self.assertEqual(len(analysis.rehearse(plan)), len(OUTCOMES_BY_ID))

    def test_report_is_json_serialisable(self):
        plan = load_plan(UNSAFE)
        rehearsals = analysis.rehearse(plan)
        report = analysis.to_dict(plan, rehearsals, analysis.analyse(plan, rehearsals))
        json.dumps(report)
        self.assertEqual(report["worst_severity"], analysis.CRITICAL)


class CommandLineTests(unittest.TestCase):
    def run_cli(self, argv):
        """Run the CLI, keeping its report out of the test output."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue()

    def test_unsafe_plan_blocks(self):
        code, output = self.run_cli([str(UNSAFE)])
        self.assertEqual(code, EXIT_BLOCKED)
        self.assertIn("Voicemail answered", output)

    def test_safe_plan_passes(self):
        code, output = self.run_cli([str(SAFE)])
        self.assertEqual(code, EXIT_OK)
        self.assertIn("No findings", output)

    def test_missing_plan_is_an_input_error(self):
        code, _ = self.run_cli([str(EXAMPLES / "does-not-exist.json")])
        self.assertEqual(code, EXIT_INPUT_ERROR)

    def test_threshold_can_be_relaxed_but_criticals_still_block(self):
        code, _ = self.run_cli([str(UNSAFE), "--fail-on", "critical"])
        self.assertEqual(code, EXIT_BLOCKED)

    def test_json_report_is_emitted(self):
        code, output = self.run_cli([str(SAFE), "--json"])
        self.assertEqual(code, EXIT_OK)
        payload = json.loads(output)
        self.assertEqual(payload["worst_severity"], None)
        self.assertEqual(len(payload["outcomes"]), 12)


if __name__ == "__main__":
    unittest.main()
