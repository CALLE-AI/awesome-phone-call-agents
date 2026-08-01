from __future__ import annotations

import re
from typing import Any

from .schemas import AnalysisRequest, Evidence, Verdict


MONEY_PATTERN = re.compile(r"\$\s?(\d+(?:\.\d{1,2})?)")


class DeterministicEvaluator:
    """Safe first provider; replace with Altur's LLM factory after the boundary is stable."""

    def evaluate(self, request: AnalysisRequest) -> Verdict:
        maximum = int(request.call_contract.allowed_commitments.get("maximum_surcharge_cents", 0))
        surcharge = self._surcharge(request)
        violation = surcharge > maximum
        turn_ids = self._evidence_turns(request, surcharge)

        if violation:
            summary = "The call achieved its goal but accepted a surcharge above the authorized limit."
            finding = "unauthorized_surcharge"
            explanation = (
                f"The agent accepted {self._money(surcharge)}, exceeding the authorized "
                f"limit of {self._money(maximum)}."
            )
        else:
            summary = "The call achieved its goal and stayed within the authorized commitments."
            finding = "policy_compliance"
            explanation = (
                f"The accepted surcharge of {self._money(surcharge)} is within the "
                f"authorized limit of {self._money(maximum)}."
            )

        return Verdict(
            goal_completion="complete",
            policy_adherence=not violation,
            unauthorized_commitment=violation,
            result_confidence=0.98,
            risk_score=0.91 if violation else 0.08,
            needs_human_review=violation,
            summary=summary,
            negotiated_terms={
                "surcharge_cents": surcharge,
                "maximum_authorized_surcharge_cents": maximum,
            },
            evidence=[Evidence(finding=finding, turn_ids=turn_ids, explanation=explanation)],
        )

    def _surcharge(self, request: AnalysisRequest) -> int:
        result: dict[str, Any] = request.provider_result or {}
        if "surcharge_cents" in result:
            return int(result["surcharge_cents"])

        amounts = []
        for turn in request.transcript.turns:
            amounts.extend(int(float(value) * 100) for value in MONEY_PATTERN.findall(turn.text))
        return max(amounts, default=0)

    def _evidence_turns(self, request: AnalysisRequest, surcharge: int) -> list[int]:
        amount = self._money(surcharge).removeprefix("$")
        matches = [turn.id for turn in request.transcript.turns if amount in turn.text]
        return matches or [request.transcript.turns[-1].id]

    def _money(self, cents: int) -> str:
        return f"${cents / 100:.2f}"

