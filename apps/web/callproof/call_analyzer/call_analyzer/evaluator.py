from __future__ import annotations

import re
from typing import Any

from .schemas import AnalysisRequest, Evidence, Verdict


MONEY_PATTERN = re.compile(r"\$\s?(\d+(?:\.\d{1,2})?)")

# The transcript explicitly stating the objective could not be done. A structured result
# that claims success while the recipient says this is a CONTRADICTION, never an
# auto-verifiable success.
NEGATION_PATTERN = re.compile(
    r"(no se pudo|no pudimos|no puedo|no podemos|no fue posible|no es posible|"
    r"no se puede|no hay disponibilidad|no tenemos disponibilidad|"
    r"cannot|can't|could not|couldn't|unable to|not able to|not possible|"
    r"no availability|won'?t be able|will not be able)",
    re.IGNORECASE,
)

# A verdict only auto-verifies (no human review) when confidence clears this bar.
CONFIDENCE_AUTO_VERIFY = 0.75


class DeterministicEvaluator:
    """Safe first provider; replace with Altur's LLM factory after the boundary is stable.

    Two rules make this defensible:

    * Completion follows the CONTRACT's declared ``success_conditions`` and the
      transcript — never an unrelated truthy field. A result carrying
      ``order_number_confirmed=True`` while the declared condition ``delivery_changed``
      is False is a FAILED objective, not a complete one.
    * Confidence is derived from evidence strength, never assumed. A payload whose
      surcharge or goal cannot be located in the transcript yields low confidence and is
      routed to human review instead of being auto-verified.
    """

    def evaluate(self, request: AnalysisRequest) -> Verdict:
        maximum = int(request.call_contract.allowed_commitments.get("maximum_surcharge_cents", 0))
        surcharge, surcharge_source = self._surcharge(request)
        surcharge_turn_ids, evidence_matched = self._evidence_turns(request, surcharge)
        violation = surcharge > maximum

        goal_completion, unmet, contradiction_turn_ids = self._goal_completion(request)
        # A true contradiction is the structured result claiming success (no unmet
        # conditions) while the transcript denies it. When the result ALSO reports the
        # objective unmet, result and transcript agree — that is a clean failure, not a
        # disagreement.
        contradicted = bool(contradiction_turn_ids) and not unmet
        confidence = self._confidence(
            surcharge_source, evidence_matched, goal_completion, contradicted
        )
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
            goal_completion=goal_completion,
            unmet=unmet,
            contradicted=contradicted,
        )
        # Cite what actually supports the finding: for an unmet objective that is the
        # transcript turn denying it, otherwise the turn carrying the amount.
        turn_ids = (
            contradiction_turn_ids
            if finding == "objective_not_met" and contradiction_turn_ids
            else surcharge_turn_ids
        )

        contradictions: list[str] = []
        if contradicted:
            contradictions.append(
                "The structured result reports success while the transcript states the "
                "objective could not be completed."
            )

        return Verdict(
            goal_completion=goal_completion,
            policy_adherence=not violation,
            unauthorized_commitment=violation,
            result_confidence=round(confidence, 2),
            risk_score=self._risk_score(violation, weak_evidence, goal_completion),
            needs_human_review=needs_review,
            summary=summary,
            negotiated_terms={
                "surcharge_cents": surcharge,
                "maximum_authorized_surcharge_cents": maximum,
                "surcharge_evidence_source": surcharge_source,
                "unmet_success_conditions": unmet,
            },
            contradictions=contradictions,
            evidence=[Evidence(finding=finding, turn_ids=turn_ids, explanation=explanation)],
        )

    # ── goal completion ───────────────────────────────────────────────────────────

    def _goal_completion(self, request: AnalysisRequest) -> tuple[str, list[str], list[int]]:
        """Return (status, unmet_conditions, contradiction_turn_ids).

        Completion is judged ONLY against the contract's declared success conditions,
        cross-checked with the transcript. Nothing else may promote a call to
        ``complete``.
        """
        result: dict[str, Any] = request.provider_result or {}
        conditions = list(request.call_contract.success_conditions)
        contradiction_turn_ids = [
            turn.id for turn in request.transcript.turns if NEGATION_PATTERN.search(turn.text)
        ]

        if not conditions:
            # Nothing declared to verify — cannot claim completion.
            return "unknown", [], contradiction_turn_ids
        if not result:
            return "unknown", conditions, contradiction_turn_ids

        unmet = [c for c in conditions if not self._condition_met(c, result)]

        if unmet and len(unmet) == len(conditions):
            return "failed", unmet, contradiction_turn_ids
        if unmet:
            return "partial", unmet, contradiction_turn_ids
        # Every declared condition is satisfied; a transcript that denies it still blocks
        # auto-verification.
        return ("partial" if contradiction_turn_ids else "complete"), [], contradiction_turn_ids

    def _condition_met(self, condition: str, result: dict[str, Any]) -> bool:
        if condition in result:
            return self._truthy(result[condition])
        # "<field>_confirmed" is satisfied when <field> itself carries a value.
        if condition.endswith("_confirmed"):
            base = condition[: -len("_confirmed")]
            if base in result:
                return self._truthy(result[base])
        return False

    @staticmethod
    def _truthy(value: Any) -> bool:
        if value is None or value is False:
            return False
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() not in {"", "false", "no", "none", "null"}
        return bool(value)

    # ── scoring ───────────────────────────────────────────────────────────────────

    def _confidence(
        self, surcharge_source: str, evidence_matched: bool, goal_completion: str,
        contradicted: bool
    ) -> float:
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
        elif goal_completion == "failed":
            score -= 0.2

        if contradicted:
            # The structured result and the transcript disagree — never auto-verify.
            score -= 0.25

        return max(0.05, min(0.95, score))

    def _risk_score(self, violation: bool, weak_evidence: bool, goal_completion: str) -> float:
        if violation:
            return 0.91
        if goal_completion == "failed":
            return 0.75
        if weak_evidence or goal_completion != "complete":
            return 0.6
        return 0.08

    # ── narrative ─────────────────────────────────────────────────────────────────

    def _narrative(
        self,
        *,
        violation: bool,
        weak_evidence: bool,
        surcharge: int,
        maximum: int,
        surcharge_source: str,
        goal_completion: str,
        unmet: list[str],
        contradicted: bool,
    ) -> tuple[str, str, str]:
        if violation:
            return (
                "unauthorized_surcharge",
                "The call achieved its goal but accepted a surcharge above the authorized limit.",
                f"The agent accepted {self._money(surcharge)}, exceeding the authorized "
                f"limit of {self._money(maximum)}.",
            )
        if goal_completion in ("failed", "partial"):
            detail = (
                f"unmet success conditions: {', '.join(unmet)}"
                if unmet
                else "the declared success conditions are reported as met"
            )
            contra = (
                " The transcript explicitly states the objective could not be completed."
                if contradicted
                else ""
            )
            return (
                "objective_not_met",
                "The call did NOT achieve the objective declared in the contract.",
                f"Completion is judged against the contract's success conditions - {detail}."
                f"{contra}",
            )
        if weak_evidence:
            reason = (
                "no surcharge amount was found in the provider result or transcript"
                if surcharge_source == "none"
                else "the reported amount is not supported by a matching transcript turn"
            )
            return (
                "unsupported_result",
                "The result could not be verified from the transcript and needs human review.",
                f"Confidence is low because {reason}; not auto-verifying.",
            )
        if goal_completion == "unknown":
            return (
                "unverifiable_objective",
                "The objective could not be verified and needs human review.",
                "The provider result or the contract's success conditions were missing, so "
                "completion cannot be established.",
            )
        return (
            "policy_compliance",
            "The call achieved its goal and stayed within the authorized commitments.",
            f"The accepted surcharge of {self._money(surcharge)} is within the "
            f"authorized limit of {self._money(maximum)}, supported by transcript evidence.",
        )

    # ── surcharge helpers ─────────────────────────────────────────────────────────

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
