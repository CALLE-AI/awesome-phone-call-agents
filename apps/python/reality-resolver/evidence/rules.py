"""The four generic evidence rules (R1-R4).

Each rule returns a RuleResult(rule_name, triggered: bool, reason: str)
- the same "boolean + explanation" shape as compliance/models.py's
CheckResult, extended to this engine. Decision-critical uncertainty is
all(...) of these four - see evidence/engine.py.

None of this is real natural-language understanding. R2 and R3 compare
claims using a small, explicit, literal polarity lexicon - flagged as a
heuristic exactly as honestly as compliance/jurisdictions/eu_common.py
flags its own literal "artificial intelligence" substring check. A
claim containing none of the lexicon's markers is unclassifiable and
never triggers R2/R3 on its own - that failure mode is deliberate: it
fails toward not escalating to a call, the safe direction given the
absolute rule that unresolved evidence is never treated as cancelled.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from .model import Ambiguity, Evidence, EvidenceMatrix, EvidenceType


@dataclass(frozen=True)
class RuleResult:
    rule_name: str
    triggered: bool
    reason: str


# Deliberately small and literal - not semantic contradiction detection.
# "Same state/subject" is established structurally instead (every
# Evidence in one EvidenceMatrix is, by the Case's own construction,
# evidence about the single state that case is resolving); these
# lexicons only classify each claim's polarity so R2/R3 can compare
# claim to claim rather than reading the ambiguity field in isolation.
_CONFIRMING_MARKERS = (
    "confirmed",
    "confirm",
    "confirming",
    "attending",
    "will be there",
    "as planned",
    "on track",
    "still coming",
)
#
# Deliberately kept specific to *not following through on a commitment*
# rather than generic hedge words ("not sure", "doubt") - those are too
# topic-agnostic and would false-positive on a human claim that is
# uncertain about something unrelated. This narrows, but does not
# eliminate, the false-positive risk: a claim that happens to mention
# e.g. "cancel" about something else entirely (a case author including
# genuinely irrelevant evidence in a Case) would still be misread. That
# residual risk is accepted, not solved - real subject-matching would
# need real language understanding, which this rule does not have.
_DIVERGING_MARKERS = (
    "cancel",
    "cancelled",
    "cancelling",
    "may need to",
    "might not",
    "won't",
    "can't make it",
    "cannot make it",
    "no longer",
    "postpone",
    "reschedule",
    "unable to",
)


def _polarity(claim: str) -> str | None:
    text = claim.lower()
    if any(marker in text for marker in _DIVERGING_MARKERS):
        return "diverging"
    if any(marker in text for marker in _CONFIRMING_MARKERS):
        return "confirming"
    return None


def _qualifying_human_evidence(matrix: EvidenceMatrix) -> tuple[Evidence, ...]:
    """Human-source evidence whose claim polarity is classified and
    differs from the structured claim's polarity - the shared basis for
    R2 and R3. A structured claim with no recognized marker (unusual for
    a system-of-record entry) defaults to "confirming" the state it
    records.
    """
    structured = matrix.of_type(EvidenceType.STRUCTURED)
    structured_polarity = (_polarity(structured[0].claim) if structured else None) or "confirming"
    return tuple(
        item
        for item in matrix.of_type(EvidenceType.HUMAN)
        if _polarity(item.claim) not in (None, structured_polarity)
    )


def r1_structured_state(matrix: EvidenceMatrix) -> RuleResult:
    structured = matrix.of_type(EvidenceType.STRUCTURED)
    if not structured:
        return RuleResult("R1_structured_state", False, "no structured-source evidence asserts a state")
    lead = structured[0]
    return RuleResult("R1_structured_state", True, f"{lead.source} asserts: {lead.claim!r}")


def r2_human_qualification(matrix: EvidenceMatrix) -> RuleResult:
    structured = matrix.of_type(EvidenceType.STRUCTURED)
    if not structured:
        return RuleResult("R2_human_qualification", False, "no structured-source claim to compare against")
    qualifying = _qualifying_human_evidence(matrix)
    if qualifying:
        item = qualifying[0]
        return RuleResult(
            "R2_human_qualification",
            True,
            f"{item.source} ({_polarity(item.claim)}) diverges from {structured[0].source}'s claim: "
            f"{item.claim!r}",
        )
    return RuleResult(
        "R2_human_qualification", False, "no human-source claim diverges in polarity from the structured claim"
    )


def r3_unresolved_evidence(matrix: EvidenceMatrix) -> RuleResult:
    qualifying = _qualifying_human_evidence(matrix)
    if not qualifying:
        return RuleResult("R3_unresolved_evidence", False, "no qualifying evidence to resolve")
    reference_freshness = min(item.freshness for item in qualifying)
    resolving = tuple(
        item for item in matrix.items if item.freshness < reference_freshness and item.ambiguity == Ambiguity.LOW
    )
    if resolving:
        return RuleResult(
            "R3_unresolved_evidence", False, f"resolved by fresher low-ambiguity evidence: {resolving[0].source}"
        )
    return RuleResult("R3_unresolved_evidence", True, "no fresher evidence has resolved the contradiction")


def r4_decision_deadline(deadline: datetime, now: datetime, threshold: timedelta) -> RuleResult:
    remaining = deadline - now
    if remaining <= threshold:
        return RuleResult("R4_decision_deadline", True, f"deadline in {remaining} (<= {threshold})")
    return RuleResult("R4_decision_deadline", False, f"deadline in {remaining} (> {threshold}), not yet urgent")
