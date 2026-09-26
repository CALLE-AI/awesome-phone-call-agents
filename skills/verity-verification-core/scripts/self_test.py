#!/usr/bin/env python3
"""Run every bundled scenario through the gate and assert its expected verdict.

    python scripts/self_test.py

Exercises the three headline cases from `references/examples.md`:
  A  clean confirm            -> ALLOW  allow_clean
  B  mid-sentence correction  -> BLOCK  self_correction / claim_parse_mismatch, ghost prevented
  D  value never confirmed    -> BLOCK  no_explicit_confirmation

Standard library only. Never opens a socket. Exit non-zero on any mismatch.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from verity_gate import call_task_from, verify  # noqa: E402

ASSETS = HERE.parent / "assets"
CASES = ["experience-a", "experience-d", "experience-b"]


def check(name: str) -> list[str]:
    spec = json.loads((ASSETS / f"{name}.input.json").read_text(encoding="utf-8"))
    task = call_task_from(json.loads((ASSETS / f"{name}.call.json").read_text(encoding="utf-8")))
    decision = verify(
        task,
        intent=spec["intent"],
        intended=spec["intended_value"],
        business_tz=spec.get("business_tz", spec["intended_value"]["timezone"]),
    )["decision"]
    exp = spec["expect"]
    errs: list[str] = []

    if decision["decision"] != exp["decision"]:
        errs.append(f"decision: expected {exp['decision']}, got {decision['decision']}")
    if "reason_code" in exp and decision["reason_code"] != exp["reason_code"]:
        errs.append(f"reason_code: expected {exp['reason_code']}, got {decision['reason_code']}")
    if "reason_code_in" in exp and decision["reason_code"] not in exp["reason_code_in"]:
        errs.append(f"reason_code: expected one of {exp['reason_code_in']}, got {decision['reason_code']}")
    if "ghost_booking_prevented" in exp and \
            decision["ghost_booking_prevented"] != exp["ghost_booking_prevented"]:
        errs.append(f"ghost_booking_prevented: expected {exp['ghost_booking_prevented']}, "
                    f"got {decision['ghost_booking_prevented']}")

    status = "ok" if not errs else "FAIL"
    print(f"  [{status}] {spec['label']}")
    print(f"         -> {decision['decision']} / {decision['reason_code']}"
          + ("  ghost_prevented" if decision["ghost_booking_prevented"] else ""))
    for e in errs:
        print(f"         !! {e}")
    return errs


def main() -> int:
    print("verity-verification-core self test (no network)")
    failures = 0
    for name in CASES:
        failures += len(check(name))
    if failures:
        print(f"\n{failures} assertion(s) failed.")
        return 1
    print("\nall scenarios matched their expected verdict.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
