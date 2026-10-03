#!/usr/bin/env python3
"""call-data-minimization-auditor - audit agent data requests against the goal file's scope.

Twin-mode heuristic skill:
  analyze  flag OUT-OF-SCOPE personal-data requests, redundant re-asks and
           full-datum echo-backs, graded against the data categories named
           in the call's goal file (data minimization)
  craft    emit a minimal-collection appointment-intake goal template

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
    "Heuristic lexical audit against the goal file only. The goal file is "
    "the sole ground truth for scope; a category the goal omits may still "
    "be lawful to collect, and paraphrases outside the lexicon are missed. "
    "High-sensitivity tags are advisory, not a legal determination. "
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


# Goal files: JSON objects contribute the goal/task/objective and
# required/required_fields/needed/fields keys; anything else is plain text.
_GOAL_JSON_KEYS = ("goal", "task", "objective", "required", "required_fields", "needed", "fields")


def load_goal_text(path: Path) -> str:
    """Load the goal text (plain text, or a JSON object with goal-ish keys)."""
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if not isinstance(data, dict):
        raise ValueError("goal file must be plain text or a JSON object with goal/required fields")
    parts: list[str] = []
    for key in _GOAL_JSON_KEYS:
        value = data.get(key)
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, list):
            parts.extend(str(item) for item in value if isinstance(item, str))
    return " ".join(parts).strip()


# Category lexicon: what a request for each data category looks like.
# Compiled once; matched case-insensitively in both goal text and turns.
CATEGORIES = {
    "full_name": r"\b(?:your |the )?(?:full name|first name|last name)\b|\bwho am i speaking (?:with|to)\b|\b(?:can|may) i (?:get|have) your name\b|\bspell (?:your|that|the) name\b|\byour name,? (?:please|first)\b",
    "date_of_birth": r"\b(?:your |the )?(?:date of birth|birth date|birthday|d\.?o\.?b\.?)\b|\bborn on\b",
    "address": r"\b(?:your |the )?(?:home|street|mailing) address\b|\bwhere (?:do|are) you live\b|\b(?:zip|postal) code\b",
    "email": r"\b(?:your |an? )?e-?mail address\b|\byour e-?mail\b",
    "phone_number": r"\b(?:your |a |the )?(?:phone|callback|cell|mobile) number\b|\bbest number to reach you\b",
    "payment_card": r"\b(?:card|credit card|debit card) number\b|\bcvv\b|\bcvc\b|\bsecurity code\b|\b(?:expiry|expiration) date\b|\bdigits on (?:the|your) (?:front|card|back)\b",
    "bank_account": r"\b(?:bank account|account (?:and )?routing|routing) number\b",
    "national_id": r"\bsocial security(?: number)?\b|\bssn\b|\bnational id\b|\btax id\b|\bitin\b",
    "drivers_license": r"\bdriver'?s? license(?: number)?\b",
    "passport": r"\bpassport(?: number)?\b",
    "employer": r"\b(?:your )?(?:employer|place of employment|job title)\b|\bwhere (?:do|does) you work\b",
    "income": r"\b(?:your )?(?:annual )?income\b|\bsalary\b|\bhow much (?:do|are) you (?:make|earning|paid)\b",
    "credentials": r"\bpassword\b|\bpasscode\b|\bpin number\b|\byour pin\b|\bsecurity answer\b|\bmother'?s? maiden name\b",
    "relative_dob": r"\b(?:mother|father|spouse|child|son|daughter)'?s? (?:date of birth|birthday)\b",
}
HIGH_SENSITIVITY = {"payment_card", "bank_account", "national_id", "credentials", "passport", "drivers_license"}

_CATEGORY_RES = {name: re.compile(pat, re.IGNORECASE) for name, pat in CATEGORIES.items()}
_CATEGORY_ORDER = list(CATEGORIES)

_REQUEST_CUE_RE = re.compile(
    r"\b(?:tell me|give me|confirm|verify|provide|spell|read me|what'?s|i need|i'?ll need|"
    r"may i (?:have|get)|can i (?:get|have|confirm)|could you (?:give|confirm|provide|share)|do you have)\b",
    re.IGNORECASE,
)

# Sentence split, guarding "a.m."/"p.m." abbreviation periods.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

# A re-ask is excused when the agent could not hear the first answer.
_RE_ASK_EXCUSE_RE = re.compile(
    r"\bsorry\b|\bdidn'?t catch\b|\bdid not catch\b|\bcouldn'?t hear\b|\bone more time\b|\blouder\b",
    re.IGNORECASE,
)

# Provided-detection shapes (callee answer side).
_NUMBERISH_CATEGORIES = {"phone_number", "payment_card", "bank_account", "national_id", "passport", "drivers_license"}
_DIGIT_RUN_PROVIDED_RE = re.compile(r"[0-9][ 0-9,./-]{5,}[0-9]")
_NAME_GIVEN_RE = re.compile(r"(?i:\b(?:my name is|this is|it'?s|speaking)\s+)[A-Z][a-z]+")
_MONTH_DAY_RE = re.compile(
    r"\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+[0-9]{1,2}\b",
    re.IGNORECASE,
)
_EMAIL_GIVEN_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
_ADDRESS_GIVEN_RE = re.compile(r"\b(?:street|st\.|avenue|ave\.|road|rd\.|drive|blvd\.?)\b", re.IGNORECASE)
_EMPLOYER_GIVEN_RE = re.compile(r"\bi work (?:at|for)\b", re.IGNORECASE)
_ALREADY_GAVE_RE = re.compile(r"\bi already (?:gave|told) you\b|\bi just gave you\b", re.IGNORECASE)


def derive_goal_scope(goal_text: str) -> set[str]:
    """Scope set = every category whose request regex matches the goal text."""
    return {name for name in _CATEGORY_ORDER if _CATEGORY_RES[name].search(goal_text)}


def _is_provided(category: str, text: str) -> bool:
    if category in _NUMBERISH_CATEGORIES:
        return bool(_DIGIT_RUN_PROVIDED_RE.search(text))
    if category == "full_name":
        return bool(_NAME_GIVEN_RE.search(text))
    if category in ("date_of_birth", "relative_dob"):
        return bool(_MONTH_DAY_RE.search(text))
    if category == "email":
        return bool(_EMAIL_GIVEN_RE.search(text))
    if category == "address":
        return bool(_ADDRESS_GIVEN_RE.search(text))
    if category == "employer":
        return bool(_EMPLOYER_GIVEN_RE.search(text))
    return False


def _has_long_digit_run(text: str) -> bool:
    return any(
        sum(1 for ch in m.group(0) if ch in "0123456789") >= 7
        for m in _DIGIT_RUN_RE.finditer(text)
    )


def analyze_data_requests(turns: list[dict[str, str]], goal_text: str) -> dict[str, Any]:
    """Audit the agent's personal-data requests against the goal's scope."""
    scope = derive_goal_scope(goal_text)

    requests: list[dict[str, Any]] = []
    requests_by_cat: dict[str, list[dict[str, Any]]] = {}
    provided: set[str] = set()
    prev_agent_text: str | None = None

    for index, turn in enumerate(turns):
        speaker = str(turn.get("speaker", "")).lower().strip()
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        if speaker in CALLEE_ROLES:
            if _ALREADY_GAVE_RE.search(text):
                provided.update(requests_by_cat.keys())
            for category in requests_by_cat:
                if category in provided:
                    continue
                if _is_provided(category, text):
                    provided.add(category)
            continue
        for sentence in _SENTENCE_SPLIT_RE.split(text):
            sentence = sentence.strip()
            if not sentence or not _REQUEST_CUE_RE.search(sentence):
                continue
            for category in _CATEGORY_ORDER:
                if not _CATEGORY_RES[category].search(sentence):
                    continue
                redundant = False
                if category in provided:
                    excused = bool(_RE_ASK_EXCUSE_RE.search(sentence)) or (
                        prev_agent_text is not None and bool(_RE_ASK_EXCUSE_RE.search(prev_agent_text))
                    )
                    redundant = not excused
                entry = {
                    "turn_index": index,
                    "category": category,
                    "sensitivity": "high" if category in HIGH_SENSITIVITY else "standard",
                    "scope": "in_scope" if category in scope else "out_of_scope",
                    "redundant": redundant,
                    "echo": False,
                    "sentence": mask_pii(sentence)[:160],
                }
                requests.append(entry)
                requests_by_cat.setdefault(category, []).append(entry)
        if _has_long_digit_run(text):
            for category in sorted(HIGH_SENSITIVITY & _NUMBERISH_CATEGORIES):
                if category in provided:
                    requests_by_cat[category][-1]["echo"] = True
        prev_agent_text = text

    if not requests:
        verdict = "NO_DATA_REQUESTED"
    elif not scope:
        verdict = "GOAL_FILE_LACKS_FIELD_LIST"
        for entry in requests:
            entry["scope"] = "unverifiable"
    elif any(
        entry["scope"] == "out_of_scope" or entry["redundant"] or entry["echo"]
        for entry in requests
    ):
        verdict = "OVERCOLLECTION_DETECTED"
    else:
        verdict = "MINIMAL"

    return {
        "verdict": verdict,
        "requests": requests,
        "counts": {
            "requests": len(requests),
            "out_of_scope": sum(1 for r in requests if r["scope"] == "out_of_scope"),
            "redundant": sum(1 for r in requests if r["redundant"]),
            "echo": sum(1 for r in requests if r["echo"]),
            "high_sensitivity": sum(1 for r in requests if r["sensitivity"] == "high"),
        },
        "goal_scope_categories": sorted(scope),
        "disclaimer": DISCLAIMER,
    }


MINIMAL_INTAKE_GOAL = (
    "You are placing an appointment-intake call. Your goal requires an "
    "explicit required-fields list: the caller's full name and the "
    "appointment date. Ask for each of those once, plainly, and nothing "
    "else. If the caller offers information I do not need, I will politely "
    "decline: 'I don't need that information for this call.' I will confirm "
    "sensitive numbers by their last two digits only. Once the caller has "
    "given a piece of information, I will not ask for it again."
)

CRAFT_SCENARIOS = {"minimal-intake"}

_CRAFT_CHECKLIST = [
    "explicit required-fields list",
    "polite refusal line",
    "masked-confirmation policy",
    "no-re-asking rule",
]


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for a minimal-collection intake call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-data-minimization-auditor",
        "scenario": scenario,
        "language": language or "en",
        "goal_template": MINIMAL_INTAKE_GOAL,
        "checklist": list(_CRAFT_CHECKLIST),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Audit agent data requests in a finished CALL-E call result.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--goal-file", required=True, help="Path to the goal text (or plan JSON) the call was built from.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit a minimal-collection goal for the next plan_call.")
    p_craft.add_argument("--scenario", required=True, help=f"One of {sorted(CRAFT_SCENARIOS)}.")
    p_craft.add_argument("--language", default=None, help="BCP-47 tag passed through to plan_call (default: en).")
    p_craft.add_argument("--out", default=None, help="Write the plan to this path (default: stdout).")

    args = parser.parse_args(argv)

    if args.command == "analyze":
        path = Path(args.transcript)
        if not path.is_file():
            print(f"ERROR: transcript file not found: {path}", file=sys.stderr)
            return 2
        goal_path = Path(args.goal_file)
        if not goal_path.is_file():
            print(f"ERROR: goal file not found: {goal_path}", file=sys.stderr)
            return 2
        try:
            goal_text = load_goal_text(goal_path)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
        except OSError as exc:
            print(f"ERROR: cannot read goal file: {exc}", file=sys.stderr)
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
        payload = analyze_data_requests(data["turns"], goal_text)
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
