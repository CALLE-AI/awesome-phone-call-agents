from __future__ import annotations

import re
from typing import Any, Iterable

from .schemas import AnalysisRequest, CallContract, Evidence, TranscriptTurn, Verdict


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

# Domain vocabulary used to corroborate a contract term against the transcript. Contract
# terms are snake_case identifiers ("delivery_changed", "confirm_order_number"); each
# token is expanded so a Spanish or paraphrased transcript still matches.
TERM_SYNONYMS: dict[str, tuple[str, ...]] = {
    "delivery": ("delivery", "deliver", "shipment", "ship", "entrega", "entregar", "envio", "envío"),
    "order": ("order", "pedido", "orden"),
    "payment": ("payment", "pay", "paid", "pago", "pagar"),
    "product": ("product", "producto", "item", "articulo", "artículo"),
    "substitution": ("substitution", "substitute", "sustitucion", "sustitución", "sustituir"),
    "date": ("date", "fecha", "day", "dia", "día"),
    "time": ("time", "hora", "horario", "schedule"),
    "price": ("price", "precio", "cost", "costo"),
    "surcharge": ("surcharge", "recargo", "fee", "cargo"),
    "confirm": ("confirm", "confirmed", "confirmation", "confirma", "confirmo", "confirmar"),
    "identity": ("identity", "identify", "identidad", "identific"),
    "recording": ("recording", "recorded", "record", "graba", "grabada", "grabación", "grabacion"),
    "cancel": ("cancel", "cancellation", "cancela", "cancelar", "cancelación"),
}

# A verdict only auto-verifies (no human review) when confidence clears this bar.
CONFIDENCE_AUTO_VERIFY = 0.75


