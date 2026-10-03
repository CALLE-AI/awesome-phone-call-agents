"""Offline display/private-payload regressions; no provider or network access."""
import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _display import for_display
from plan import plan_one
from _pcv import load_pack

ROOT = Path(__file__).resolve().parent
PACK = ROOT.parent / "examples/healthcare.json"
PHONE = "+12025550100"
RECORD = {"record_id": "synthetic", "name": f"Demo office {PHONE}", "phone": PHONE,
          "claims": {"accepts_plan": True}}


class DisplayTests(unittest.TestCase):
    def run_script(self, script, *args):
        return subprocess.run([sys.executable, str(ROOT / script), *args], text=True,
                              capture_output=True, check=False)

    def test_preview_and_private_plan_are_separate(self):
        private = plan_one(RECORD, load_pack(PACK))
        display = for_display(private)
        self.assertNotIn(PHONE, json.dumps(display))
        self.assertEqual(private["dial"], PHONE)
        self.assertIn(PHONE, private["goal"])
        args = ["--record", json.dumps(RECORD), "--pack", str(PACK)]
        public = self.run_script("plan.py", *args)
        machine = self.run_script("plan.py", *args, "--private-payload")
        self.assertEqual(public.returncode, 0)
        self.assertNotIn(PHONE, public.stdout)
        self.assertEqual(json.loads(machine.stdout)["dial"], PHONE)

    def test_invalid_phone_and_parser_errors_are_masked(self):
        invalid = {**RECORD, "phone": f"bad {PHONE}"}
        result = self.run_script("plan.py", "--record", json.dumps(invalid), "--pack", str(PACK))
        self.assertNotIn(PHONE, result.stdout + result.stderr)
        self.assertIn("not E.164", result.stdout)
        result = self.run_script("plan.py", "--record", json.dumps(invalid), "--pack", str(PACK), "--private-payload")
        self.assertNotIn(PHONE, result.stdout + result.stderr)
        result = self.run_script("plan.py", "--pack", str(PACK), f"--unknown={PHONE}")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(PHONE, result.stderr)

    def test_verdict_masks_display_but_preserves_matching_and_private_correction(self):
        quote = f"No, we no longer accept that plan; our number is {PHONE}."
        with tempfile.TemporaryDirectory(prefix="pcv-display-") as directory:
            transcript = Path(directory) / "transcript.json"
            corrections = Path(directory) / "corrections.csv"
            transcript.write_text(json.dumps([{"speaker": "user", "text": quote}]))
            args = ["--record", json.dumps(RECORD), "--pack", str(PACK), "--claim", "accepts_plan",
                    "--transcript", str(transcript), "--extraction", json.dumps({"answer": "no", "evidence_span": quote}),
                    "--corrections", str(corrections)]
            result = self.run_script("verdict.py", *args)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(PHONE, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)["verdict"], "MISMATCH")
            with corrections.open(newline="") as stream:
                self.assertIn(quote, json.dumps(list(csv.DictReader(stream))))
            machine = self.run_script("verdict.py", *args, "--private-payload")
            self.assertEqual(json.loads(machine.stdout)["evidence_span"], quote)

    def test_nested_display_preserves_dates_and_private_values(self):
        private = {"phone": PHONE, "quote": [f"Reach (202) 555-0100 or {PHONE}"], "date": "2026-09-15"}
        shown = for_display(private)
        self.assertNotIn(PHONE, json.dumps(shown))
        self.assertNotIn("555-0100", json.dumps(shown))
        self.assertEqual(shown["date"], "2026-09-15")
        self.assertEqual(private["phone"], PHONE)


if __name__ == "__main__":
    unittest.main()
