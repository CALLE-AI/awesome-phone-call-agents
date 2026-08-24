from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation
from typing import Any

from .schemas import (
    AnalysisRequest,
    ClaimResult,
    CommitmentLimitClaim,
    Evidence,
    ForbiddenCommitmentClaim,
    RequiredDisclosureClaim,
    SuccessClaim,
    TranscriptTurn,
    Verdict,
)


MONEY_PATTERN = re.compile(r"(?<!\w)\$\s*(\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?)(?!\w)")
NEGATIVE_RESPONSES = frozenset({"no"})
PROTOCOL = {
    "en": {
        "delivery_date_confirmed": "Please confirm exactly: the delivery date is {expected}. Answer YES or NO.",
        "delivery_time_confirmed": "Please confirm exactly: the delivery time is {expected}. Answer YES or NO.",
        "surcharge_within_limit": "Please confirm exactly: the surcharge is {amount}. Answer YES or NO.",
        "recording_notice": "This call is being recorded.",
        "response": "yes",
    },
    "es": {
        "delivery_date_confirmed": "Confirme exactamente: la fecha de entrega es {expected}. Responda SÍ o NO.",
        "delivery_time_confirmed": "Confirme exactamente: la hora de entrega es {expected}. Responda SÍ o NO.",
        "surcharge_within_limit": "Confirme exactamente: el recargo es {amount}. Responda SÍ o NO.",
        "recording_notice": "Esta llamada está siendo grabada.",
        "response": "sí",
    },
}


