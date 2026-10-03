#!/usr/bin/env python3
"""call-total-cost-disclosure-auditor - audit cost-disclosure timing in CALL-E transcripts.

Twin-mode heuristic skill:
  analyze  locate the agent's monetary commitment elicitation and the
           callee's consent, grade whether the total amount, recurring
           terms, and fees or restrictions were disclosed BEFORE consent,
           and flag drip-pricing reveals that surface only after consent
  craft    emit a transparent-offer goal template that front-loads the full
           price before a single commitment question

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient"}

DISCLAIMER = (
    "Presence-and-timing audit only. The skill cannot verify a stated amount "
    "is the true or complete price, only that a total was spoken before "
    "consent; multi-item calls may interleave disclosures; digits-and-"
    "'dollars' lexicon only (no number words, no non-USD currencies in v1). "
    "Findings route to review."
)

_DIGIT_RUN_RE = re.compile(r"[0-9](?:[ ,./-][0-9]|[0-9])*")


def _mask_match(m: re.Match[str]) -> str:
    run = m.group(0)
    digit_count = sum(1 for ch in run if ch in "0123456789")
    if digit_count < 7:
        return run
    return "#" * (len(run) - 2) + run[-2:]


def mask_pii(text: str) -> str:
    """Mask any 7+-digit run (separators included) keeping the last 2 chars."""
    return _DIGIT_RUN_RE.sub(_mask_match, text)


def load_call_result(path: Path) -> dict[str, Any]:
    """Load a CALL-E call result and normalize its transcript to turns."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"call result must be a JSON object, got {type(data).__name__}")
    payload = data.get("result") if isinstance(data.get("result"), dict) else data
    raw = payload.get("transcript", "")
    if isinstance(raw, str):
        turns = [{"speaker": "agent", "text": raw}] if raw.strip() else []
    elif isinstance(raw, list):
        turns = [
            {"speaker": str(item.get("speaker", "unknown")), "text": str(item.get("text", ""))}
            for item in raw
            if isinstance(item, dict)
        ]
    else:
        turns = []
    return {
        "call_id": data.get("call_id") or payload.get("call_id"),
        "status": data.get("status") or payload.get("status"),
        "turns": turns,
    }


# Split on sentence enders, but not inside "a.m."/"p.m." (abbreviation
# periods are followed by a lowercase word or comma, real sentence ends by
# a capitalized word).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

_COMMIT_RE = re.compile(
    r"\b(?:would you like to (?:book|order|reserve|purchase|subscribe to|sign up for|proceed|go ahead|move forward"
    r"|place (?:the |your )?(?:order|booking))"
    r"|(?:shall|should) i (?:go ahead and )?(?:book|place|confirm|reserve|complete|process)"
    r"|can i (?:go ahead|confirm your|complete (?:the|your))"
    r"|do you want to (?:place the order|move forward|go ahead|book)"
    r"|let(?:'?s| us) get you (?:signed up|booked)"
    r"|i(?:'?ll| will) go ahead and (?:book|process|place|complete)"
    r"|we (?:can|will) (?:get you booked|complete (?:the|your)))\b", re.IGNORECASE)

_CONSENT_RE = re.compile(
    r"^(?:yes\b|yeah\b|yep\b|sure\b|sounds good\b|please do\b|go ahead\b|that works\b|let'?s do it\b|"
    r"i'?ll take it\b|book it\b|sign me up\b|do it\b|perfect\b)"
    r"|^(?:ok\b|okay\b)[, ]+(?:book|do|go|sign|proceed|sounds)", re.IGNORECASE)
_CONSENT_NEG_RE = re.compile(r"^(?:no|nope|not yet|maybe later|let me think|i'?m not sure|hmm)\b", re.IGNORECASE)

_AMOUNT_RE = re.compile(
    r"\$[0-9][0-9,]*(?:\.[0-9]{2})?"
    r"|\b[0-9][0-9,]*(?:\.[0-9]{2})?\s+(?:dollars|usd)\b"
    r"|\btotal (?:of|comes to|is)\s+\$?[0-9][0-9,]*(?:\.[0-9]{2})?", re.IGNORECASE)

_RECURRING_RE = re.compile(
    r"\b(?:per (?:month|year|week|night|guest)|monthly|yearly|annual"
    r"|subscription|membership|renews?|auto[- ]?renew(?:al)?)\b", re.IGNORECASE)