class DeterministicEvaluator:
    """Safe first provider; replace with Altur's LLM factory after the boundary is stable.

    Three rules make a verdict defensible here:

    * **Completion follows the contract, not a truthy field.** A success condition counts
      only when it is declared in ``success_conditions``, reported met by the provider,
      AND corroborated by the transcript.
    * **A structured claim needs positive transcript support.** ``delivery_changed=True``
      over a transcript that only discusses an unrelated fee is *unsupported*: it is
      routed to human review instead of auto-verified.
    * **Every declared policy term is evaluated.** ``required_disclosures`` and
      ``forbidden_commitments`` are checked, not assumed satisfied, and anything missing,
      violated, or unverifiable drops ``policy_adherence`` and forces review.

    The corroboration here is *topical* (domain vocabulary), not semantic: it can tell
    that nothing in the call is about the delivery, but it cannot judge nuanced wording.
    That is deliberate — it fails toward human review, and the LLM provider is the path
    to semantic judgement.
    """

    def evaluate(self, request: AnalysisRequest) -> Verdict:
        contract = request.call_contract
        turns = list(request.transcript.turns)
        maximum = int(contract.allowed_commitments.get("maximum_surcharge_cents", 0))

        surcharge, surcharge_source = self._surcharge(request)
        surcharge_turn_ids, evidence_matched = self._evidence_turns(request, surcharge)
        surcharge_violation = surcharge > maximum

        goal_completion, unmet, unsupported, contradiction_turn_ids = self._assess_goal(
            contract, request.provider_result or {}, turns
        )
        # A true contradiction is the structured result claiming success while the
        # transcript denies it. When the result also reports the objective unmet, result
        # and transcript agree — a clean failure, not a disagreement.
        contradicted = bool(contradiction_turn_ids) and not unmet

        missing_disclosures = self._missing_disclosures(contract, turns)
        forbidden_found = self._forbidden_commitments(contract, turns)

        # Policy adherence covers EVERY declared policy term, not just the surcharge.
        policy_adherence = not (surcharge_violation or missing_disclosures or forbidden_found)
        unauthorized_commitment = surcharge_violation or bool(forbidden_found)

        confidence = self._confidence(
            surcharge_source=surcharge_source,
            evidence_matched=evidence_matched,
            goal_completion=goal_completion,
            contradicted=contradicted,
            unsupported=bool(unsupported),
        )
        weak_evidence = confidence < CONFIDENCE_AUTO_VERIFY

        # Human review on any violation, weak evidence, an objective that is not clearly
        # complete, or an unsupported/unevaluated policy claim.
        needs_review = (
            not policy_adherence
            or weak_evidence
            or goal_completion != "complete"
            or bool(unsupported)
        )

        finding, summary, explanation = self._narrative(
            surcharge_violation=surcharge_violation,
            weak_evidence=weak_evidence,
            surcharge=surcharge,
            maximum=maximum,
            surcharge_source=surcharge_source,
            goal_completion=goal_completion,
            unmet=unmet,
            unsupported=unsupported,
            contradicted=contradicted,
            missing_disclosures=missing_disclosures,
            forbidden_found=forbidden_found,
        )
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
        for condition in unsupported:
            contradictions.append(
                f"The structured result reports '{condition}' met, but no transcript turn "
                "corroborates it."
            )

        return Verdict(
            goal_completion=goal_completion,
            policy_adherence=policy_adherence,
            unauthorized_commitment=unauthorized_commitment,
            result_confidence=round(confidence, 2),
            risk_score=self._risk_score(
                surcharge_violation=surcharge_violation,
                weak_evidence=weak_evidence,
                goal_completion=goal_completion,
                policy_adherence=policy_adherence,
            ),
            needs_human_review=needs_review,
            summary=summary,
            negotiated_terms={
                "surcharge_cents": surcharge,
                "maximum_authorized_surcharge_cents": maximum,
                "surcharge_evidence_source": surcharge_source,
                "unmet_success_conditions": unmet,
                "unsupported_success_conditions": unsupported,
                "forbidden_commitments_detected": forbidden_found,
            },
            missing_disclosures=missing_disclosures,
            contradictions=contradictions,
            evidence=[Evidence(finding=finding, turn_ids=turn_ids, explanation=explanation)],
        )

    # ── transcript corroboration ──────────────────────────────────────────────────

    def _terms(self, contract_term: str) -> list[tuple[str, ...]]:
        """Expand a snake_case contract term into groups of acceptable transcript words."""
        groups: list[tuple[str, ...]] = []
        for token in re.split(r"[^a-zA-Z0-9áéíóúñü]+", contract_term.lower()):
            if len(token) < 4:  # "of", "the", "no" carry no topical signal
                continue
            groups.append(TERM_SYNONYMS.get(token, (token,)))
        return groups

    def _supporting_turns(self, contract_term: str, turns: Iterable[TranscriptTurn]) -> list[int]:
        """Turn ids that topically corroborate `contract_term`, ignoring denials.

        A turn supports the term when it mentions any of its expanded token groups and
        does not itself deny the objective.
        """
        groups = self._terms(contract_term)
        if not groups:
            return []

        supporting = []
        for turn in turns:
            text = turn.text.lower()
            if NEGATION_PATTERN.search(turn.text):
                continue
            if any(any(word in text for word in group) for group in groups):
                supporting.append(turn.id)
        return supporting

    # ── goal completion ───────────────────────────────────────────────────────────

    def _assess_goal(
        self, contract: CallContract, result: dict[str, Any], turns: list[TranscriptTurn]
    ) -> tuple[str, list[str], list[str], list[int]]:
        """Return (status, unmet, unsupported, contradiction_turn_ids).

        `unmet` are conditions the provider itself does not report as met.
        `unsupported` are conditions the provider reports met with NO transcript
        corroboration — a claim we refuse to auto-verify.
        """
        conditions = list(contract.success_conditions)
        contradiction_turn_ids = [t.id for t in turns if NEGATION_PATTERN.search(t.text)]

        if not conditions:
            return "unknown", [], [], contradiction_turn_ids
        if not result:
            return "unknown", conditions, [], contradiction_turn_ids

        unmet = [c for c in conditions if not self._condition_met(c, result)]
        claimed = [c for c in conditions if c not in unmet]
        unsupported = [c for c in claimed if not self._supporting_turns(c, turns)]

        if unmet and len(unmet) == len(conditions):
            return "failed", unmet, unsupported, contradiction_turn_ids
        if unmet or unsupported or contradiction_turn_ids:
            # Anything short of "every condition met AND corroborated" is not complete.
            return "partial", unmet, unsupported, contradiction_turn_ids
        return "complete", [], [], contradiction_turn_ids

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

    # ── declared policy terms ─────────────────────────────────────────────────────

    def _missing_disclosures(
        self, contract: CallContract, turns: list[TranscriptTurn]
    ) -> list[str]:
        """Declared disclosures with no transcript support. Never assumed satisfied."""
        return [d for d in contract.required_disclosures if not self._supporting_turns(d, turns)]

    def _forbidden_commitments(
        self, contract: CallContract, turns: list[TranscriptTurn]
    ) -> list[str]:
        """Declared forbidden commitments that the call appears to have discussed."""
        return [f for f in contract.forbidden_commitments if self._supporting_turns(f, turns)]

    # ── scoring ───────────────────────────────────────────────────────────────────

    def _confidence(
        self,
        *,
        surcharge_source: str,
        evidence_matched: bool,
        goal_completion: str,
        contradicted: bool,
        unsupported: bool,
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
        if unsupported:
            # A success claim nothing in the call corroborates.
            score -= 0.3

        return max(0.05, min(0.95, score))

    def _risk_score(
        self, *, surcharge_violation: bool, weak_evidence: bool, goal_completion: str,
        policy_adherence: bool
    ) -> float:
        if surcharge_violation:
            return 0.91
        if not policy_adherence:
            return 0.8
        if goal_completion == "failed":
            return 0.75
        if weak_evidence or goal_completion != "complete":
            return 0.6
        return 0.08

    # ── narrative ─────────────────────────────────────────────────────────────────

    def _narrative(
        self,
        *,
        surcharge_violation: bool,
        weak_evidence: bool,
        surcharge: int,
        maximum: int,
        surcharge_source: str,
        goal_completion: str,
        unmet: list[str],
        unsupported: list[str],
        contradicted: bool,
        missing_disclosures: list[str],
        forbidden_found: list[str],
    ) -> tuple[str, str, str]:
        if surcharge_violation:
            return (
                "unauthorized_surcharge",
                "The call achieved its goal but accepted a surcharge above the authorized limit.",
                f"The agent accepted {self._money(surcharge)}, exceeding the authorized "
                f"limit of {self._money(maximum)}.",
            )
        if forbidden_found:
            return (
                "forbidden_commitment_discussed",
                "The call touched a commitment the contract forbids.",
                "Forbidden commitments detected in the transcript: "
                f"{', '.join(forbidden_found)}. Human review required.",
            )
        if missing_disclosures:
            return (
                "missing_disclosure",
                "A disclosure the contract requires was not found in the call.",
                f"Required disclosures with no transcript support: "
                f"{', '.join(missing_disclosures)}. They are not assumed satisfied.",
            )
        if unsupported:
            return (
                "unsupported_success_claim",
                "The reported success is not supported by anything said on the call.",
                f"The provider reports {', '.join(unsupported)} met, but no transcript turn "
                "corroborates it; not auto-verifying.",
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
            f"authorized limit of {self._money(maximum)}, every declared success condition "
            "is corroborated by the transcript, and no declared policy term was breached.",
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
