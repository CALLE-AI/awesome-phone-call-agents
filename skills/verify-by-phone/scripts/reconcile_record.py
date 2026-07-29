#!/usr/bin/env python3
"""Reconcile extracted call answers against the stored record.

Standard library only. Fellegi-Sunter style: each field where the call agrees
with the record adds log2(m/u) bits of evidence, each disagreement subtracts,
on a stated 50/50 prior. Unknown answers contribute nothing: no evidence is
no evidence. Prints per-field arithmetic and a verdict, so the operator can
see exactly why a listing was believed or doubted.
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

# (m, u) = P(agree | record accurate), P(agree | record inaccurate). Fixed,
# documented, conservative. See references/verification-protocol.md.
FIELD_PARAMS = {
    "accepting_new_patients": (0.90, 0.35),
    "accepts_plan": (0.85, 0.25),
}
PRIOR_LOG_ODDS = 0.0
VERIFIED_AT = 0.85
CONTRADICTED_AT = 0.30


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, help="JSON file from poll_result.py")
    parser.add_argument("--claim-accepting-new-patients", choices=["yes", "no"], default=None)
    parser.add_argument("--claim-plan-accepted", choices=["yes", "no"], default=None)
    args = parser.parse_args()

    extractor = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("extract_answer.py")),
            "--payload",
            args.payload,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if extractor.returncode != 0:
        raise SystemExit(f"extract_answer failed: {extractor.stderr.strip()}")
    answers = {}
    for line in extractor.stdout.strip().splitlines():
        item = json.loads(line)
        answers[item["claim"]] = item["answer"] if not item["abstain"] else "unknown"

    claims = {
        "accepting_new_patients": args.claim_accepting_new_patients,
        "accepts_plan": args.claim_plan_accepted,
    }
    log_odds = PRIOR_LOG_ODDS
    evidence = 0
    print(f"prior: {PRIOR_LOG_ODDS:+.2f} bits (50/50 audit odds)")
    for field, (m, u) in FIELD_PARAMS.items():
        answer, claim = answers.get(field, "unknown"), claims.get(field)
        if answer == "unknown" or claim is None:
            print(f"{field}: no evidence ({answer=} {claim=})")
            continue
        agreed = answer == claim
        weight = math.log2(m / u) if agreed else math.log2((1 - m) / (1 - u))
        log_odds += weight
        evidence += 1
        print(f"{field}: call={answer} record={claim} -> {weight:+.2f} bits")

    probability = 1.0 / (1.0 + 2.0 ** (-log_odds))
    if evidence == 0:
        verdict = "unverifiable"
    elif probability >= VERIFIED_AT:
        verdict = "verified"
    elif probability <= CONTRADICTED_AT:
        verdict = "contradicted"
    else:
        verdict = "unverifiable"
    print(f"posterior: {log_odds:+.2f} bits = {probability:.0%} record-accurate")
    print(f"verdict: {verdict.upper()}")


if __name__ == "__main__":
    main()
