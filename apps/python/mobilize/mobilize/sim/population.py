"""Synthetic donor population with a calibrated stated-vs-actual commitment gap.

The whole point of the evaluation harness is that ground truth is known here
and nowhere else. Each synthetic donor has a hidden `true_showup_prob` that
the system never sees directly -- it only sees noisy signals (pickup,
stated answer, hedging language) exactly like the real CALL-E transport
would produce.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from mobilize.core.types import Candidate

FIRM_PHRASES = [
    "I'm leaving right now, be there in {eta} minutes.",
    "Yes, on my way, {eta} minutes out.",
    "Absolutely, I can be there in {eta} minutes, grabbing my keys now.",
]
SOFT_PHRASES = [
    "Yeah, I'll try to make it, maybe in {eta} minutes or so.",
    "I think I can come, I'll see what I can do, around {eta} minutes.",
    "Probably, I'll head over if I can, give me {eta} minutes.",
]
DECLINE_PHRASES = [
    "Sorry, I can't make it right now.",
    "No, I'm not able to come today.",
    "I'm not eligible, I donated recently.",
]


@dataclass(frozen=True)
class SyntheticDonor:
    candidate: Candidate
    pickup_prob: float
    true_accept_prob: float  # probability of saying yes at all, given pickup
    true_showup_prob: float  # HIDDEN ground truth: prob of actually showing up given yes
    acquiescence: float  # 0..1: tendency to say yes to be agreeable, inflates stated yes
    hedges_when_uncertain: bool  # whether their language reflects true uncertainty


def generate_population(
    n: int,
    *,
    seed: int,
    mean_pickup: float = 0.6,
    mean_accept: float = 0.45,
    mean_showup_given_yes: float = 0.65,
    mean_acquiescence: float = 0.25,
) -> list[SyntheticDonor]:
    rng = random.Random(seed)
    donors: list[SyntheticDonor] = []
    for i in range(n):
        pickup = _clamp(rng.gauss(mean_pickup, 0.15))
        accept = _clamp(rng.gauss(mean_accept, 0.15))
        showup = _clamp(rng.gauss(mean_showup_given_yes, 0.18))
        acquiescence = _clamp(rng.gauss(mean_acquiescence, 0.15))
        days_since = rng.uniform(1, 200)
        distance = rng.uniform(0.5, 25)
        candidate = Candidate(
            id=f"donor_{i:04d}",
            phone=f"+1555000{i:04d}",
            name=f"Donor {i}",
            days_since_last_action=days_since,
            distance_km=distance,
            historical_accept_rate=_clamp(accept + rng.gauss(0, 0.05)),
            historical_showup_rate=_clamp(showup + rng.gauss(0, 0.05)),
            eligible=days_since >= 56,  # ~8 week donation eligibility window
        )
        donors.append(
            SyntheticDonor(
                candidate=candidate,
                pickup_prob=pickup,
                true_accept_prob=accept,
                true_showup_prob=showup,
                acquiescence=acquiescence,
                hedges_when_uncertain=rng.random() > acquiescence,
            )
        )
    return donors


def simulate_call(donor: SyntheticDonor, rng: random.Random) -> dict:
    """Produce a synthetic call outcome shaped exactly like a real CALL-E result.

    Returns a dict with can_come/eta_minutes/evidence_summary matching
    MOBILIZE_RESULT_SCHEMA, plus internal fields used only for evaluation.
    """
    if not donor.candidate.eligible:
        return _outcome("no", "unknown", "They said they donated too recently to be eligible.", true_showup=False, picked_up=True)

    if rng.random() > donor.pickup_prob:
        return _outcome("unknown", "unknown", "No answer.", true_showup=False, picked_up=False)

    # Acquiescence inflates the probability of a stated yes above the true accept prob.
    stated_yes_prob = donor.true_accept_prob + donor.acquiescence * (1 - donor.true_accept_prob) * 0.5
    said_yes = rng.random() < stated_yes_prob

    if not said_yes:
        return _outcome("no", "unknown", rng.choice(DECLINE_PHRASES), true_showup=False, picked_up=True)

    # Whether they actually show up is governed by the HIDDEN true_showup_prob,
    # independent of how firmly they phrased it -- that's the whole point:
    # firm language correlates with but does not guarantee follow-through.
    will_show = rng.random() < donor.true_showup_prob
    eta = rng.randint(5, 30)

    # Firm phrasing is more likely (not certain) when the donor is genuinely committed.
    speaks_firm = (will_show and rng.random() < 0.75) or (not will_show and rng.random() < 0.25)
    phrase = rng.choice(FIRM_PHRASES if speaks_firm else SOFT_PHRASES).format(eta=eta)

    return _outcome("yes", str(eta), phrase, true_showup=will_show, picked_up=True)


def _outcome(can_come: str, eta: str, evidence: str, *, true_showup: bool, picked_up: bool) -> dict:
    return {
        "can_come": can_come,
        "eta_minutes": eta,
        "evidence_summary": evidence,
        "_true_showup": true_showup,  # ground truth, stripped before it reaches the scorer
        "_picked_up": picked_up,
    }


def _clamp(x: float, lo: float = 0.02, hi: float = 0.98) -> float:
    return max(lo, min(hi, x))