_FEE_RE = re.compile(
    r"\b(?:fee|service charge|surcharge|shipping(?: (?:fee|charge|cost))?|handling"
    r"|tax(?:es)?|deposit|non[- ]refundable|cancellation (?:fee|window|policy)"
    r"|expires?|minimum (?:purchase|order|commitment|stay))\b", re.IGNORECASE)
_FEE_NEGATED_RE = re.compile(
    r"\bno (?:additional|extra|hidden) (?:fees?|charges?|costs?)\b"
    r"|\bfully refundable\b|\bfree cancellation\b|\bno cancellation fee\b", re.IGNORECASE)


def _norm_digits(text: str) -> str:
    return re.sub(r"[^0-9]", "", text)


# Last digit-run (with separators/decimals) inside an amount match, so
# "total is $45", "$45." and "45 dollars" all normalize to "45".
_AMOUNT_TOKEN_RE = re.compile(r"[0-9][0-9,]*(?:\.[0-9]{2})?")


def _norm_amount(text: str) -> str:
    tokens = _AMOUNT_TOKEN_RE.findall(text)
    return _norm_digits(tokens[-1]) if tokens else ""


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]


def _agent_turns(turns: list[dict[str, str]]) -> list[tuple[int, str]]:
    return [
        (i, str(t.get("text", "")).strip())
        for i, t in enumerate(turns)
        if str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES and str(t.get("text", "")).strip()
    ]


TRANSPARENT_OFFER_GOAL = (
    "You are placing a booking or order call. Before you ask for any "
    "commitment, state the offer block in full: the total price in dollars, "
    "the frequency if the charge is recurring (for example per month), any "
    "fees, taxes, deposits or key restrictions such as the cancellation "
    "window - or an explicit line that there are no additional fees. Only "
    "after that block is complete, ask exactly ONE commitment question, "
    "for example 'Would you like to book?'. After the commitment question, "
    "introduce no new amounts, fees, or conditions: if the person asks, "
    "answer, but never volunteer a charge they have not heard. If you "
    "cannot state the full price, say so and do not ask for the commitment "
    "yet."
)

CRAFT_SCENARIOS = {"transparent-offer"}