class DeterministicEvaluator:
    """A finite proof checker, not a natural-language judge.

    Auto-verification is possible only for the exact protocol encoded in the immutable
    contract: an exact positive statement from the agent followed immediately by an exact
    recipient response. Keywords, morphology and the agent's own free-form questions never
    establish meaning. A supported confirmation also remains valid only while every later
    turn belongs to the finite protocol; free-form speech after it can retract the agreement
    and therefore routes the call to human review.
    """

    def evaluate(self, request: AnalysisRequest) -> Verdict:
        result = request.provider_result or {}
        turns = list(request.transcript.turns)
        claim_results = [self._evaluate_claim(claim, result, turns, request.call_contract.protocol_language)
                         for claim in request.call_contract.verification_claims]
        claim_results = self._enforce_protocol_closure(
            claim_results,
            request.call_contract.verification_claims,
            result,
            turns,
            request.call_contract.protocol_language,
        )

        success = [item for item in claim_results if item.kind == "success"]
        policy = [item for item in claim_results if item.kind != "success"]
        goal_completion = self._goal_completion(success)
        policy_evaluation = self._policy_evaluation(policy)
        policy_adherence = policy_evaluation == "compliant"
        unauthorized = any(
            item.kind in {"commitment_limit", "forbidden_commitment"}
            and item.status == "violated"
            for item in claim_results
        )
        needs_review = goal_completion != "complete" or policy_evaluation != "compliant"

        confidence = self._confidence(claim_results, needs_review)
        risk = self._risk(claim_results, needs_review)
        missing_disclosures = [
            item.claim_id for item in claim_results
            if item.kind == "required_disclosure" and item.status != "supported"
        ]
        contradictions = [
            item.explanation for item in claim_results
            if item.status in {"contradicted", "violated"}
        ]
        evidence = [
            Evidence(
                finding=f"{item.claim_id}_{item.status}",
                turn_ids=item.turn_ids,
                explanation=item.explanation,
            )
            for item in claim_results if item.turn_ids
        ]

        surcharge_claim = next(
            (item for item in claim_results if item.kind == "commitment_limit"), None
        )
        forbidden = [
            item.claim_id for item in claim_results
            if item.kind == "forbidden_commitment" and item.status == "violated"
        ]

        return Verdict(
            goal_completion=goal_completion,
            policy_adherence=policy_adherence,
            policy_evaluation=policy_evaluation,
            unauthorized_commitment=unauthorized,
            result_confidence=confidence,
            risk_score=risk,
            needs_human_review=needs_review,
            summary=self._summary(goal_completion, policy_evaluation),
            negotiated_terms={
                "surcharge_cents": surcharge_claim.actual if surcharge_claim else None,
                "maximum_authorized_surcharge_cents": (
                    surcharge_claim.expected if surcharge_claim else None
                ),
                "forbidden_commitments_detected": forbidden,
            },
            missing_disclosures=missing_disclosures,
            contradictions=contradictions,
            claim_results=claim_results,
            evidence=evidence,
        )

    def _evaluate_claim(
        self,
        claim: SuccessClaim | CommitmentLimitClaim | RequiredDisclosureClaim | ForbiddenCommitmentClaim,
        result: dict[str, Any],
        turns: list[TranscriptTurn],
        language: str,
    ) -> ClaimResult:
        if isinstance(claim, SuccessClaim):
            return self._success_claim(claim, result, turns, language)
        if isinstance(claim, CommitmentLimitClaim):
            return self._commitment_claim(claim, result, turns, language)
        if isinstance(claim, RequiredDisclosureClaim):
            return self._disclosure_claim(claim, turns, language)
        return ClaimResult(
            claim_id=claim.id,
            kind=claim.kind,
            status="unevaluated",
            explanation=(
                f"'{claim.id}' requires semantic interpretation. The deterministic evaluator "
                "cannot prove that free-form speech omitted a forbidden commitment."
            ),
        )

    def _success_claim(
        self, claim: SuccessClaim, result: dict[str, Any], turns: list[TranscriptTurn], language: str
    ) -> ClaimResult:
        if claim.result_field not in result:
            return self._claim_result(
                claim, "unevaluated", expected=claim.expected,
                explanation=f"Provider result omitted '{claim.result_field}'.",
            )

        actual = result[claim.result_field]
        if not self._exactly_equal(actual, claim.expected):
            return self._claim_result(
                claim, "contradicted", expected=claim.expected, actual=actual,
                explanation=(
                    f"Provider result reported {claim.result_field}={actual!r}; "
                    f"the immutable contract requires {claim.expected!r}."
                ),
            )

        status, turn_ids = self._confirmation(
            PROTOCOL[language][claim.id].format(expected=claim.expected),
            [PROTOCOL[language]["response"]],
            turns,
        )
        return self._claim_result(
            claim, status, expected=claim.expected, actual=actual, turn_ids=turn_ids,
            explanation=self._confirmation_explanation(claim.id, status),
        )

    def _commitment_claim(
        self, claim: CommitmentLimitClaim, result: dict[str, Any], turns: list[TranscriptTurn], language: str
    ) -> ClaimResult:
        if claim.result_field not in result:
            return self._claim_result(
                claim, "unevaluated", expected=claim.maximum,
                explanation=f"Provider result omitted '{claim.result_field}'.",
            )

        actual = result[claim.result_field]
        if isinstance(actual, bool) or not isinstance(actual, int) or actual < 0:
            return self._claim_result(
                claim, "unevaluated", expected=claim.maximum, actual=actual,
                explanation=f"Provider result supplied an invalid {claim.result_field}: {actual!r}.",
            )

        statement = PROTOCOL[language][claim.id].format(amount=self._money(actual))
        confirmation_status, confirmation_ids = self._confirmation(
            statement, [PROTOCOL[language]["response"]], turns
        )
        amount_evidence = self._money_evidence(turns)
        conflicting_ids = [turn_id for turn_id, amounts in amount_evidence.items()
                           if any(amount != actual for amount in amounts)]

        if actual > claim.maximum:
            return self._claim_result(
                claim, "violated", expected=claim.maximum, actual=actual,
                turn_ids=self._unique(confirmation_ids + conflicting_ids),
                explanation=(
                    f"The provider reports {self._money(actual)}, above the authorized "
                    f"maximum of {self._money(claim.maximum)}."
                ),
            )
        if conflicting_ids:
            return self._claim_result(
                claim, "contradicted", expected=claim.maximum, actual=actual,
                turn_ids=self._unique(confirmation_ids + conflicting_ids),
                explanation=(
                    f"Transcript money values conflict with the provider's asserted "
                    f"{self._money(actual)} surcharge."
                ),
            )

        return self._claim_result(
            claim, confirmation_status, expected=claim.maximum, actual=actual,
            turn_ids=confirmation_ids,
            explanation=self._confirmation_explanation(claim.id, confirmation_status),
        )

    def _disclosure_claim(
        self, claim: RequiredDisclosureClaim, turns: list[TranscriptTurn], language: str
    ) -> ClaimResult:
        statement = PROTOCOL[language][claim.id]
        matched = [turn.id for turn in turns
                   if turn.speaker == "agent"
                   and self._normalize(turn.text) == self._normalize(statement)]
        status = "supported" if matched else "absent"
        explanation = (
            f"The agent made the exact required disclosure '{claim.id}'."
            if matched else
            f"No agent turn exactly matched the required positive disclosure '{claim.id}'."
        )
        return self._claim_result(claim, status, turn_ids=matched, explanation=explanation)

    def _confirmation(
        self, statement: str, accepted_responses: list[str], turns: list[TranscriptTurn]
    ) -> tuple[str, list[int]]:
        expected_statement = self._normalize(statement)
        accepted = {self._normalize(item) for item in accepted_responses}
        outcomes: list[tuple[str, list[int]]] = []

        for index, turn in enumerate(turns):
            if turn.speaker != "agent" or self._normalize(turn.text) != expected_statement:
                continue
            if index + 1 >= len(turns) or turns[index + 1].speaker != "recipient":
                outcomes.append(("ambiguous", [turn.id]))
                continue
            answer = turns[index + 1]
            normalized_answer = self._normalize(answer.text)
            if normalized_answer in accepted:
                outcomes.append(("supported", [turn.id, answer.id]))
            elif normalized_answer in NEGATIVE_RESPONSES:
                outcomes.append(("contradicted", [turn.id, answer.id]))
            else:
                outcomes.append(("ambiguous", [turn.id, answer.id]))

        if not outcomes:
            return "absent", []
        all_ids = self._unique([turn_id for _, ids in outcomes for turn_id in ids])
        statuses = {status for status, _ in outcomes}
        if "contradicted" in statuses:
            return "contradicted", all_ids
        if statuses == {"supported"}:
            return "supported", all_ids
        return "ambiguous", all_ids

    def _enforce_protocol_closure(
        self,
        results: list[ClaimResult],
        claims: list[
            SuccessClaim | CommitmentLimitClaim | RequiredDisclosureClaim | ForbiddenCommitmentClaim
        ],
        provider_result: dict[str, Any],
        turns: list[TranscriptTurn],
        language: str,
    ) -> list[ClaimResult]:
        """Fail closed when unstructured speech follows a proven confirmation.

        The finite evaluator cannot decide whether a later free-form turn retracts a prior
        agreement. It therefore keeps only confirmations after which the remaining transcript
        consists entirely of canonical protocol statements and their exact responses.
        """
        protocol_indices = self._protocol_indices(claims, provider_result, turns, language)
        result_turn_ids = {turn_id for result in results for turn_id in result.turn_ids}
        turn_positions = {
            turn.id: index for index, turn in enumerate(turns) if turn.id in result_turn_ids
        }
        revised: list[ClaimResult] = []

        for result in results:
            if result.status != "supported" or result.kind not in {"success", "commitment_limit"}:
                revised.append(result)
                continue

            confirmation_positions = [
                turn_positions[turn_id]
                for turn_id in result.turn_ids
                if turn_id in turn_positions
            ]
            if not confirmation_positions:
                revised.append(result)
                continue

            confirmed_at = max(confirmation_positions)
            later_unstructured = [
                turn.id
                for index, turn in enumerate(turns)
                if index > confirmed_at and index not in protocol_indices
            ]
            if not later_unstructured:
                revised.append(result)
                continue

            revised.append(result.model_copy(update={
                "status": "ambiguous",
                "turn_ids": self._unique(result.turn_ids + later_unstructured),
                "explanation": (
                    f"'{result.claim_id}' matched the exact confirmation protocol, but later "
                    f"turns {later_unstructured} are outside that protocol and may retract it. "
                    "The deterministic evaluator cannot interpret those turns; human review "
                    "is required."
                ),
            }))

        return revised

    def _protocol_indices(
        self,
        claims: list[
            SuccessClaim | CommitmentLimitClaim | RequiredDisclosureClaim | ForbiddenCommitmentClaim
        ],
        provider_result: dict[str, Any],
        turns: list[TranscriptTurn],
        language: str,
    ) -> set[int]:
        confirmation_statements: set[str] = set()
        disclosure_statements: set[str] = set()

        for claim in claims:
            if isinstance(claim, SuccessClaim):
                confirmation_statements.add(self._normalize(
                    PROTOCOL[language][claim.id].format(expected=claim.expected)
                ))
            elif isinstance(claim, CommitmentLimitClaim):
                actual = provider_result.get(claim.result_field)
                if isinstance(actual, int) and not isinstance(actual, bool) and actual >= 0:
                    confirmation_statements.add(self._normalize(
                        PROTOCOL[language][claim.id].format(amount=self._money(actual))
                    ))
            elif isinstance(claim, RequiredDisclosureClaim):
                disclosure_statements.add(self._normalize(PROTOCOL[language][claim.id]))

        exact_responses = {
            self._normalize(PROTOCOL[language]["response"]),
            *NEGATIVE_RESPONSES,
        }
        protocol_indices: set[int] = set()
        for index, turn in enumerate(turns):
            if turn.speaker != "agent":
                continue

            statement = self._normalize(turn.text)
            if statement in disclosure_statements:
                protocol_indices.add(index)
            if statement not in confirmation_statements:
                continue

            protocol_indices.add(index)
            if index + 1 >= len(turns):
                continue
            answer = turns[index + 1]
            if answer.speaker == "recipient" and self._normalize(answer.text) in exact_responses:
                protocol_indices.add(index + 1)

        return protocol_indices

    def _money_evidence(self, turns: list[TranscriptTurn]) -> dict[int, list[int]]:
        found: dict[int, list[int]] = {}
        for turn in turns:
            amounts: list[int] = []
            for raw in MONEY_PATTERN.findall(turn.text):
                try:
                    amounts.append(int(Decimal(raw.replace(",", "")) * 100))
                except (InvalidOperation, ValueError):
                    continue
            if amounts:
                found[turn.id] = amounts
        return found

    def _claim_result(self, claim: Any, status: str, *, expected: Any = None,
                      actual: Any = None, turn_ids: list[int] | None = None,
                      explanation: str) -> ClaimResult:
        return ClaimResult(
            claim_id=claim.id,
            kind=claim.kind,
            status=status,
            expected=expected,
            actual=actual,
            turn_ids=turn_ids or [],
            explanation=explanation,
        )

    @staticmethod
    def _exactly_equal(actual: Any, expected: Any) -> bool:
        return type(actual) is type(expected) and actual == expected

    @staticmethod
    def _goal_completion(results: list[ClaimResult]) -> str:
        if not results:
            return "unknown"
        statuses = {item.status for item in results}
        if statuses == {"supported"}:
            return "complete"
        if "contradicted" in statuses:
            return "failed" if statuses == {"contradicted"} else "partial"
        return "unknown"

    @staticmethod
    def _policy_evaluation(results: list[ClaimResult]) -> str:
        if any(item.status in {"violated", "contradicted"} for item in results):
            return "violated"
        if all(item.status == "supported" for item in results):
            return "compliant"
        return "unknown"

    @staticmethod
    def _confidence(results: list[ClaimResult], needs_review: bool) -> float:
        if not needs_review:
            return 0.95
        if any(item.status in {"contradicted", "violated"} for item in results):
            return 0.2
        return 0.45

    @staticmethod
    def _risk(results: list[ClaimResult], needs_review: bool) -> float:
        if any(item.status == "violated" for item in results):
            return 0.91
        if any(item.status == "contradicted" for item in results):
            return 0.8
        return 0.6 if needs_review else 0.08

    @staticmethod
    def _summary(goal: str, policy: str) -> str:
        if goal == "complete" and policy == "compliant":
            return "Every declared claim was proven by the contract's exact verification protocol."
        if policy == "violated":
            return "A declared policy rule was violated or contradicted; human review is required."
        return "At least one declared claim is absent, ambiguous, or unevaluated; human review is required."

    @staticmethod
    def _confirmation_explanation(claim_id: str, status: str) -> str:
        descriptions = {
            "supported": "matched the exact agent statement and adjacent recipient response",
            "contradicted": "matched the exact agent statement but the recipient rejected it",
            "ambiguous": "did not receive an exact adjacent recipient response",
            "absent": "never appeared as the exact canonical agent statement",
        }
        return f"'{claim_id}' {descriptions[status]}."

    @staticmethod
    def _normalize(text: str) -> str:
        normalized = unicodedata.normalize("NFKC", text).casefold()
        normalized = re.sub(r"\s+", " ", normalized).strip()
        return normalized.rstrip(" .!¡?¿")

    @staticmethod
    def _money(cents: int) -> str:
        return f"${cents / 100:.2f}"

    @staticmethod
    def _unique(values: list[int]) -> list[int]:
        return list(dict.fromkeys(values))
