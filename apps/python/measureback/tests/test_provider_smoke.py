import json
from pathlib import Path
import subprocess
import sys
import unittest

from measureback.calle import CalleError
from scripts.smoke_provider import MOCK_KEY, run_smoke


class ProviderSmokeTests(unittest.TestCase):
    def test_actual_http_transport_and_durable_duplicate_protection(self):
        result = run_smoke()
        self.assertEqual(result["mode"], "local_fake_http")
        self.assertEqual(result["provider_host"], "127.0.0.1")
        self.assertEqual(result["post_count"], 1)
        self.assertEqual(result["get_count"], 1)
        self.assertTrue(result["duplicate_prevented"])
        self.assertFalse(result["real_call_placed"])
        self.assertEqual(result["source_validation"], "passed")
        self.assertTrue(result["consent_review_required"])
        self.assertEqual(result["corrected_water_ml"], "900")
        self.assertEqual(result["scaled_water_ml"], "1350")
        self.assertNotIn(MOCK_KEY, json.dumps(result))
        self.assertNotIn("+12025550123", json.dumps(result))

    def test_actual_http_result_rejects_a_fabricated_source(self):
        with self.assertRaises(CalleError):
            run_smoke(tamper_transcript=True)

    def test_documented_direct_command_returns_json_receipt(self):
        root = Path(__file__).resolve().parents[1]
        completed = subprocess.run(
            [sys.executable, "scripts/smoke_provider.py"], cwd=root,
            capture_output=True, text=True, check=True, timeout=20,
        )
        result = json.loads(completed.stdout)
        self.assertFalse(result["real_call_placed"])
        self.assertEqual(result["post_count"], 1)
        self.assertEqual(result["scaled_water_ml"], "1350")
        self.assertEqual(completed.stderr, "")


if __name__ == "__main__":
    unittest.main()
