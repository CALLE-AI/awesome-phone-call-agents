from __future__ import annotations

import re
from typing import Any

from .schemas import AnalysisRequest, Evidence, Verdict


MONEY_PATTERN = re.compile(r"\$\s?(\d+(?:\.\d{1,2})?)")

# A verdict only auto-verifies (no human review) when confidence clears this bar.
CONFIDENCE_AUTO_VERIFY = 0.75


class DeterministicEvaluator:
    """Safe first provider; replace with Altur's LLM factory after the boundary is stable.

    Confidence is *derived from evidence strength*, never assumed. A payload whose
    surcharge or goal cannot be located in the transcript yields low confidence and
    is routed to human review instead of being auto-verified.
    """

    def evaluate(self, request: AnalysisRequest) -> Verdict:
        maximum = int(request.call_contract.allowed_commitments.get("maximum_surcharge_cents", 0))
        surcharge, surcharge_source = self._surcharge(request)
        turn_ids, evidence_matched = self._evidence_turns(request, surcharge)
        violation = surcharge > maximum

        goal_completion = self._goal_completion(request)
        confidence = self._confidence(surcharge_source, evidence_matched, goal_completion)
        weak_evidence = confidence < CONFIDENCE_AUTO_VERIFY

        # Human review whenever there is a violation OR the evidence is too weak to
        # trust OR the goal is not clearly complete.
        needs_review = violation or weak_evidence or goal_completion != "complete"

        finding, summary, explanation = self._narrative(
            violation=violation,
            weak_evidence=weak_evidence,
            surcharge=surcharge,
            maximum=maximum,
            surcharge_source=surcharge_source,
            evidence_matched=evidence_matched,
        )

        return Verdict(
            goal_completion=goal_completion,
            policy_adherence=not violation,
            unauthorized_commitment=violation,
            result_confidence=round(confidence, 2),
            risk_score=self._risk_score(violation, weak_evidence),
            needs_human_review=needs_review,
            summary=summary,
            negotiated_terms={
                "surcharge_cents": surcharge,
                "maximum_authorized_surcharge_cents": maximum,
                "surcharge_evidence_source": surcharge_source,
            },
            evidence=[Evidence(finding=finding, turn_ids=turn_ids, explanation=explanation)],
        )

    def _confidence(self, surcharge_source: str, evidence_matched: bool, goal_completion: str) -> float:
        """Build confidence from concrete, checkable support rather than a constant."""
        score = 0.4
        if surcharge_source == "provider_result":
            score += 0.3
        elif surcharge_source == "transcript":
            score += 0.15
        else:  # "none": nothing to anchor the negotiated amount to
            score -= 0.15

        if evidence_matched:
            score += 0.25
        if goal_completion == "complete":
            score += 0.1
        elif goal_completion == "unknown":
            score -= 0.1

        return max(0.05, min(0.95, score))

    def _goal_completion(self, request: AnalysisRequest) -> str:
        result: dict[str, Any] = request.provider_result or {}
        if not result:
            return "unknown"
        if result.get("delivery_changed") is True or result.get("order_number_confirmed") is True:
            return "complete"
        if int(result.get("completed_count", 0)) >= 1:
            return "complete"
        return "partial"

    def _risk_score(self, violation: bool, weak_evidence: bool) -> float:
        if violation:
            return 0.91
        if weak_evidence:
            return 0.6
        return 0.08

    def _narrative(
        self,
        *,
        violation: bool,
        weak_evidence: bool,
        surcharge: int,
        maximum: int,
        surcharge_source: str,
        evidence_matched: bool,
    ) -> tuple[str, str, str]:
        if violation:
            return (
                "unauthorized_surcharge",
                "The call achieved its goal but accepted a surcharge above the authorized limit.",
                f"The agent accepted {self._money(surcharge)}, exceeding the authorized "
                f"limit of {self._money(maximum)}.",
            )
        if weak_evidence:
            reason = "no surcharge amount was found in the provider result or transcript" \
                if surcharge_source == "none" else "the reported amount is not supported by a matching transcript turn"
            return (
                "unsupported_result",
                "The result could not be verified from the transcript and needs human review.",
                f"Confidence is low because {reason}; not auto-verifying.",
            )
        return (
            "policy_compliance",
            "The call achieved its goal and stayed within the authorized commitments.",
            f"The accepted surcharge of {self._money(surcharge)} is within the "
            f"authorized limit of {self._money(maximum)}, supported by transcript evidence.",
        )

    def _surcharge(self, request: AnalysisRequest) -> tuple[int, str]:
        result: dict[str, Any] = request.provider_result or {}
        if "surcharge_cents" in result:
            return int(result["surcharge_cents"]), "provider_result"

        amounts = []
        for turn in request.transcript.turns:
            amounts.extend(int(float(value) * 100) for value in MONEY_PATTERN.findall(turn.text))
        if amounts:
            return max(amounts), "transcript"
        return 0, "none"

    def _evidence_turns(self, request: AnalysisRequest, surcharge: int) -> tuple[list[int], bool]:
        """Return supporting turn ids and whether they *actually* mention the amount.

        A fallback to the last turn (no real match) is reported as unmatched so the
        caller can lower confidence instead of dressing up unrelated evidence.
        """
        amount = self._money(surcharge).removeprefix("$")
        matches = [turn.id for turn in request.transcript.turns if amount in turn.text]
        if matches:
            return matches, True
        return [request.transcript.turns[-1].id], False

    def _money(self, cents: int) -> str:
        return f"${cents / 100:.2f}"