CRAFT_CHECKLIST = [
    "offer block before commitment",
    "single commitment question",
    "recurring frequency stated when applicable",
    "no new amounts after commitment",
]


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a transparent-offer outbound call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-total-cost-disclosure-auditor",
        "scenario": scenario,
        "language": language or "en",
        "goal_template": TRANSPARENT_OFFER_GOAL,
        "checklist": list(CRAFT_CHECKLIST),
    }


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the total-cost disclosure card from transcript turns."""
    agent_turns = _agent_turns(turns)
    all_agent_text = " ".join(text for _, text in agent_turns)

    # Step 1: first agent sentence that elicits a monetary commitment.
    elicitation: dict[str, Any] | None = None
    for index, text in agent_turns:
        for sentence in _sentences(text):
            if _COMMIT_RE.search(sentence):
                elicitation = {"turn_index": index, "snippet": mask_pii(sentence)[:160]}
                break
        if elicitation:
            break

    # Step 2: first callee turn after the elicitation whose FIRST sentence
    # consents (first sentence only; a leading negation token rejects it).
    consent_point: int | None = None
    if elicitation is not None:
        for i, t in enumerate(turns):
            if i <= elicitation["turn_index"]:
                continue
            text = str(t.get("text", "")).strip()
            if not text or str(t.get("speaker", "")).lower().strip() not in CALLEE_ROLES:
                continue
            first = _sentences(text)[0] if _sentences(text) else ""
            if first and _CONSENT_RE.search(first) and not _CONSENT_NEG_RE.search(first):
                consent_point = i
                break

    # Step 3: pre-consent region. Without consent, grade what was disclosed
    # before the offer itself (elicitation turn); without an elicitation at
    # all there is no boundary and every agent turn is in scope.
    if consent_point is not None:
        boundary = consent_point
    elif elicitation is not None:
        boundary = elicitation["turn_index"]
    else:
        boundary = len(turns)
    pre_text = " ".join(text for i, text in agent_turns if i < boundary)

    # Step 4: disclosure elements.
    amount_matches = list(_AMOUNT_RE.finditer(pre_text))
    amounts_pre_norm = {d for m in amount_matches if (d := _norm_amount(m.group(0)))}
    total_covered = bool(amount_matches)
    recurring_required = bool(_RECURRING_RE.search(all_agent_text))
    recurring_covered = bool(_RECURRING_RE.search(pre_text))
    fees_required = bool(_FEE_RE.search(all_agent_text) or _FEE_NEGATED_RE.search(all_agent_text))
    fees_covered = bool(_FEE_RE.search(pre_text) or _FEE_NEGATED_RE.search(pre_text))

    # Step 5: drip pricing - a fee or a new amount surfacing only after consent.
    drip: dict[str, Any] | None = None
    if consent_point is not None:
        post_turns = [(i, text) for i, text in agent_turns if i > consent_point]
        if not fees_covered:
            for index, text in post_turns:
                for sentence in _sentences(text):
                    if _FEE_RE.search(sentence):
                        drip = {"turn_index": index, "sentence": mask_pii(sentence)[:160], "kind": "fee_first_mentioned_post_consent"}
                        break
                if drip:
                    break
        if drip is None:
            for index, text in post_turns:
                for sentence in _sentences(text):
                    norms = {d for m in _AMOUNT_RE.finditer(sentence) if (d := _norm_amount(m.group(0)))}
                    if any(d not in amounts_pre_norm for d in norms):
                        drip = {"turn_index": index, "sentence": mask_pii(sentence)[:160], "kind": "new_amount_post_consent"}
                        break
                if drip:
                    break

    # Step 6: verdict priority.
    if elicitation is None:
        verdict = "NO_MONETARY_COMMITMENT"
        reason = "no monetary commitment elicitation detected in agent turns"
    elif drip is not None:
        verdict = "DRIP_PRICING_DETECTED"
        if drip["kind"] == "fee_first_mentioned_post_consent":
            reason = f"drip pricing: fee first mentioned after consent (turn {drip['turn_index']})"
        else:
            reason = f"drip pricing: new amount stated after consent (turn {drip['turn_index']})"
    elif not total_covered:
        verdict = "COMMITMENT_WITHOUT_AMOUNT"
        reason = "no total amount stated before consent"
    elif (recurring_required and not recurring_covered) or (fees_required and not fees_covered):
        verdict = "PARTIAL_DISCLOSURE"
        missing = []
        if recurring_required and not recurring_covered:
            missing.append("recurring terms")
        if fees_required and not fees_covered:
            missing.append("fees or restrictions")
        reason = "mentioned in the call but not before consent: " + " and ".join(missing)
    else:
        verdict = "FULL_DISCLOSURE_BEFORE_CONSENT"
        reason = "total amount and all required disclosure elements preceded consent"

    return {
        "verdict": verdict,
        "commitment_elicitation": elicitation,
        "consent_point": consent_point,
        "disclosures": {
            "total_amount": {"covered": total_covered},
            "recurring": {"required": recurring_required, "covered": recurring_covered},
            "fees_restrictions": {"required": fees_required, "covered": fees_covered},
        },
        "drip_evidence": drip,
        "reason": reason,
        "counts": {
            "agent_turns": len(agent_turns),
            "amounts_pre_consent": len(amount_matches),
            "fee_mentions_total": sum(len(_FEE_RE.findall(text)) for _, text in agent_turns),
        },
        "disclaimer": DISCLAIMER,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit cost-disclosure timing in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a transparent-offer goal for the next plan_call.")
    p_craft.add_argument("--scenario", required=True, help=f"One of {sorted(CRAFT_SCENARIOS)}.")
    p_craft.add_argument("--language", default=None, help="BCP-47 tag passed through to plan_call (default: en).")
    p_craft.add_argument("--out", default=None, help="Write the plan to this path (default: stdout).")

    args = parser.parse_args(argv)

    if args.command == "analyze":
        path = Path(args.transcript)
        if not path.is_file():
            print(f"ERROR: transcript file not found: {path}", file=sys.stderr)
            return 2
        try:
            data = load_call_result(path)
        except json.JSONDecodeError as exc:
            print(f"ERROR: invalid JSON in transcript file: {exc}", file=sys.stderr)
            return 2
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
        except OSError as exc:
            print(f"ERROR: cannot read transcript file: {exc}", file=sys.stderr)
            return 2
        payload = analyze_turns(data["turns"])
        if data.get("call_id"):
            payload = {"call_id": data["call_id"], **payload}
    else:
        try:
            payload = craft_goal(args.scenario, language=args.language)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2

    output = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(f"Written to {args.out}", file=sys.stderr)
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
