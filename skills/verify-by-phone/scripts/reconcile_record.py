#!/usr/bin/env python3
"""Reconcile extracted call answers against the stored record.

Standard library only. Fellegi-Sunter style: each field where the call agrees
with the record adds log2(m/u) bits of evidence, each disagreement subtracts,
on a stated 50/50 prior. Unknown answers contribute nothing: no evidence is
no evidence. Prints per-field arithmetic and a verdict, so the operator can
see exactly why a listing was believed or doubted.
"""

from __future__ import annotations

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
    parser.add_argument(
        "--org",
        required=True,
        help=(
            "Organization name as listed, the same value passed to "
            "place_verify_call.py. Required and passed through to extraction, "
            "which fails closed without a positive identity confirmation."
        ),
    )
    parser.add_argument("--claim-accepting-new-patients", choices=["yes", "no"], default=None)
    parser.add_argument("--claim-plan-accepted", choices=["yes", "no"], default=None)
    parser.add_argument(
        "--qhat",
        type=float,
        required=True,
        help=(
            "Calibrated threshold from calibrate.py. Required: without it "
            "extraction abstains on every claim and this script can only ever "
            "print UNVERIFIABLE."
        ),
    )
    args = parser.parse_args()

    # --qhat is required rather than optional-with-a-default. Omitting it used
    # to be silently catastrophic: extract_answer.py fails closed without a
    # threshold, so every field arrived as "unknown", every field was labelled
    # "no evidence", and the run printed a 50% posterior and UNVERIFIABLE. That
    # reads exactly like a real reconciliation that found nothing, while in
    # fact the evidence was thrown away unexamined. On the bundled fixture the
    # call plainly says "Yes. We're accepting new patients." with a transcript
    # span behind it, and the old default reported "no evidence" for it. A tool
    # that cannot do its job without an argument must demand the argument, not
    # invent a confident-looking null result.
    extractor = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("extract_answer.py")),
            "--payload",
            args.payload,
            "--qhat",
            str(args.qhat),
            # Without --org, extraction cannot confirm identity and abstains on
            # every claim, which would silently recreate the earlier bug where
            # this script could only ever print UNVERIFIABLE.
            "--org",
            args.org,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if extractor.returncode != 0:
        raise SystemExit(f"extract_answer failed: {extractor.stderr.strip()}")
    answers = {}
    identity_denied = False
    identity_confirmed = False
    for line in extractor.stdout.strip().splitlines():
        item = json.loads(line)
        identity_denied = identity_denied or bool(item.get("organization_denied"))
        identity_confirmed = identity_confirmed or bool(item.get("organization_confirmed"))
        answers[item["claim"]] = item["answer"] if not item["abstain"] else "unknown"

    if identity_denied or not identity_confirmed:
        # Stop before the arithmetic. Reaching a different party, or never
        # establishing which party answered, is not weak evidence to be weighed
        # down. It is no evidence about this listing at all, and running the
        # match weights anyway would put a number on it.
        if identity_denied:
            print("identity: the respondent indicated this is not the listed organization")
        else:
            print(f"identity: never confirmed that the respondent represents {args.org}")
            print("absence of a denial is not confirmation, so no answer is attributable")
        print("no reconciliation performed: answers from another party are not evidence")
        print("verdict: UNVERIFIABLE")
        return

    claims = {
        "accepting_new_patients": args.claim_accepting_new_patients,
        "accepts_plan": args.claim_plan_accepted,
    }
    log_odds = PRIOR_LOG_ODDS
    evidence = 0
    print(f"prior: {PRIOR_LOG_ODDS:+.2f} bits (50/50 audit odds)")
    for field, (m, u) in FIELD_PARAMS.items():
        answer, claim = answers.get(field, "unknown"), claims.get(field)
        # Say which of the two reasons applies. "No evidence" covering both a
        # claim the operator never supplied and a call that established nothing
        # is how the uncalibrated bug stayed invisible.
        if claim is None:
            print(f"{field}: not checked, no claim supplied to verify against")
            continue
        if answer == "unknown":
            print(f"{field}: no evidence, the call did not establish this (record says {claim})")
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
