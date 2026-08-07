from __future__ import annotations

import re
from typing import Any, Iterable

from .schemas import AnalysisRequest, CallContract, Evidence, TranscriptTurn, Verdict


MONEY_PATTERN = re.compile(r"\$\s?(\d+(?:\.\d{1,2})?)")

# Who is who. The agent is the party UNDER AUDIT, so nothing it says can prove that an
# outcome happened — its own question or claim is not evidence. Only the counterparty can
# confirm an outcome. `system` and `unknown` confirm nothing.
AUDITED_SPEAKERS = {"agent"}
COUNTERPARTY_SPEAKERS = {"recipient"}

# An explicit agreement from the counterparty. Deliberately a closed list: this is the
# only thing that unlocks auto-verification, so it must be something we can point at.
AFFIRMATION_PATTERN = re.compile(
    r"\b(yes|yeah|yep|sure|of course|correct|that'?s right|agreed|okay|ok|"
    r"that works|works for me|sounds good|confirmed|done|deal|perfect|absolutely|"
    r"s[íi]|claro|correcto|de acuerdo|est[áa] bien|perfecto|confirmado|hecho|listo|"
    r"quedamos|adelante|sale|[óo]rale|[áa]ndale)\b",
    re.IGNORECASE,
)

# Kept for reporting a result/transcript disagreement. It is NOT what gates completion:
# depending on a list of negations means every unlisted phrasing ("Friday doesn't work")
# silently reads as agreement. Completion is gated on the presence of affirmation instead.
NEGATION_PATTERN = re.compile(
    r"(no se pudo|no pudimos|no puedo|no podemos|no fue posible|no es posible|"
    r"no se puede|no hay disponibilidad|no tenemos disponibilidad|"
    r"cannot|can't|could not|couldn't|unable to|not able to|not possible|"
    r"no availability|won'?t be able|will not be able)",
    re.IGNORECASE,
)

# Domain vocabulary used to tell whether a turn is even on the topic of a contract term.
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

# Corroboration levels for one contract term, strongest first.
AFFIRMED = "affirmed"   # the counterparty explicitly agreed, on topic
TOPICAL = "topical"     # the counterparty touched the topic, but never agreed
NONE = "none"           # the counterparty never addressed it at all

CONFIDENCE_AUTO_VERIFY = 0.75


