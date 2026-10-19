#!/usr/bin/env python3
"""call-arithmetic-accuracy-auditor - recompute the arithmetic an agent SPOKE.

Twin-mode heuristic skill:
  analyze  sentence-scoped audit of AGENT turns: for each spoken computation
           (quantity-times-price, line-item sums, percent-off results,
           balance-due subtraction, clock durations) recompute the result
           from the agent's own stated factors and compare it to the total
           the agent actually said
  craft    emit a factors-first goal template whose protocol instructs the
           agent to state quantities and unit prices before any total

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

AGENT_ROLES = {"agent", "assistant", "ai", "bot", "caller"}
CALLEE_ROLES = {"callee", "customer", "called_party", "recipient", "human"}

SKILL_NAME = "call-arithmetic-accuracy-auditor"

# Normalize typographic quotes to ASCII so the apostrophe-based patterns
# match real CALL-E ASR output, which emits U+2018/U+2019/U+201C/U+201D.
_SMART = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"'})

_DIGIT_RUN_RE = re.compile(r"[0-9](?:[ .,\-/][0-9]|[0-9])*")

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

REVIEW_ACTION_ERRORS = "recompute spoken totals in the goal template before deployment"
REVIEW_ACTION_UNVERIFIABLE = "state the factors aloud before the total so arithmetic can be verified"

AMOUNT = r"\$\d{1,6}(?:\.\d{2})?|\d{1,6}(?:\.\d{2})? (?:dollars?|bucks)"

TOTAL_CUE_RE = re.compile(
    r"comes? to|totals?|in total|altogether|that(?:'s| is)|makes?|adds? up to"
    r"|brings? (?:it|us) to|grand total|all-in",
    re.IGNORECASE,
)

# Amount tokens in priority order: $-prefixed, currency-word suffixed, bare.
_TOKEN_RE = re.compile(
    r"(?P<cur>\$\d{1,6}(?:\.\d{2})?)"
    r"|(?P<word>\d{1,6}(?:\.\d{2})? (?:dollars?|bucks))"
    # bare branch requires >= 2 digits: single-digit bare numbers are
    # quantities ("3 nights"), not spoken amounts
    r"|(?P<bare>\d{2,6}(?:\.\d{2})?)",
    re.IGNORECASE,
)

_CONNECTOR_RE = re.compile(r"^\s*,?\s*(?:and|plus|\+)\s*$")

# Countable-noun whitelist (plural and singular forms). Nouns outside this
# set are NOT a multiply match at all - this deliberately avoids false
# positives like "5 parking spots at the mall and 25 total".
COUNTABLE_NOUNS = {
    "nights", "night", "rooms", "room", "tickets", "ticket", "seats", "seat",
    "guests", "guest", "people", "adults", "adult", "children", "child",
    "kids", "kid", "hours", "hour", "days", "day", "weeks", "week",
    "months", "month", "boxes", "box", "bags", "bag", "pizzas", "pizza",
    "items", "item", "units", "unit", "visits", "visit", "sessions",
    "session", "plates", "plate", "meals", "meal", "coupons", "coupon",
    "passes", "pass",
}

_QTY_NOUN_RE = re.compile(r"\b(\d{1,3}) ([a-z]+)\b", re.IGNORECASE)

_UNIT_RE = re.compile(
    r"(?:at|for) (" + AMOUNT + r")(?: each| per [a-z]+| apiece)?",
    re.IGNORECASE,
)

_PERCENT_RE = re.compile(r"(\d{1,3}) ?% off(?: of)?|(\d{1,3}) percent off(?: of)?", re.IGNORECASE)

# percent_off-only result fallback: a bare "is"/"so" right before the result
# amount. Deliberately NOT in the global total-cue list used by add/multiply.
_PERCENT_RESULT_FALLBACK_RE = re.compile(r"\b(?:is|so) (" + AMOUNT + r")", re.IGNORECASE)

_DEPOSIT_RE = re.compile(
    r"(?:deposit|down payment|already paid|paid)\D{0,10}(" + AMOUNT + r")",
    re.IGNORECASE,
)

_BALANCE_CUE_RE = re.compile(r"\b(?:balance|remaining|remains|rest|amount due|due)\b", re.IGNORECASE)

_DURATION_RE = re.compile(
    r"from (\d{1,2})(?::(\d{2}))? ?(a\.m\.|p\.m\.|am|pm)?"
    r" to (\d{1,2})(?::(\d{2}))? ?(a\.m\.|p\.m\.|am|pm)?",
    re.IGNORECASE,
)

_HOURS_RE = re.compile(r"(?:that(?:'s| is)|so) (\d+(?:\.\d+)?) hours", re.IGNORECASE)

TOLERANCE = 0.005


def mask_pii(text: str) -> str:
    """Mask any run of >= 7 digits (single separators glue the run).

    The whole run is replaced by one star per masked digit, keeping only the
    last 2 digits. Short runs (times, prices) pass through untouched.
    """

    def _mask(m: re.Match[str]) -> str:
        run = m.group(0)
        digit_count = sum(1 for ch in run if ch.isdigit())
        if digit_count < 7:
            return run
        return "*" * (digit_count - 2) + run[-2:]

    return _DIGIT_RUN_RE.sub(_mask, text)


def _normalize(text: str) -> str:
    return text.translate(_SMART)


def _load_turns(payload: Any) -> list[dict[str, str]]:
    """Normalize a call-result payload (wrapped dict, bare dict, or list) to turns."""
    if isinstance(payload, dict):
        result = payload.get("result")
        raw = result.get("transcript") if isinstance(result, dict) else None
        if raw is None:
            raw = payload.get("transcript")
    else:
        raw = payload
    if not isinstance(raw, list):
        return []
    turns = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = item.get("role", item.get("speaker", ""))
        text = item.get("text", item.get("content"))
        turns.append({"role": str(role if role is not None else ""), "text": str(text if text is not None else "")})
    return turns


def _extract_call_id(payload: Any) -> Any:
    if isinstance(payload, dict):
        if payload.get("call_id") is not None:
            return payload["call_id"]
        result = payload.get("result")
        if isinstance(result, dict) and result.get("call_id") is not None:
            return result["call_id"]
    return None


def _tokens(sentence: str) -> list[dict[str, Any]]:
    """Scan number tokens ($-prefixed, currency-word, bare) with positions."""
    out: list[dict[str, Any]] = []
    for m in _TOKEN_RE.finditer(sentence):
        if m.group("cur") is not None:
            value, kind = float(m.group("cur").lstrip("$")), "cur"
        elif m.group("word") is not None:
            value, kind = float(m.group("word").split()[0]), "word"
        else:
            value, kind = float(m.group("bare")), "bare"
        out.append({"start": m.start(), "end": m.end(), "value": value, "kind": kind})
    return out


def _chains(tokens: list[dict[str, Any]], sentence: str) -> list[list[dict[str, Any]]]:
    """Group tokens into maximal chains joined only by and/plus/+."""
    chains: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for tok in tokens:
        if current and _CONNECTOR_RE.match(sentence[current[-1]["end"]:tok["start"]]):
            current.append(tok)
        else:
            if len(current) >= 2:
                chains.append(current)
            current = [tok]
    if len(current) >= 2:
        chains.append(current)
    return chains


def _result_after_cue(tokens: list[dict[str, Any]], sentence: str) -> dict[str, Any] | None:
    """The result amount: first token after the LAST total cue that has one.

    The last cue wins because openers like "That is 2 sessions ..." place a
    cue before the factors, while the spoken total follows the final cue.
    """
    chosen: dict[str, Any] | None = None
    for cue in TOTAL_CUE_RE.finditer(sentence):
        for tok in tokens:
            if tok["start"] >= cue.end():
                chosen = tok
                break
    return chosen


def _amt_status(stated: float, computed: float) -> tuple[str, float | None]:
    if abs(computed - stated) < TOLERANCE:
        return "CORRECT", None
    return "INCORRECT", round(stated - computed, 2)


def _detect_multiply(sentence: str, result: dict[str, Any] | None) -> dict[str, Any] | None:
    if result is None:
        return None
    for m in _QTY_NOUN_RE.finditer(sentence):
        noun = m.group(2).lower()
        if noun not in COUNTABLE_NOUNS:
            continue
        unit_match = _UNIT_RE.search(sentence[m.end():])
        factors: dict[str, Any] = {"qty": int(m.group(1))}
        if unit_match is None:
            return {"factors": factors, "computed": None}
        unit = float(unit_match.group(1).lstrip("$").split()[0])
        factors["unit_price"] = unit
        return {"factors": factors, "computed": round(factors["qty"] * unit, 2)}
    return None


def _detect_percent(sentence: str, tokens: list[dict[str, Any]], result: dict[str, Any] | None) -> dict[str, Any] | None:
    pm = _PERCENT_RE.search(sentence)
    if pm is None:
        return None
    if result is None:
        # percent_off-only result cue: bare "is"/"so" before the result amount
        fm = _PERCENT_RESULT_FALLBACK_RE.search(sentence, pm.end())
        if fm is None:
            return None
        pos = fm.start(1)
        result = next((t for t in tokens if t["start"] == pos), None)
        if result is None:
            return None
    pct = int(pm.group(1) or pm.group(2))
    stated = result["value"]
    base = next(
        (
            t for t in tokens
            if t["kind"] in ("cur", "word") and t["start"] >= pm.end() and t is not result
        ),
        None,
    )
    if base is None:
        # a bare amount may be the only base ("10% off of 90 is 81 dollars")
        base = next(
            (
                t for t in tokens
                if t["kind"] == "bare" and t["start"] >= pm.end() and t is not result
            ),
            None,
        )
    if base is None:
        return {"factors": {"percent": pct}, "computed": None, "stated": stated}
    computed = round(base["value"] * (1 - pct / 100), 2)
    return {"factors": {"base": base["value"], "percent": pct}, "computed": computed, "stated": stated}


def _detect_subtract(sentence: str, tokens: list[dict[str, Any]], result: dict[str, Any] | None) -> dict[str, Any] | None:
    dm = _DEPOSIT_RE.search(sentence)
    if dm is None or result is None or _BALANCE_CUE_RE.search(sentence) is None:
        return None
    # The stated balance (the token after the balance cue) is the result the
    # agent actually spoke; the generic total cue points at the base instead.
    balance = next(
        (t for t in tokens if t["start"] >= _BALANCE_CUE_RE.search(sentence).end()),
        None,
    )
    if balance is not None:
        result = balance
    deposit = float(dm.group(1).lstrip("$").split()[0])
    deposit_start = dm.start(1)
    base = next(
        (
            t for t in tokens
            if t["kind"] in ("cur", "word") and t["start"] != deposit_start and t is not result
        ),
        None,
    )
    if base is None:
        return {"factors": {"deposit": deposit}, "computed": None, "stated": result["value"]}
    return {
        "factors": {"base": base["value"], "deposit": deposit},
        "computed": round(base["value"] - deposit, 2),
        "stated": result["value"],
    }


def _clock_24(hour: str, minute: str | None, meridiem: str | None) -> float | None:
    """24-hour clock position as a float so minutes count toward durations."""
    if meridiem is None:
        return None
    h = int(hour)
    mins = int(minute) if minute else 0
    m = meridiem.lower().replace(".", "")
    if h == 12:
        base = 0 if m == "am" else 12
    else:
        base = h + 12 if m == "pm" else h
    return base + mins / 60


def _detect_duration(sentence: str) -> dict[str, Any] | None:
    dm = _DURATION_RE.search(sentence)
    if dm is None:
        return None
    hm = _HOURS_RE.search(sentence)
    if hm is None:
        return None
    stated = float(hm.group(1))
    start_label = dm.group(1) + (":" + dm.group(2) if dm.group(2) else "")
    end_label = dm.group(4) + (":" + dm.group(5) if dm.group(5) else "")
    if dm.group(3):
        start_label += " " + dm.group(3)
    if dm.group(6):
        end_label += " " + dm.group(6)
    start24 = _clock_24(dm.group(1), dm.group(2), dm.group(3))
    end24 = _clock_24(dm.group(4), dm.group(5), dm.group(6))
    if start24 is None or end24 is None:
        return {
            "factors": {"start": start_label, "end": end_label},
            "computed": None,
            "stated": stated,
            "reason": "AMBIGUOUS_CLOCK",
        }
    diff = end24 - start24
    if diff <= 0:
        diff += 12
    return {
        "factors": {"start": start_label, "end": end_label},
        "computed": round(float(diff), 2),
        "stated": stated,
        "reason": None,
    }


def _comp(
    turn_index: int,
    sentence: str,
    kind: str,
    factors: dict[str, Any],
    stated: float | None,
    computed: float | None,
    reason: str | None = None,
) -> dict[str, Any]:
    if reason is not None or computed is None:
        return {
            "turn_index": turn_index,
            "kind": kind,
            "sentence": mask_pii(sentence),
            "factors": factors,
            "stated_result": stated,
            "computed_result": None,
            "delta": None,
            "status": "UNVERIFIABLE",
            "reason": reason or "FACTORS_MISSING",
        }
    status, delta = _amt_status(stated, computed)
    return {
        "turn_index": turn_index,
        "kind": kind,
        "sentence": mask_pii(sentence),
        "factors": factors,
        "stated_result": stated,
        "computed_result": computed,
        "delta": delta,
        "status": status,
        "reason": None,
    }


def _evaluate_sentence(sentence: str, turn_index: int) -> list[dict[str, Any]]:
    # Matching runs on a pre-masked copy so long digit runs (phone/card PII)
    # never tokenize as amount operands; the raw sentence is kept for display
    # (mask_pii is idempotent, so the report masks it exactly once).
    match_text = mask_pii(sentence)
    # Duration is evaluated first and exclusively: spoken clock factors like
    # "3 hours" would otherwise double-fire as a multiply structure.
    dur = _detect_duration(match_text)
    if dur is not None:
        return [_comp(
            turn_index, sentence, "duration", dur["factors"],
            dur["stated"], dur["computed"], dur["reason"],
        )]

    tokens = _tokens(match_text)
    if not tokens:
        return []
    result = _result_after_cue(tokens, match_text)
    comps: list[dict[str, Any]] = []

    mult = _detect_multiply(match_text, result)
    if mult is not None:
        comps.append(_comp(
            turn_index, sentence, "multiply", mult["factors"],
            result["value"], mult["computed"],
        ))

    pct = _detect_percent(match_text, tokens, result)
    if pct is not None:
        comps.append(_comp(
            turn_index, sentence, "percent_off", pct["factors"],
            pct["stated"], pct["computed"],
        ))

    sub = _detect_subtract(match_text, tokens, result)
    if sub is not None:
        comps.append(_comp(
            turn_index, sentence, "subtract", sub["factors"],
            sub["stated"], sub["computed"],
        ))

    # Add is evaluated only when no other kind matched the sentence, so the
    # factor numbers of multiply/percent/subtract/duration are never mistaken
    # for add operands.
    if not comps and result is not None:
        chain = None
        for candidate in _chains(tokens, match_text):
            before = [t for t in candidate if t["start"] < result["start"]]
            if len(before) >= 2:
                chain = before
                break
        if chain is not None:
            operands = [t["value"] for t in chain]
            comps.append(_comp(
                turn_index, sentence, "add", {"operands": operands},
                result["value"], round(sum(operands), 2),
            ))
        else:
            leading = [t["value"] for t in tokens if t["start"] < result["start"]]
            if leading:
                comps.append(_comp(
                    turn_index, sentence, "add", {"operands": leading},
                    result["value"], None,
                ))
            else:
                # total cue + result but zero operand tokens: classify as a
                # bare total, not an add with empty operands
                comps.append(_comp(
                    turn_index, sentence, "total_only", {},
                    result["value"], None,
                ))
    return comps


def analyze_turns(turns: list, call_id: Any = None) -> dict[str, Any]:
    """Audit AGENT turns for spoken arithmetic against stated factors."""
    computations: list[dict[str, Any]] = []
    for idx, turn in enumerate(turns):
        if not isinstance(turn, dict):
            continue
        role = turn.get("role", "").lower()
        if role not in AGENT_ROLES:
            continue
        text = _normalize(str(turn.get("text", "")))
        if not text.strip():
            continue
        for sentence in _SENTENCE_SPLIT_RE.split(text):
            computations.extend(_evaluate_sentence(sentence, idx))

    detected = len(computations)
    correct = sum(1 for c in computations if c["status"] == "CORRECT")
    incorrect = sum(1 for c in computations if c["status"] == "INCORRECT")
    unverifiable = sum(1 for c in computations if c["status"] == "UNVERIFIABLE")

    if incorrect:
        verdict = "ARITHMETIC_ERRORS_FOUND"
        review_action = REVIEW_ACTION_ERRORS
    elif detected and correct == detected:
        verdict = "ALL_COMPUTATIONS_CORRECT"
        review_action = "none"
    elif detected:
        verdict = "UNVERIFIABLE_COMPUTATIONS_ONLY"
        review_action = REVIEW_ACTION_UNVERIFIABLE
    else:
        verdict = "NO_SPOKEN_COMPUTATIONS"
        review_action = "none"

    return {
        "skill": SKILL_NAME,
        "mode": "analyze",
        "call_id": mask_pii(str(call_id)) if call_id else None,
        "verdict": verdict,
        "computations": computations,
        "counts": {
            "detected": detected,
            "correct": correct,
            "incorrect": incorrect,
            "unverifiable": unverifiable,
        },
        "review_action": review_action,
    }


def analyze_payload(payload: Any) -> dict[str, Any]:
    """Analyze a loaded call-result payload (dict with transcript or bare list)."""
    return analyze_turns(_load_turns(payload), call_id=_extract_call_id(payload))


def craft_goal(number: str, business_name: str = "the business", task: str = "confirm the order total", language: str = "en-US") -> dict[str, Any]:
    """Emit a factors-first goal template for plan_call."""
    return {
        "goal_template": {
            "name": "arithmetic-accurate business call",
            "description": f"{business_name}: {task} - with factors-first arithmetic protocol",
            "language": language,
            "to": number,
            "protocol": (
                "Arithmetic protocol: state the quantities and unit prices "
                "aloud BEFORE any total; compute the total yourself before "
                "speaking it; read every total digit by digit (for example, "
                "three six zero dollars); if you are unsure of a total, state "
                "the line items separately and offer to confirm the sum in "
                "writing; never round a total up."
            ),
            "safety": "Fictional testing only. This template is not a pricing or billing system.",
        }
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog=SKILL_NAME, description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_craft = sub.add_parser("craft", help="Emit a factors-first goal template for plan_call.")
    p_craft.add_argument("--number", required=True, help="E.164 number to call (reserved NANP 555-01XX range, any area code (e.g. +14155550135)).")
    p_craft.add_argument("--business-name", default="the business")
    p_craft.add_argument("--task", default="confirm the order total")
    p_craft.add_argument("--language", default="en-US")
    p_craft.add_argument("--json", action="store_true", help="Print JSON (the default output).")

    p_analyze = sub.add_parser("analyze", help="Audit a CALL-E call result JSON for spoken arithmetic accuracy.")
    p_analyze.add_argument("--call-result", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--json", action="store_true", help="Print JSON (the default output).")

    args = parser.parse_args(argv)

    if args.command == "craft":
        if not re.fullmatch(r"\+1[0-9]{3}55501[0-9]{2}", args.number):
            print(
                f"ERROR: --number must be a reserved test number matching "
                f"+1[0-9]{{3}}55501[0-9]{{2}} (e.g. +14155550135), got: {args.number}",
                file=sys.stderr,
            )
            return 2
        payload = craft_goal(
            args.number,
            business_name=args.business_name,
            task=args.task,
            language=args.language,
        )
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    path = Path(args.call_result)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        print(f"ERROR: cannot read call result file: {exc}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in call result file: {exc}", file=sys.stderr)
        return 2
    if not isinstance(data, (dict, list)):
        print(
            f"ERROR: call result must be a JSON object or array, got {type(data).__name__}",
            file=sys.stderr,
        )
        return 2
    print(json.dumps(analyze_payload(data), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
