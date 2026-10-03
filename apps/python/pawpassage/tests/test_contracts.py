from __future__ import annotations

import copy
import unittest

from pawpassage.contracts import (
    ResultContractError,
    provider_result_schema,
    validate_and_evaluate,
)
from tests.helpers import completed_result


class ResultContractTests(unittest.TestCase):
    def test_provider_schema_is_closed_and_uses_only_explicit_types_and_enums(
        self,
    ) -> None:
        schema = provider_result_schema()
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(set(schema["required"]), set(schema["properties"]))
        rendered = str(schema)
        self.assertNotIn("const", rendered)
        self.assertNotIn("anyOf", rendered)
        self.assertNotIn("oneOf", rendered)

    def test_all_confirmed_with_written_source_is_evidence_ready_but_never_authority(
        self,
    ) -> None:
        evaluated = validate_and_evaluate(completed_result())
        self.assertEqual(evaluated.disposition, "EVIDENCE_PACKET_READY")
        self.assertFalse(evaluated.action_authorized)

    def test_contradiction_is_a_gap(self) -> None:
        result = completed_result(
            propositions={"P1": "CONTRADICTED", "P2": "CONFIRMED", "P3": "CONFIRMED"}
        )
        evaluated = validate_and_evaluate(result)
        self.assertEqual(evaluated.disposition, "GAPS_FOUND")
        self.assertEqual(evaluated.reason_codes, ("P1_CONTRADICTED",))

    def test_unestablished_answer_requires_human(self) -> None:
        result = completed_result(
            propositions={"P1": "CONFIRMED", "P2": "NOT_ESTABLISHED", "P3": "CONFIRMED"}
        )
        self.assertEqual(
            validate_and_evaluate(result).disposition, "NEEDS_HUMAN_REVIEW"
        )

    def test_no_written_reference_never_becomes_ready(self) -> None:
        result = completed_result(writtenReference="NOT_OFFERED")
        self.assertEqual(
            validate_and_evaluate(result).reason_codes,
            ("NO_WRITTEN_REFERENCE_OFFERED",),
        )

    def test_commitment_or_payment_boundary_stops_automation(self) -> None:
        for value in ("YES", "UNKNOWN"):
            with self.subTest(value=value):
                evaluated = validate_and_evaluate(
                    completed_result(commitmentRequested=value)
                )
                self.assertEqual(evaluated.disposition, "NEEDS_HUMAN_REVIEW")
                self.assertIn("COMMITMENT_OR_PAYMENT_BOUNDARY", evaluated.reason_codes)

    def test_do_not_contact_is_preserved(self) -> None:
        result = completed_result(
            contactOutcome="DO_NOT_CONTACT",
            roleMatch="UNKNOWN",
            propositions={
                "P1": "NOT_ESTABLISHED",
                "P2": "NOT_ESTABLISHED",
                "P3": "NOT_ESTABLISHED",
            },
            writtenReference="UNKNOWN",
            commitmentRequested="UNKNOWN",
        )
        self.assertEqual(validate_and_evaluate(result).disposition, "DO_NOT_CONTACT")

    def test_unreached_cannot_smuggle_factual_answers(self) -> None:
        result = completed_result(contactOutcome="UNREACHED", roleMatch="UNKNOWN")
        with self.assertRaisesRegex(
            ResultContractError, "UNREACHED_RESULT_CONTRADICTION"
        ):
            validate_and_evaluate(result)

    def test_wrong_role_cannot_supply_factual_answers(self) -> None:
        result = completed_result(roleMatch="NO")
        with self.assertRaisesRegex(
            ResultContractError, "WRONG_ROLE_HAS_FACTUAL_ANSWERS"
        ):
            validate_and_evaluate(result)

    def test_extra_missing_and_unknown_fields_fail_closed(self) -> None:
        extra = completed_result()
        extra["summary"] = "free text"
        missing = completed_result()
        missing.pop("writtenReference")
        unknown = completed_result()
        unknown["propositions"] = copy.deepcopy(unknown["propositions"])
        unknown["propositions"]["P2"] = "MAYBE"
        for value in (extra, missing, unknown, [], None):
            with self.subTest(value=value), self.assertRaises(ResultContractError):
                validate_and_evaluate(value)


if __name__ == "__main__":
    unittest.main()
