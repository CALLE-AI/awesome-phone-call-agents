import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("prepare_followup.py")
SPEC = importlib.util.spec_from_file_location("prepare_followup", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


def trace(action: str) -> dict:
    return {"case_id": "DEMO-4821", "decision": {"action": action}}


def request(**overrides: object) -> dict:
    value = {
        "request_id": "FOLLOWUP-4821-SIDE",
        "phone": "+14165550199",
        "contact_label": "parcel owner",
        "authorized_contact": True,
        "recipient_consented": True,
        "caller_name": "Northstar Demo Store",
        "secure_upload_route": "the existing order portal",
    }
    value.update(overrides)
    return value


class PrepareFollowupTests(unittest.TestCase):
    def test_each_supported_action_changes_requested_photo(self) -> None:
        evidence = {
            action: MODULE.build_preview(trace(action), request())["requested_evidence"]
            for action in MODULE.REQUESTS
        }
        self.assertEqual(len(set(evidence.values())), 4)

    def test_preview_masks_phone_and_is_deterministic(self) -> None:
        first = MODULE.build_preview(trace("REQUEST_SIDE_VIEW"), request())
        second = MODULE.build_preview(trace("REQUEST_SIDE_VIEW"), request())
        self.assertNotIn("+14165550199", str(first))
        self.assertIn("***", first["masked_recipient"])
        self.assertEqual(first["idempotency_key"], second["idempotency_key"])
        self.assertFalse(first["live_call_placed"])

    def test_no_call_when_trace_already_supports_decision(self) -> None:
        preview = MODULE.build_preview(trace("STAGE_CLAIM_PACKET"), {})
        self.assertFalse(preview["call_needed"])

    def test_rejects_unconsented_contact(self) -> None:
        with self.assertRaisesRegex(ValueError, "recipient_consented"):
            MODULE.build_preview(trace("REQUEST_RETAKE"), request(recipient_consented=False))

    def test_rejects_non_e164_number(self) -> None:
        with self.assertRaisesRegex(ValueError, "E.164"):
            MODULE.build_preview(trace("REQUEST_RETAKE"), request(phone="416-555-0199"))

    def test_task_discloses_ai_and_forbids_sensitive_requests(self) -> None:
        task = MODULE.build_preview(trace("REQUEST_LABEL_PHOTO"), request())["task"]
        self.assertIn("AI calling assistant", task)
        self.assertIn("Do not ask for", task)
        self.assertIn("no second call", task)


if __name__ == "__main__":
    unittest.main()
