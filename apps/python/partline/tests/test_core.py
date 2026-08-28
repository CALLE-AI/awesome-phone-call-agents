import json
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from partline.calle import CalleAPIError, CalleClient
from partline.core import (
    PartLineError,
    SourcingRequest,
    approval_token,
    build_payload,
    build_plan,
    idempotency_key,
    mask_phone,
    rank_results,
)


ROOT = Path(__file__).resolve().parents[1]


class PartLineCoreTests(unittest.TestCase):
    def request(self) -> SourcingRequest:
        return SourcingRequest.load(str(ROOT / "fixtures" / "example-request.json"))

    def test_preview_masks_phone_numbers(self) -> None:
        plan = build_plan(self.request())
        serialized = json.dumps(plan)
        self.assertNotIn("+1555010101", serialized)
        self.assertEqual(plan["recipients"][0]["phone"], "+15******01")

    def test_approval_and_idempotency_are_stable(self) -> None:
        request = self.request()
        self.assertEqual(approval_token(request), approval_token(request))
        self.assertEqual(idempotency_key(request), idempotency_key(request))

    def test_unauthorized_supplier_is_rejected(self) -> None:
        data = json.loads((ROOT / "fixtures" / "example-request.json").read_text())
        data["suppliers"][0]["authorized_contact"] = False
        with self.assertRaises(PartLineError):
            SourcingRequest.from_dict(data).validate()

    def test_duplicate_phone_is_rejected(self) -> None:
        data = json.loads((ROOT / "fixtures" / "example-request.json").read_text())
        data["suppliers"][1]["phone"] = data["suppliers"][0]["phone"]
        with self.assertRaises(PartLineError):
            SourcingRequest.from_dict(data).validate()

    def test_call_window_is_weekday_only(self) -> None:
        window = self.request().call_window
        monday = datetime(2026, 8, 31, 10, 0, tzinfo=ZoneInfo("America/Chicago"))
        sunday = datetime(2026, 8, 30, 10, 0, tzinfo=ZoneInfo("America/Chicago"))
        self.assertTrue(window.is_open(monday))
        self.assertFalse(window.is_open(sunday))

    def test_unknown_result_fails_closed(self) -> None:
        result = json.loads((ROOT / "fixtures" / "completed-call.json").read_text())
        ranked = rank_results(result, self.request())
        self.assertEqual(ranked[0]["match_status"], "exact")
        compatible = next(item for item in ranked if item["match_status"] == "compatible")
        self.assertTrue(compatible["needs_human_followup"])
        unknown = next(item for item in ranked if item["match_status"] == "unknown")
        self.assertTrue(unknown["needs_human_followup"])

    def test_payload_uses_documented_recipient_fields(self) -> None:
        recipient = build_payload(self.request())["recipients"][0]
        self.assertEqual(set(recipient), {"phones", "region", "locale"})

    def test_exact_claim_is_checked_against_request(self) -> None:
        result = json.loads((ROOT / "fixtures" / "completed-call.json").read_text())
        result["recipients"][0]["structured_result"]["part_number_confirmed"] = "WRONG-PART"
        ranked = rank_results(result, self.request())
        acme = next(item for item in ranked if item["supplier"] == "Acme Industrial Supply")
        self.assertEqual(acme["match_status"], "unknown")
        self.assertTrue(acme["needs_human_followup"])

    def test_mask_phone(self) -> None:
        self.assertEqual(mask_phone("+1555010101"), "+15******01")

    def test_live_credentials_require_official_https_origin(self) -> None:
        with self.assertRaises(CalleAPIError):
            CalleClient("test-key", "http://127.0.0.1:8787")
        with self.assertRaises(CalleAPIError):
            CalleClient("test-key", "https://example.invalid")
        self.assertEqual(
            CalleClient("test-key", "https://api.heycall-e.com/").base_url,
            "https://api.heycall-e.com",
        )


if __name__ == "__main__":
    unittest.main()
