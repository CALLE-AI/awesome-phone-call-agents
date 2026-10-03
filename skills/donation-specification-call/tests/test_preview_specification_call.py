from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "preview_specification_call.py"
PLAN_PATH = ROOT / "assets" / "example-donation.json"
RESULT_PATH = ROOT / "assets" / "example-result.json"

spec = importlib.util.spec_from_file_location("preview_specification_call", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class DonationSpecificationCallTests(unittest.TestCase):
    def test_preview_never_places_a_call(self):
        plan = load(PLAN_PATH)
        module.validate_plan(plan)
        preview = module.preview(plan)
        self.assertFalse(preview["call_placed"])
        self.assertEqual(preview["side_effect"], "none")
        self.assertEqual(preview["contact"], plan["contact_masked"])

    def test_idempotency_is_stable(self):
        plan = load(PLAN_PATH)
        self.assertEqual(module.idempotency_key(plan), module.idempotency_key(plan))

    def test_valid_fixture_stays_reported_and_unallocated(self):
        result = module.reconcile(load(PLAN_PATH), load(RESULT_PATH))
        self.assertEqual(len(result["accepted_claims"]), 3)
        self.assertTrue(
            all(c["verification_level"] == "donor_reported" for c in result["accepted_claims"])
        )
        self.assertTrue(result["human_review_required"])
        self.assertFalse(result["allocation_approved"])

    def test_unasked_attribute_is_rejected(self):
        result = load(RESULT_PATH)
        result["attribute_updates"].append(
            {
                "subject_reference": "BOX-SCHOOL-04",
                "attribute_key": "quantity",
                "value": 200,
                "unit": "items",
                "supporting_quote": "There are two hundred.",
            }
        )
        reconciled = module.reconcile(load(PLAN_PATH), result)
        self.assertTrue(
            any(
                "not in the approved question set" in item["reason"]
                for item in reconciled["rejected_updates"]
            )
        )

    def test_missing_quote_is_rejected(self):
        result = load(RESULT_PATH)
        result["attribute_updates"][0]["supporting_quote"] = None
        reconciled = module.reconcile(load(PLAN_PATH), result)
        self.assertTrue(
            any(
                item["reason"] == "a supporting quote is required"
                for item in reconciled["rejected_updates"]
            )
        )

    def test_wrong_person_applies_nothing(self):
        result = load(RESULT_PATH)
        result["reached_intended_contact"] = "no"
        reconciled = module.reconcile(load(PLAN_PATH), result)
        self.assertEqual(reconciled["accepted_claims"], [])
        self.assertEqual(reconciled["outcome"], "unresolved_contact_or_consent")

    def test_invalid_value_is_rejected(self):
        result = load(RESULT_PATH)
        result["attribute_updates"][0]["value"] = 99
        reconciled = module.reconcile(load(PLAN_PATH), result)
        self.assertTrue(
            any("maximum" in item["reason"] for item in reconciled["rejected_updates"])
        )


if __name__ == "__main__":
    unittest.main()
