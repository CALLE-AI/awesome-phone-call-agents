"""Regenerates the measured-evaluation numbers quoted in README.md.

Small, fixed fixture corpus (see fixtures/) — not a claim about real-world
scam-catch rates. See the README's "Measured evaluation" section for what
this does and does not claim.

Reports both directions honestly: how many scam-pattern fixtures correctly
recommend ADVISE_BLOCK/ESCALATE_TO_HUMAN (never ADVISE_ALLOW), and how many
clean-legitimate fixtures correctly recommend ADVISE_ALLOW rather than being
over-triggered into a false ADVISE_BLOCK/ESCALATE — a tool that flags
everything is useless, so both sides are reported, not just the scam-catch
side. Every recommendation counted here is advisory and requires human
review (see decide.py); this measures recommendation quality, not decisions
the tool is allowed to make on its own.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import decide as decide_mod
from . import resolve
from . import synthetic_corpus


@dataclass
class EvaluationResult:
    scam_pattern_total: int = 0
    scam_pattern_correct: int = 0
    clean_legitimate_total: int = 0
    clean_legitimate_correct: int = 0
    mismatches: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.scam_pattern_total + self.clean_legitimate_total

    @property
    def scam_catch_rate_pct(self) -> float:
        if not self.scam_pattern_total:
            return 0.0
        return 100.0 * self.scam_pattern_correct / self.scam_pattern_total

    @property
    def clean_allow_rate_pct(self) -> float:
        if not self.clean_legitimate_total:
            return 0.0
        return 100.0 * self.clean_legitimate_correct / self.clean_legitimate_total


def evaluate_fixture_corpus(fixtures_dir: Path) -> EvaluationResult:
    result = EvaluationResult()
    for path in sorted(fixtures_dir.glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        category = record["category"]
        resolution = resolve.classify(
            record["call"], record.get("attempts", []), record.get("events", [])
        )
        disposition = decide_mod.decide(resolution, record.get("signals", {}))

        if category == "scam_pattern":
            result.scam_pattern_total += 1
            if disposition.disposition in (decide_mod.ADVISE_BLOCK, decide_mod.ESCALATE_TO_HUMAN):
                result.scam_pattern_correct += 1
            else:
                result.mismatches.append(path.stem)
        elif category == "clean_legitimate":
            result.clean_legitimate_total += 1
            if disposition.disposition == decide_mod.ADVISE_ALLOW:
                result.clean_legitimate_correct += 1
            else:
                result.mismatches.append(path.stem)
    return result


@dataclass
class SyntheticEvaluationResult:
    """decide() vs the synthetic corpus's independently computed oracle."""

    total: int = 0
    correct: int = 0
    mismatches: list[str] = field(default_factory=list)
    by_disposition: dict[str, int] = field(default_factory=dict)

    @property
    def accuracy_pct(self) -> float:
        if not self.total:
            return 0.0
        return 100.0 * self.correct / self.total


def evaluate_synthetic_corpus(records: list[dict] | None = None) -> SyntheticEvaluationResult:
    records = synthetic_corpus.generate_corpus() if records is None else records
    result = SyntheticEvaluationResult()
    for record in records:
        resolution = resolve.classify(
            record["call"], record.get("attempts", []), record.get("events", [])
        )
        disposition = decide_mod.decide(resolution, record.get("signals", {}))
        result.total += 1
        result.by_disposition[disposition.disposition] = (
            result.by_disposition.get(disposition.disposition, 0) + 1
        )
        if disposition.disposition == record["expected_disposition"]:
            result.correct += 1
        else:
            result.mismatches.append(
                f"{record['case']['case_id']}: expected {record['expected_disposition']}, "
                f"got {disposition.disposition} ({disposition.reasons})"
            )
    return result


@dataclass
class NaiveComparisonResult:
    """Naive (trust raw status/failure_code) vs resolve.classify().

    The "measured, not asserted" comparison CALL-E's own errors.mdx
    motivates: most integrations branch directly on status/failure_code,
    which CALL-E's docs say offers no guaranteed no-answer/decline enum.
    This measures how often that naive approach would produce a *less
    protective* recommendation than resolve.classify()'s cross-referenced
    outcome, on the same signals.
    """

    total: int = 0
    outcome_disagreements: int = 0
    unsafe_disposition_disagreements: int = 0
    examples: list[str] = field(default_factory=list)


_DISPOSITION_SAFETY_RANK = {
    decide_mod.ADVISE_ALLOW: 0,
    decide_mod.ESCALATE_TO_HUMAN: 1,
    decide_mod.ADVISE_BLOCK: 2,
}


def evaluate_naive_vs_resolve(records: list[dict] | None = None) -> NaiveComparisonResult:
    records = synthetic_corpus.generate_corpus() if records is None else records
    result = NaiveComparisonResult()
    for record in records:
        call = record["call"]
        signals = record.get("signals", {})
        real_resolution = resolve.classify(call, record.get("attempts", []), record.get("events", []))
        naive_outcome = resolve.naive_classify(call)
        result.total += 1
        if naive_outcome == real_resolution.outcome:
            continue
        result.outcome_disagreements += 1
        naive_disposition = decide_mod.decide(
            resolve.Resolution(outcome=naive_outcome, confidence="n/a"), signals
        ).disposition
        real_disposition = decide_mod.decide(real_resolution, signals).disposition
        if _DISPOSITION_SAFETY_RANK[naive_disposition] < _DISPOSITION_SAFETY_RANK[real_disposition]:
            result.unsafe_disposition_disagreements += 1
            if len(result.examples) < 5:
                result.examples.append(
                    f"{record['case']['case_id']}: naive={naive_outcome}->{naive_disposition}, "
                    f"resolve={real_resolution.outcome}->{real_disposition}"
                )
    return result


def _print_report() -> None:  # pragma: no cover - exercised via `python -m ringfence.evaluation`
    fixtures_dir = Path(__file__).resolve().parent.parent / "fixtures"
    hand = evaluate_fixture_corpus(fixtures_dir)
    synth_records = synthetic_corpus.generate_corpus()
    synth = evaluate_synthetic_corpus(synth_records)
    naive = evaluate_naive_vs_resolve(synth_records)

    print("RingFence measured evaluation")
    print("=" * 40)
    print(f"\nCurated fixtures ({fixtures_dir}):")
    print(f"  scam-pattern:      {hand.scam_pattern_correct}/{hand.scam_pattern_total} correctly ADVISE_BLOCK/ESCALATE_TO_HUMAN")
    print(f"  clean-legitimate:  {hand.clean_legitimate_correct}/{hand.clean_legitimate_total} correctly ADVISE_ALLOW")

    print(f"\nSynthetic exhaustive corpus ({synth.total} cases, generated not committed):")
    print(f"  decide() vs independent oracle: {synth.correct}/{synth.total} ({synth.accuracy_pct:.1f}%)")
    for disposition, count in sorted(synth.by_disposition.items()):
        print(f"    {disposition:<20} {count}")
    if synth.mismatches:
        print("  MISMATCHES:")
        for mismatch in synth.mismatches:
            print(f"    {mismatch}")

    print("\nNaive (trust status/failure_code) vs resolve.classify():")
    print(f"  outcome disagreements:  {naive.outcome_disagreements}/{naive.total}")
    print(f"  unsafe disagreements:   {naive.unsafe_disposition_disagreements} (naive less protective than resolve)")
    for example in naive.examples:
        print(f"    {example}")

    print(f"\nTotal corpus evaluated: {hand.total + synth.total} cases")


if __name__ == "__main__":  # pragma: no cover
    _print_report()
