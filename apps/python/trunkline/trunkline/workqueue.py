"""Deciding which claims to call about, and how many to put on one call.

Bundling is the largest cost lever in the product. A representative will discuss
several claims in one conversation, and the expensive part of a payer call is
reaching the representative, not talking to them. Three claims on one call pays
the hold cost once instead of three times.

Priority is deliberately simple and explainable, because a biller has to be able
to disagree with it: claim value multiplied by how close the claim is to its
timely-filing deadline. A claim past its deadline scores zero and is suppressed,
because a phone call can no longer change the outcome.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional, Sequence, Tuple

from . import policy
from .models import QUEUED, Claim, Ledger, Payer

# Days remaining before the timely-filing deadline, and the multiplier applied.
URGENCY_BANDS: Tuple[Tuple[int, float], ...] = (
    (14, 3.0),
    (30, 2.0),
    (60, 1.5),
)
DEFAULT_URGENCY = 1.0

# A claim inside this window preempts higher-value work: missing the deadline
# writes the claim off permanently, and no later call can undo that.
DEADLINE_GUARDRAIL_DAYS = 14


def urgency_multiplier(days_left: int) -> float:
    if days_left <= 0:
        return 0.0
    for threshold, multiplier in URGENCY_BANDS:
        if days_left <= threshold:
            return multiplier
    return DEFAULT_URGENCY


def score_claim(claim: Claim, today: Optional[date] = None) -> float:
    days_left = policy.days_until(claim.filing_deadline, today)
    return round(max(0.0, claim.billed_amount) * urgency_multiplier(days_left), 2)


def is_urgent(claim: Claim, today: Optional[date] = None) -> bool:
    days_left = policy.days_until(claim.filing_deadline, today)
    return 0 < days_left <= DEADLINE_GUARDRAIL_DAYS


@dataclass
class Bundle:
    payer_id: str
    workflow: str
    claims: List[Claim] = field(default_factory=list)

    @property
    def claim_ids(self) -> List[str]:
        return [claim.id for claim in self.claims]

    @property
    def total_value(self) -> float:
        return round(sum(claim.billed_amount for claim in self.claims), 2)

    @property
    def priority(self) -> float:
        return round(max((claim.priority_score for claim in self.claims), default=0.0), 2)

    @property
    def urgent(self) -> bool:
        return any(claim.priority_score > 0 and is_urgent(claim) for claim in self.claims)


def rescore(ledger: Ledger, today: Optional[date] = None) -> None:
    for claim in ledger.claims:
        claim.priority_score = score_claim(claim, today)


def callable_claims(
    ledger: Ledger,
    *,
    workflow: Optional[str] = None,
    payer_id: Optional[str] = None,
    today: Optional[date] = None,
) -> List[Claim]:
    """Queued claims that a call could still help, highest priority first."""
    out: List[Claim] = []
    for claim in ledger.claims:
        if claim.state != QUEUED:
            continue
        if workflow and claim.workflow != workflow:
            continue
        if payer_id and claim.payer_id != payer_id:
            continue
        if policy.days_until(claim.filing_deadline, today) <= 0:
            continue
        out.append(claim)
    out.sort(key=lambda c: (-score_claim(c, today), c.filing_deadline, c.id))
    return out


def build_bundles(
    ledger: Ledger,
    *,
    workflow: Optional[str] = None,
    payer_id: Optional[str] = None,
    today: Optional[date] = None,
    max_bundles: Optional[int] = None,
) -> List[Bundle]:
    """Group callable claims into one bundle per call, respecting each payer's cap."""
    grouped: Dict[Tuple[str, str], List[Claim]] = {}
    for claim in callable_claims(ledger, workflow=workflow, payer_id=payer_id, today=today):
        grouped.setdefault((claim.payer_id, claim.workflow), []).append(claim)

    bundles: List[Bundle] = []
    for (pid, flow), claims in grouped.items():
        cap = max(1, ledger.payer(pid).claims_per_call_cap)
        for start in range(0, len(claims), cap):
            bundles.append(Bundle(payer_id=pid, workflow=flow, claims=claims[start:start + cap]))

    # Deadline guardrail: a bundle carrying a claim about to age out goes first,
    # whatever it is worth.
    bundles.sort(key=lambda b: (0 if b.urgent else 1, -b.priority, b.payer_id, b.workflow))
    if max_bundles is not None:
        bundles = bundles[:max_bundles]
    return bundles


def bundling_saving(bundles: Sequence[Bundle]) -> Dict[str, float]:
    """How many calls bundling avoided, against one call per claim."""
    claims = sum(len(bundle.claims) for bundle in bundles)
    calls = len(bundles)
    return {
        "claims": float(claims),
        "calls": float(calls),
        "calls_avoided": float(max(0, claims - calls)),
        "reduction": round(1.0 - (calls / claims), 4) if claims else 0.0,
    }


def explain(bundle: Bundle, payer: Payer, today: Optional[date] = None) -> List[str]:
    lines = [
        "%s - %s, %d claim(s), $%.2f billed"
        % (payer.name, bundle.workflow, len(bundle.claims), bundle.total_value)
    ]
    for claim in bundle.claims:
        days_left = policy.days_until(claim.filing_deadline, today)
        lines.append(
            "  %s  $%8.2f  %3d days to deadline  priority %.2f%s"
            % (
                claim.claim_number,
                claim.billed_amount,
                days_left,
                score_claim(claim, today),
                "  [deadline guardrail]" if is_urgent(claim, today) else "",
            )
        )
    return lines
