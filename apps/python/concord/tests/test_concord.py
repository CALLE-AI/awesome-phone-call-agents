import importlib
import json
import unittest
from pathlib import Path

from concord.cli import approval_token
from concord.judge import rule_all, rule_one
from concord.models import (
    QUOTE_MAX,
    Answer,
    Audit,
    Branch,
    ConcordError,
    Criterion,
    Finding,
    Rubric,
)
from concord.report import render, summarise

ROOT = Path(__file__).resolve().parents[1]
RUBRIC = ROOT / "rubrics" / "emergency-contraception.json"
AUDIT = ROOT / "fixtures" / "example-audit.json"
RESULTS = ROOT / "fixtures" / "completed-audit.json"


def load_all():
    audit = Audit.load(str(AUDIT))
    rubric = Rubric.load(str(RUBRIC))
    raw = json.loads(RESULTS.read_text())
    answers = [Answer.parse(a) for a in raw["answers"]]
    return audit, rubric, answers


class TestNegationRegression(unittest.TestCase):
    """The bug that made this design necessary.

    Phrase matching read "No, you don't need a prescription" as a deviation
    because the string "need a prescription" is inside it. Ruling on the
    extracted value instead of the transcript is what fixes it.
    """

    def setUp(self):
        self.criterion = Criterion.parse(
            {
                "id": "C1",
                "question": "Do I need a prescription?",
                "policy": "No prescription is required.",
                "field": "prescription_required",
                "expect": "no",
                "options": ["yes", "no", "unclear"],
            }
        )

    def test_correct_answer_containing_the_forbidden_phrase_is_compliant(self):
        answer = Answer("B1", "C1", "no", "No, you don't need a prescription for that.")
        self.assertEqual(rule_one(self.criterion, answer).verdict, "COMPLIANT")

    def test_wrong_answer_is_a_deviation(self):
        answer = Answer("B2", "C1", "yes", "You'll need a doctor's note.")
        self.assertEqual(rule_one(self.criterion, answer).verdict, "DEVIATION")


class TestSilenceIsNotFailure(unittest.TestCase):
    def setUp(self):
        _, self.rubric, _ = load_all()
        self.criterion = self.rubric.criteria[0]

    def test_unreached_branch_is_unclear_not_deviation(self):
        finding = rule_one(self.criterion, Answer("B4", "C1", "", "", reached=False))
        self.assertEqual(finding.verdict, "UNCLEAR")
        self.assertTrue(finding.needs_human_review)

    def test_unresolved_value_is_unclear(self):
        finding = rule_one(self.criterion, Answer("B2", "C1", "unclear", "As soon as you can."))
        self.assertEqual(finding.verdict, "UNCLEAR")

    def test_value_outside_the_allowed_options_is_not_guessed_at(self):
        finding = rule_one(self.criterion, Answer("B2", "C1", "maybe", "Hard to say."))
        self.assertEqual(finding.verdict, "UNCLEAR")

    def test_a_skipped_question_still_appears(self):
        _, rubric, _ = load_all()
        findings = rule_all(rubric, [Answer("B1", "C1", "no", "No prescription needed.")])
        self.assertEqual(len(findings), len(rubric.criteria))
        self.assertEqual(sum(1 for f in findings if f.verdict == "UNCLEAR"), 3)


class TestSurveillanceBoundary(unittest.TestCase):
    """Concord reports on branches. It must not be able to report on a person."""

    def test_a_finding_cannot_carry_a_person_or_a_number(self):
        fields = set(Finding.__dataclass_fields__)
        for forbidden in ("staff", "employee", "name", "phone", "agent", "operator"):
            self.assertNotIn(forbidden, fields)

    def test_rendered_report_contains_no_phone_numbers(self):
        audit, rubric, answers = load_all()
        text = render(audit, rubric, rule_all(rubric, answers))
        for branch in audit.branches:
            self.assertNotIn(branch.phone, text)

    def test_report_states_the_boundary(self):
        audit, rubric, answers = load_all()
        text = render(audit, rubric, rule_all(rubric, answers))
        self.assertIn("not a performance record", text)

    def test_judge_cannot_place_a_call(self):
        """Read the imports out of the source, not out of the module namespace.

        The earlier version checked judge.__dict__ for six hardcoded names,
        which would miss `import ssl` and would miss
        `from concord.calle import CalleClient as C`. Allow-listing the
        modules judge may import catches both.
        """
        import ast

        source = (ROOT / "src" / "concord" / "judge.py").read_text()
        imported: set[str] = set()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Import):
                imported.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add((node.module or "").split(".")[0])
        self.assertEqual(imported, {"__future__", "concord"})

    def test_judge_source_never_mentions_the_call_client(self):
        source = (ROOT / "src" / "concord" / "judge.py").read_text()
        self.assertNotIn("CalleClient", source)
        self.assertNotIn("concord.calle", source)


