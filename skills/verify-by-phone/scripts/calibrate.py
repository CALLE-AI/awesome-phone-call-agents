#!/usr/bin/env python3
"""Calibrate the abstention threshold with split conformal prediction.

Standard library only, no credentials, no calls: runs on labeled scenario
data (see references/sample-scenarios.jsonl). The guarantee and the gate both
live in gate.py, which extract_answer.py also uses, so the threshold printed
here is the threshold that decides real answers. It is printed for exactly
that reason: feed it to `extract_answer.py --qhat`.
"""

from __future__ import annotations

import argparse
import json

from gate import abstains, class_scores, conformal_quantile, nonconformity, prediction_set


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="JSONL: answer, trust_score, truth")
    parser.add_argument("--alpha", type=float, default=0.1)
    args = parser.parse_args()

    rows = []
    with open(args.data, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    half = len(rows) // 2
    calibration, test = rows[:half], rows[half:]
    if not calibration or not test:
        raise SystemExit("ERROR: need at least two labeled rows to calibrate.")

    qhat = conformal_quantile(
        [
            nonconformity(class_scores(row["answer"], row["trust_score"]), row["truth"])
            for row in calibration
        ],
        args.alpha,
    )

    covered = answered = answered_correct = 0
    for row in test:
        scores = class_scores(row["answer"], row["trust_score"])
        if row["truth"] in prediction_set(scores, qhat):
            covered += 1
        # The gate the skill actually applies, not a looser one. A singleton
        # {unknown} is an abstention: counting it as answered would report an
        # abstention rate lower than the one an operator experiences.
        if not abstains(scores, row["answer"], qhat):
            answered += 1
            if row["answer"] == row["truth"]:
                answered_correct += 1

    n = len(test)
    print(f"calibration n={len(calibration)}, held-out test n={n} (disjoint)")
    print(f"alpha={args.alpha}: qhat={qhat:.3f}")
    print(f"empirical coverage: {covered / n:.1%} (target {1 - args.alpha:.0%})")
    print(f"abstention rate: {1 - answered / n:.1%}")
    if answered:
        print(f"accuracy when answering: {answered_correct / answered:.1%}")
    print(f"\nApply it:  extract_answer.py --payload result.json --qhat {qhat:.3f}")


if __name__ == "__main__":
    main()
