"""Frozen adversarial red-team set for the transcript verifier.

Every NEGATIVE case below must come back NOT verified (verified is reserved
for callee-side, anchored, typed, non-negated evidence). Several cases carry
an exact honest verdict (contradicted) which we assert. The POSITIVE cases
guard against an "always abstain" verifier that never verifies anything.

Cases run end-to-end through verify_result.py main (subprocess), so the
provider gate and the speaker pipeline are exercised exactly as in a judge
run. Stdlib only, no credentials, no network.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERIFY = ROOT / "scripts" / "verify_result.py"


def run_verify(payload: dict) -> dict:
    proc = subprocess.run(
        [sys.executable, str(VERIFY), "--result", "-"],
        input=json.dumps(payload), capture_output=True, text=True, timeout=30,
    )
    if proc.returncode != 0:
        raise AssertionError(f"verify_result exited {proc.returncode}: {proc.stderr}")
    return json.loads(proc.stdout)


def case(fields: dict, transcript, ok=True, status="COMPLETED", extra: dict | None = None) -> dict:
    payload = {
        "ok": ok,
        "tool_name": "get_call_run",
        "status": status,
        "structuredContent": {
            "status": status,
            "result": {
                "structured_result": fields,
                "transcript": transcript,
            },
        },
    }
    if extra:
        payload.update(extra)
    return payload


# (name, fields, transcript, exact verdict or None for "just not verified")
NEGATIVES = [
    ("structured assistant turn is not evidence",
     {"refill_status": "ready"},
     [{"speaker": "assistant", "text": "Your prescription is ready for pickup."}], None),
    ("full-width assistant colon is not evidence",
     {"refill_status": "ready"},
     "ASSISTANT：Your prescription is ready for pickup.", None),
    ("system turn is not evidence",
     {"refill_status": "ready"},
     "SYSTEM: Your prescription is ready for pickup.", None),
    ("unlabeled turn is not evidence",
     {"refill_status": "ready"},
     "Your prescription is ready for pickup.", None),
    ("contraction negation contradicts",
     {"refill_status": "ready"},
     "USER: I'm sorry, your refill isn't ready yet.", "contradicted"),
    ("cannot-confirm is not evidence",
     {"refill_status": "ready"},
     "USER: We cannot confirm the refill is ready.", None),
    ("question is not evidence",
     {"refill_status": "ready"},
     "USER: Is your prescription refill ready?", None),
    ("hedge is not evidence",
     {"refill_status": "ready"},
     "USER: I think the refill is ready.", None),
    ("self-correction contradicts",
     {"refill_status": "ready"},
     "USER: It's ready. Wait, correction, it's not ready.", "contradicted"),
    ("terminal denial beats an earlier same-value mention",
     {"refill_status": "ready"},
     "USER: The refill status was ready, but it is not ready now.", "contradicted"),
    ("boolean false after a value contradicts",
     {"refill_status": "ready"},
     "USER: The refill status ready flag is false.", "contradicted"),
    ("token boundary: inactive does not verify active",
     {"line_status": "active"},
     "USER: The production line is inactive.", None),
    ("token boundary: 185 does not verify 85",
     {"claim_count": 85},
     "USER: 185 passengers are booked on the flight.", None),
    ("sign matters: plus 5 does not verify -5",
     {"delay_minutes": -5},
     "USER: The delay is plus 5 minutes.", None),
    ("digit boundary: 912345 does not verify 1234",
     {"claim_code": 1234},
     "USER: Your shipment code 912345 is confirmed.", None),
    ("unit mismatch: fahrenheit does not verify celsius",
     {"tomorrow_high_c": 85},
     "USER: Tomorrow's high will be 85°F.", None),
    ("unit mismatch: cents do not verify usd",
     {"balance_usd": 85},
     "USER: Your account balance is 85 cents.", None),
    ("currency field requires explicit currency evidence",
     {"balance_usd": 85},
     "USER: Your account balance is 85.", None),
    ("leading-zero code needs the exact digits",
     {"confirmation": "0085"},
     "USER: Your confirmation is in the mid 80s.", None),
    ("identifier must be a complete token",
     {"claim_reference": "AB12CD3"},
     "USER: We found tag XAB12CD34 in the system.", None),
    ("object noun alone does not anchor a strict field",
     {"claim_balance_usd": 85, "claim_reference": "AB12CD3"},
     "USER: Your claim number is 85.", None),
    ("daypart must appear positively",
     {"tomorrow_high_f": 85},
     "USER: The high is 85.", None),
    ("negated date contradicts",
     {"appointment_date": "2026-09-12"},
     "USER: Your appointment is not September 12.", "contradicted"),
    ("wrong year contradicts",
     {"appointment_date": "2026-09-12"},
     "USER: Your appointment is September 12, 2025.", "contradicted"),
    ("ok as string blocks everything",
     {"refill_status": "ready"},
     "USER: Your prescription refill is ready.", None),
    ("ok as zero blocks everything",
     {"refill_status": "ready"},
     "USER: Your prescription refill is ready.", None),
    ("missing ok blocks everything",
     {"refill_status": "ready"},
     "USER: Your prescription refill is ready.", None),
    ("top-level in-progress blocks nested completed",
     {"refill_status": "ready"},
     "USER: Your prescription refill is ready.", None),
    ("metadata completion is not authoritative",
     {"refill_status": "ready"},
     "USER: Your prescription refill is ready.", None),
    ("hedged number is not verified",
     {"balance_usd": 85},
     "USER: Your balance is probably 85 dollars.", None),
    ("later denial contradicts earlier support",
     {"refill_status": "ready"},
     "USER: The refill is ready. Actually, it is not ready.", "contradicted"),
    ("system turn with daypart number is not evidence",
     {"tomorrow_high_f": 85},
     "SYSTEM: The high for tomorrow is 85.", None),
]

PROVIDER_GATE_CASES = {
    "ok as string blocks everything": {"ok": "false"},
    "ok as zero blocks everything": {"ok": 0},
    "missing ok blocks everything": {"ok": "__drop__"},
    "top-level in-progress blocks nested completed": {"ok": True, "outer_in_progress": True},
    "metadata completion is not authoritative": {"ok": True, "metadata_only": True},
}

POSITIVES = [
    ("plain anchored string verifies",
     {"refill_status": "ready"},
     "USER: Your prescription refill is ready."),
    ("anchored number with daypart verifies",
     {"tomorrow_high_f": 85},
     "USER: The forecast for tomorrow: the high will be 85."),
    ("identifier token verifies",
     {"claim_reference": "AB12CD3"},
     "USER: Your claim reference is AB12CD3."),
    ("full spoken date with year verifies",
     {"appointment_date": "2026-09-12"},
     "USER: Your appointment is September 12, 2026."),
]


class VerifierRedTeamTests(unittest.TestCase):
    def assert_not_verified(self, payload: dict, name: str) -> dict:
        report = run_verify(payload)
        for field_name, field in report["fields"].items():
            self.assertNotEqual(
                field["verdict"], "verified",
                f"{name}: field {field_name} must not verify; got evidence: {field.get('evidence')}",
            )
        self.assertNotEqual(
            report["overall"], "verified",
            f"{name}: overall must not be verified",
        )
        return report

    def test_negative_cases_stay_unverified(self):
        self.assertGreaterEqual(len(NEGATIVES), 28, "the frozen set must keep at least 28 cases")
        for name, fields, transcript, exact in NEGATIVES:
            with self.subTest(case=name):
                payload = case(fields, transcript)
                gate = PROVIDER_GATE_CASES.get(name)
                if gate:
                    for key, value in gate.items():
                        if value == "__drop__":
                            payload.pop("ok", None)
                            payload["structuredContent"].pop("ok", None)
                        elif key == "outer_in_progress":
                            payload["status"] = "IN_PROGRESS"
                        elif key == "metadata_only":
                            payload.pop("status", None)
                            payload["structuredContent"].pop("status", None)
                            payload["metadata"] = {"status": "COMPLETED"}
                        else:
                            payload[key] = value
                report = self.assert_not_verified(payload, name)
                if exact:
                    for field in report["fields"].values():
                        self.assertEqual(field["verdict"], exact,
                                         f"{name}: expected {exact}, got {field['verdict']}")
                if gate:
                    self.assertEqual(report["overall"], "unverified",
                                     f"{name}: provider gate must cap overall at unverified")

    def test_positive_cases_still_verify(self):
        for name, fields, transcript in POSITIVES:
            with self.subTest(case=name):
                report = run_verify(case(fields, transcript))
                for field_name, field in report["fields"].items():
                    self.assertEqual(field["verdict"], "verified",
                                     f"{name}: field {field_name} should verify: {field.get('evidence')}")
                self.assertEqual(report["overall"], "verified", name)


if __name__ == "__main__":
    unittest.main()
