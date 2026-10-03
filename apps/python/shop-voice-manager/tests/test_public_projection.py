"""No-network regression for the final API projection boundary."""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "web"))
import server


class PublicProjectionTests(unittest.TestCase):
    def test_nested_detail_fields_are_redacted_without_mutating_private_input(self):
        phone = "+12025550123"
        payload = {
            "top_sellers": [{"name": "Contact " + phone}],
            "procurement_items": [{"notes": "Call " + phone}],
            "products": [{"description": "Supplier " + phone}],
            "recipient": {"phone": phone},
            "error": "Provider mentioned " + phone,
        }
        original = copy.deepcopy(payload)
        captured = []

        class Capture:
            def _send(self, status, body, content_type):
                captured.append((status, body, content_type))

        server.Handler._json(Capture(), 200, payload)
        self.assertEqual(payload, original)
        status, body, content_type = captured[0]
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "application/json; charset=utf-8")
        self.assertNotIn(phone, body.decode())
        self.assertEqual(json.loads(body)["top_sellers"][0]["name"], "Contact [phone]")


if __name__ == "__main__":
    unittest.main()
