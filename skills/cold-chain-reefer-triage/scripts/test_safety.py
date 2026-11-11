#!/usr/bin/env python3
"""Offline regressions for exact destinations and phone-bearing provider copies."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from triage import initiate_reefer_triage, redact_phone_numbers, validate_e164_phone

DESTINATION = "+12065550198"
FORMATTED = ["+1 (206) 555-0198", "+1 206 555 0198", "206-555-0198", "(206) 555-0198"]


class FakeClient:
    base_url = "https://api.heycall-e.com"

    def __init__(self, fail=False):
        self.calls = self
        self.sent = []
        self.fail = fail

    def create_and_wait(self, **payload):
        self.sent.append(payload)
        if self.fail:
            raise RuntimeError("Provider failure for " + FORMATTED[0])
        return {"status": "failed", "evidence": {"nested": FORMATTED}}


def invoke(phone, client):
    return initiate_reefer_triage(
        phone, "Synthetic Driver", "TEST-TRUCK", "TEST-TRAILER",
        42, 35, "Synthetic Cold Hub", 10, client=client, live=True,
    )


class SafetyTests(unittest.TestCase):
    def test_reject_original_invalid_destination_without_dispatch(self):
        for phone in [" " + DESTINATION, DESTINATION + "\n", DESTINATION + " ", "+١٢٠٦٥٥٥٠١٩٨"]:
            with self.subTest(phone=phone):
                client = FakeClient()
                self.assertFalse(validate_e164_phone(phone))
                self.assertEqual(invoke(phone, client).status, "failed")
                self.assertEqual(client.sent, [])

    def test_dispatch_exact_validated_destination(self):
        client = FakeClient()
        invoke(DESTINATION, client)
        self.assertEqual(len(client.sent), 1)
        self.assertEqual(client.sent[0]["recipient"]["phones"], [DESTINATION])

    def test_mask_compact_and_formatted_nested_copies(self):
        source = {"nested": [DESTINATION, *FORMATTED]}
        masked = redact_phone_numbers(source)
        self.assertEqual(source["nested"], [DESTINATION, *FORMATTED])
        for phone in source["nested"]:
            self.assertNotIn(phone, str(masked))
        self.assertTrue(all("***" in value for value in masked["nested"]))
        self.assertEqual(invoke(DESTINATION, FakeClient()).evidence, {"nested": masked["nested"][1:]})

    def test_mask_failure_copy(self):
        result = invoke(DESTINATION, FakeClient(fail=True))
        self.assertEqual(result.status, "failed")
        self.assertNotIn(FORMATTED[0], result.error)
        self.assertIn("***", result.error)


if __name__ == "__main__":
    unittest.main()