class DeterministicEvaluator:
    """Safe first provider; replace with Altur's LLM factory after the boundary is stable.

    The governing rule is that **nothing is verified unless it was positively proven**.
    An earlier version worked the other way round — it assumed success and searched for
    reasons to doubt it — which meant every situation nobody had thought of resolved as
    "verified". Cases kept slipping through one at a time. Now an unanticipated case
    lands in human review by construction, because completion requires evidence rather
    than the absence of a counter-indication.

    Concretely:

    * Only the **counterparty** can corroborate an outcome. The agent is the party being
      audited, so its own question ("Can we move the delivery?") or claim ("I've moved
      it") is never evidence that anything happened.
    * Corroboration requires an **explicit affirmation** from that counterparty, either
      on topic or answering the agent's on-topic turn. Topic-only mentions are reported
      as weak and routed to review rather than counted as success.
    * Obligations about what the **agent** must or must not say (disclosures, forbidden
      commitments) are read from the agent's turns only — a recipient asking "are you
      recording this?" is not the agent making a disclosure.
    """

    def evaluate(self, request: AnalysisRequest) -> Verdict:
        contract = request.call_contract
        turns = list(request.transcript.turns)
        maximum = int(contract.allowed_commitments.get("maximum_surcharge_cents", 0))

        surcharge, surcharge_source = self._surcharge(request)
        surcharge_turn_ids, evidence_matched = self._evidence_turns(request, surcharge)
        surcharge_violation = surcharge > maximum

        goal = self._assess_goal(contract, request.provider_result or {}, turns)
        goal_completion = goal["status"]
        unmet, unsupported, weak = goal["unmet"], goal["unsupported"], goal["weak"]
        contradiction_turn_ids = goal["contradictions"]
        contradicted = bool(contradiction_turn_ids) and not unmet

        missing_disclosures = self._missing_disclosures(contract, turns)
        forbidden_found = self._forbidden_commitments(contract, turns)

        policy_adherence = not (surcharge_violation or missing_disclosures or forbidden_found)
        unauthorized_commitment = surcharge_violation or bool(forbidden_found)

        confidence = self._confidence(
            surcharge_source=surcharge_source, evidence_matched=evidence_matched,
            goal_completion=goal_completion, contradicted=contradicted,
            unsupported=bool(unsupported), weak=bool(weak),
        )
        weak_evidence = confidence < CONFIDENCE_AUTO_VERIFY

        needs_review = (
            not policy_adherence
            or weak_evidence
            or goal_completion != "complete"
            or bool(unsupported)
            or bool(weak)
        )

        finding, summary, explanation = self._narrative(
            surcharge_violation=surcharge_violation, weak_evidence=weak_evidence,
            surcharge=surcharge, maximum=maximum, surcharge_source=surcharge_source,
            goal_completion=goal_completion, unmet=unmet, unsupported=unsupported,
            weak=weak, contradicted=contradicted, missing_disclosures=missing_disclosures,
            forbidden_found=forbidden_found,
        )
        turn_ids = (
            contradiction_turn_ids
            if finding == "objective_not_met" and contradiction_turn_ids
            else goal["evidence_turns"] or surcharge_turn_ids
        )

        contradictions: list[str] = []
        if contradicted:
            contradictions.append(
                "The structured result reports success while the transcript states the "
                "objective could not be completed."
            )
        for condition in unsupported:
            contradictions.append(
                f"The structured result reports '{condition}' met, but the recipient never "
                "addressed it on the call."
            )
        for condition in weak:
            contradictions.append(
                f"'{condition}' was discussed but the recipient never confirmed it; the "
                "agent's own words do not count as confirmation."
            )

        return Verdict(
            goal_completion=goal_completion,
            policy_adherence=policy_adherence,
            unauthorized_commitment=unauthorized_commitment,
            result_confidence=round(confidence, 2),
            risk_score=self._risk_score(
                surcharge_violation=surcharge_violation, weak_evidence=weak_evidence,
                goal_completion=goal_completion, policy_adherence=policy_adherence,
            ),
            needs_human_review=needs_review,
            summary=summary,
            negotiated_terms={
                "surcharge_cents": surcharge,
                "maximum_authorized_surcharge_cents": maximum,
                "surcharge_evidence_source": surcharge_source,
                "unmet_success_conditions": unmet,
                "unsupported_success_conditions": unsupported,
                "weakly_supported_success_conditions": weak,
                "forbidden_commitments_detected": forbidden_found,
            },
            missing_disclosures=missing_disclosures,
            contradictions=contradictions,
            evidence=[Evidence(finding=finding, turn_ids=turn_ids, explanation=explanation)],
        )

    # ── corroboration ─────────────────────────────────────────────────────────────

    def _terms(self, contract_term: str) -> list[tuple[str, ...]]:
        """Expand a snake_case contract term into groups of acceptable transcript words."""
        groups: list[tuple[str, ...]] = []
        for token in re.split(r"[^a-zA-Z0-9áéíóúñü]+", contract_term.lower()):
            if len(token) < 4:  # "of", "the", "no" carry no topical signal
                continue
            groups.append(TERM_SYNONYMS.get(token, (token,)))
        return groups

    def _is_topical(self, text: str, groups: list[tuple[str, ...]]) -> bool:
        low = text.lower()
        return any(any(word in low for word in group) for group in groups)

    def _discriminating(self, term: str, siblings: Iterable[str]) -> list[tuple[str, ...]]:
        """The word groups that tell `term` apart from the other terms judged with it.

        Without this, terms sharing a word leak evidence into each other: with
        `delivery_date_confirmed` and `delivery_time_confirmed` on the same contract,
        "the delivery date is fine" would corroborate the *time* as well, because both
        contain "delivery". Words common to every term carry no discriminating power, so
        they are dropped — unless that would leave nothing to match on.
        """
        groups = self._terms(term)
        others = [self._terms(s) for s in siblings if s != term]
        if not others:
            return groups

        shared = {g for g in groups if all(g in other for other in others)}
        distinct = [g for g in groups if g not in shared]
        return distinct or groups

    def _corroboration(self, term: str, turns: list[TranscriptTurn],
                       siblings: Iterable[str] = ()) -> tuple[str, list[int]]:
        """How well the COUNTERPARTY backs `term`: affirmed, topical, or none.

        The agent's turns are read only to establish what a following "yes" is answering.
        They can never themselves be the corroboration.
        """
        groups = self._discriminating(term, siblings)
        if not groups:
            return NONE, []

        affirmed: list[int] = []
        topical: list[int] = []
        for index, turn in enumerate(turns):
            if turn.speaker not in COUNTERPARTY_SPEAKERS:
                continue
            if NEGATION_PATTERN.search(turn.text):
                continue

            on_topic = self._is_topical(turn.text, groups)
            affirms = bool(AFFIRMATION_PATTERN.search(turn.text)) and "?" not in turn.text
            # A bare "yes" corroborates only what the agent just asked about.
            answers_topical_question = (
                index > 0
                and turns[index - 1].speaker in AUDITED_SPEAKERS
                and self._is_topical(turns[index - 1].text, groups)
            )

            if affirms and (on_topic or answers_topical_question):
                affirmed.append(turn.id)
            elif on_topic:
                topical.append(turn.id)

        if affirmed:
            return AFFIRMED, affirmed
        if topical:
            return TOPICAL, topical
        return NONE, []

    def _agent_mentions(self, term: str, turns: list[TranscriptTurn]) -> list[int]:
        """Turns where the AGENT itself raised the term — used for its own obligations."""
        groups = self._terms(term)
        if not groups:
            return []
        return [t.id for t in turns
                if t.speaker in AUDITED_SPEAKERS and self._is_topical(t.text, groups)]

    # ── goal completion ───────────────────────────────────────────────────────────

    def _assess_goal(self, contract: CallContract, result: dict[str, Any],
                     turns: list[TranscriptTurn]) -> dict[str, Any]:
        conditions = list(contract.success_conditions)
        contradictions = [t.id for t in turns if NEGATION_PATTERN.search(t.text)]
        base = {"unmet": [], "unsupported": [], "weak": [],
                "contradictions": contradictions, "evidence_turns": []}

        if not conditions:
            return {**base, "status": "unknown"}
        if not result:
            return {**base, "status": "unknown", "unmet": conditions}

        unmet = [c for c in conditions if not self._condition_met(c, result)]
        claimed = [c for c in conditions if c not in unmet]

        unsupported, weak, evidence_turns = [], [], []
        for condition in claimed:
            level, ids = self._corroboration(condition, turns, siblings=conditions)
            if level == AFFIRMED:
                evidence_turns.extend(ids)
            elif level == TOPICAL:
                weak.append(condition)
                evidence_turns.extend(ids)
            else:
                unsupported.append(condition)

        state = {**base, "unmet": unmet, "unsupported": unsupported, "weak": weak,
                 "evidence_turns": evidence_turns}

        if unmet and len(unmet) == len(conditions):
            return {**state, "status": "failed"}
        if unmet or unsupported or weak or contradictions:
            return {**state, "status": "partial"}
        return {**state, "status": "complete"}

    def _condition_met(self, condition: str, result: dict[str, Any]) -> bool:
        if condition in result:
            return self._truthy(result[condition])
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

    # ── the agent's own obligations ───────────────────────────────────────────────

    def _missing_disclosures(self, contract: CallContract,
                             turns: list[TranscriptTurn]) -> list[str]:
        """Declared disclosures the AGENT never made. Never assumed satisfied.

        Read from agent turns only: a recipient asking "are you recording this?" is not
        the agent disclosing that the call is recorded.
        """
        return [d for d in contract.required_disclosures if not self._agent_mentions(d, turns)]

    def _forbidden_commitments(self, contract: CallContract,
                               turns: list[TranscriptTurn]) -> list[str]:
        """Forbidden commitments the AGENT itself raised.

        A recipient asking for a product substitution is not the agent offering one, so
        only agent turns can trip this.
        """
        return [f for f in contract.forbidden_commitments if self._agent_mentions(f, turns)]

    # ── scoring ───────────────────────────────────────────────────────────────────

    def _confidence(self, *, surcharge_source: str, evidence_matched: bool,
                    goal_completion: str, contradicted: bool, unsupported: bool,
                    weak: bool) -> float:
        score = 0.4
        if surcharge_source == "provider_result":
            score += 0.3
        elif surcharge_source == "transcript":
            score += 0.15
        else:
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
            score -= 0.25
        if unsupported:
            score -= 0.3
        if weak:
            # Discussed but never confirmed: enough to keep it under the auto-verify bar.
            score -= 0.2

        return max(0.05, min(0.95, score))

    def _risk_score(self, *, surcharge_violation: bool, weak_evidence: bool,
                    goal_completion: str, policy_adherence: bool) -> float:
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

    def _narrative(self, *, surcharge_violation: bool, weak_evidence: bool, surcharge: int,
                   maximum: int, surcharge_source: str, goal_completion: str,
                   unmet: list[str], unsupported: list[str], weak: list[str],
                   contradicted: bool, missing_disclosures: list[str],
                   forbidden_found: list[str]) -> tuple[str, str, str]:
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
                "The agent raised a commitment the contract forbids.",
                f"Forbidden commitments in the agent's own turns: {', '.join(forbidden_found)}. "
                "Human review required.",
            )
        if missing_disclosures:
            return (
                "missing_disclosure",
                "A disclosure the contract requires was never made by the agent.",
                f"Required disclosures absent from the agent's turns: "
                f"{', '.join(missing_disclosures)}. They are not assumed satisfied.",
            )
        if unsupported:
            return (
                "unsupported_success_claim",
                "The reported success is not supported by anything the recipient said.",
                f"The provider reports {', '.join(unsupported)} met, but the recipient never "
                "addressed it; the agent's own words are not evidence. Not auto-verifying.",
            )
        if weak:
            return (
                "unconfirmed_success_claim",
                "The objective was discussed but the recipient never confirmed it.",
                f"{', '.join(weak)} came up on the call, yet no affirmative confirmation from "
                "the recipient was found. Routed to human review rather than counted as success.",
            )
        if goal_completion in ("failed", "partial"):
            detail = (
                f"unmet success conditions: {', '.join(unmet)}"
                if unmet else "the declared success conditions are reported as met"
            )
            contra = (
                " The transcript explicitly states the objective could not be completed."
                if contradicted else ""
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
            f"The accepted surcharge of {self._money(surcharge)} is within the authorized "
            f"limit of {self._money(maximum)}, every declared success condition was "
            "confirmed by the recipient, and no declared policy term was breached.",
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
        """Turns that actually mention the amount, and whether any really did."""
        amount = self._money(surcharge).removeprefix("$")
        matches = [turn.id for turn in request.transcript.turns if amount in turn.text]
        if matches:
            return matches, True
        return [request.transcript.turns[-1].id], False

    def _money(self, cents: int) -> str:
        return f"${cents / 100:.2f}"