class TestQuoteRedaction(unittest.TestCase):
    """A quote is the one free-text field, so it is the one way in for a name."""

    def test_self_identification_is_stripped(self):
        answer = Answer.parse(
            {"branch_id": "B1", "criterion_id": "C1", "value": "no",
             "quote": "This is Sarah, no you don't need a prescription."}
        )
        self.assertNotIn("Sarah", answer.quote)
        self.assertIn("prescription", answer.quote)

    def test_name_speaking_is_stripped(self):
        answer = Answer.parse(
            {"branch_id": "B1", "criterion_id": "C3", "value": "yes",
             "quote": "Priya speaking, we have it in stock."}
        )
        self.assertNotIn("Priya", answer.quote)

    def test_a_normal_answer_survives_untouched(self):
        text = "No, you don't need a prescription for that."
        answer = Answer.parse(
            {"branch_id": "B1", "criterion_id": "C1", "value": "no", "quote": text}
        )
        self.assertEqual(answer.quote, text)

    def test_a_long_quote_is_capped(self):
        answer = Answer.parse(
            {"branch_id": "B1", "criterion_id": "C1", "value": "no", "quote": "word " * 200}
        )
        self.assertLessEqual(len(answer.quote), QUOTE_MAX + 8)


class TestAuthorisation(unittest.TestCase):
    def test_branch_without_authorization_is_refused(self):
        with self.assertRaises(ConcordError):
            Branch.parse({"id": "B9", "name": "Rogue", "phone": "+447700900999", "authorization": ""})

    def test_non_e164_phone_is_refused(self):
        with self.assertRaises(ConcordError):
            Branch.parse({"id": "B9", "name": "Rogue", "phone": "0555 010 1999", "authorization": "x"})

    def test_phone_is_masked(self):
        branch = Branch.parse(
            {"id": "B1", "name": "N", "phone": "+447700900101", "authorization": "register"}
        )
        self.assertNotIn("0101201", branch.masked_phone)
        self.assertTrue(branch.masked_phone.endswith("01"))


class TestApproval(unittest.TestCase):
    def test_token_is_stable_for_an_unchanged_audit(self):
        audit, rubric, _ = load_all()
        self.assertEqual(approval_token(audit, rubric), approval_token(audit, rubric))

    def test_editing_the_branch_list_invalidates_the_token(self):
        audit, rubric, _ = load_all()
        before = approval_token(audit, rubric)
        edited = Audit(
            id=audit.id,
            org=audit.org,
            rubric_id=audit.rubric_id,
            branches=audit.branches[:2],
            timezone=audit.timezone,
            call_window=audit.call_window,
            requested_by=audit.requested_by,
        )
        self.assertNotEqual(before, approval_token(edited, rubric))


class TestRubric(unittest.TestCase):
    def test_duplicate_criterion_ids_are_refused(self):
        path = ROOT / "tests" / "_dup.json"
        path.write_text(
            json.dumps(
                {
                    "id": "R",
                    "title": "T",
                    "scenario": "S",
                    "criteria": [
                        {"id": "C1", "question": "q", "policy": "p", "field": "f", "expect": "no"},
                        {"id": "C1", "question": "q", "policy": "p", "field": "f", "expect": "no"},
                    ],
                }
            )
        )
        try:
            with self.assertRaises(ConcordError):
                Rubric.load(str(path))
        finally:
            path.unlink()

    def test_expected_value_must_be_one_of_the_options(self):
        with self.assertRaises(ConcordError):
            Criterion.parse(
                {
                    "id": "C1",
                    "question": "q",
                    "policy": "p",
                    "field": "f",
                    "expect": "maybe",
                    "options": ["yes", "no"],
                }
            )


class TestSummary(unittest.TestCase):
    def test_compliant_branch_reports_no_gaps(self):
        audit, rubric, answers = load_all()
        rows = {s.branch_id: s for s in summarise(audit, rule_all(rubric, answers))}
        self.assertEqual(rows["B1"].deviations, 0)
        self.assertFalse(rows["B1"].needs_attention)
        self.assertTrue(rows["B2"].needs_attention)


if __name__ == "__main__":
    unittest.main()
