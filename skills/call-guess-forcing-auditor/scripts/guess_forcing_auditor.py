#!/usr/bin/env python3
"""call-guess-forcing-auditor - audit transcripts for guess-forcing sequences.

Twin-mode heuristic skill:
  analyze  detect the uncertainty-then-pressure-then-yield sequence in which
           an agent presses an unsure callee into a hedged guess and then
           consolidates that guess as firm fact (Gudjonsson Yield/Shift)
  craft    emit an open-questioning goal template that never presses for
           guesses and preserves qualifiers

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

CALLEE_ROLES = {"callee", "customer", "called_party", "recipient", "human"}
AGENT_ROLES = {"agent", "assistant", "ai", "bot", "caller"}

SKILL_NAME = "call-guess-forcing-auditor"

DISCLAIMER = (
    "Heuristic text-only analysis of elicitation pressure. Findings grade the "
    "conversation, not the callee's memory or honesty; every verdict routes "
    "to human review, never to automated conclusions about either party."
)

# Normalize typographic quotes to ASCII so the apostrophe-based patterns
# match real ASR output, which frequently emits U+2018/U+2019/U+201C/U+201D.
_SMART = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"'})

_DIGIT_RUN_RE = re.compile(r"[0-9](?:[ .,\-/][0-9]|[0-9])*")


def mask_pii(text: str) -> str:
    """Mask any run of >= 7 digits (single separators glue the run).

    The whole run is replaced by one star per masked digit, keeping only the
    last 2 digits. Short runs (times, small counts) pass through untouched.
    A leading '+' is not part of the run, so it is preserved.
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


# Split on sentence enders, but not inside "a.m."/"p.m." (abbreviation
# periods are followed by a lowercase word or comma, real sentence ends by
# a capitalized word).
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")

_WH_START_RE = re.compile(r"^(?:who|what|when|where|why|how|which)\b", re.IGNORECASE)

# 1. Callee expresses uncertainty. Guarded against questions elsewhere.
_UNCERTAINTY_RE = re.compile(
    r"(?:not sure|do(?:n't| not) know|no idea|can(?:'t|not) remember"
    r"|not certain|i(?:'m| am) unsure|we(?:'re| are) unsure"
    r"|hard to say|couldn(?:'t| not) say)",
    re.IGNORECASE,
)

# 2a. Explicit pressure lexicon (best guess, ballpark, ...).
_PRESSURE_LEXICON_RE = re.compile(
    r"(?:best guess|take (?:a |your )?guess|just roughly"
    r"|roughly (?:what|when|how)|ballpark|approximately (?:what|when|how)"
    r"|around what|give me (?:a |an )?(?:rough )?(?:number|estimate|time|date)"
    r"|even approximately|something like)",
    re.IGNORECASE,
)

# 2b. Wh re-ask after uncertainty (repeating the question is pressure).
_WH_RE_ASK_RE = re.compile(
    r"(?:what time|how many|how much|which day|when (?:would|will|could))",
    re.IGNORECASE,
)

# Explicit guess-invitation upgrades a bare number into a pressured answer.
_GUESS_INVITATION_RE = re.compile(r"(?:best guess|take .*guess)", re.IGNORECASE)

# Hedging vocabulary for yields and (negated) consolidations.
_HEDGE_RE = re.compile(
    r"(?:maybe|around|about|probably|perhaps|or so|i think|i guess|sort of|roughly)",
    re.IGNORECASE,
)

# Tentative markers keep a consolidation hedge-preserving even without a
# classic hedge word.
_TENTATIVE_RE = re.compile(
    r"(?:tentative|to be confirmed|mark (?:it|that) as"
    r"|we can confirm (?:later|tomorrow))",
    re.IGNORECASE,
)

# Consolidation confirm cues (agent records the value).
_CONFIRM_CUE_RE = re.compile(
    r"(?:got it|noted|perfect|great|booked|locked(?: in)?|all set|confirmed"
    r"|i(?:'ll| will) put|put (?:you|that) down|so that(?:'s| is))",
    re.IGNORECASE,
)

# Negative feedback that can trigger a Shift (advisory only).
_NEGATIVE_FEEDBACK_RE = re.compile(
    r"(?:no, that(?:'s| is) not right|are you sure"
    r"|that does(?:n't| not) sound right|are you certain)",
    re.IGNORECASE,
)

_NUMBER_TOKEN_RE = re.compile(r"\d+")

# Time continuation like "7:30" (or "9:45:12") is a DIFFERENT value than the
# bare number; a yield value must not bind inside it.
_TIME_CONTINUATION_RE = re.compile(r"\d+:\d+(?::\d+)*")


def _matches_yield_value(value: str, sentence: str) -> bool:
    """Match the yield value token unless it only appears inside a time continuation."""
    for m in re.finditer(rf"\b{re.escape(value)}\b", sentence):
        before = sentence[: m.start()].rstrip()
        after = sentence[m.end() :].lstrip()
        if after.startswith(":") or before.endswith(":"):
            continue
        return True
    return False

# Bind window: pressure/yield/consolidation attach only within i+1..i+2
# turns of their trigger. This is a policy choice, not a cognitive claim.
_WINDOW = 2

REVIEW_ACTION_UNMITIGATED = (
    "rewrite the goal template: never press for guesses; repeat uncertain "
    "values back with their qualifier and mark them tentative"
)
REVIEW_ACTION_NO_YIELD = "remove guess-invitation phrasing from the goal template"


# Inline string transcripts ("[MM:SS] BOT: ...") observed against the live
# get_call_run endpoint: optional [HH:]MM:SS timestamp prefix (ignored),
# speaker label before the first colon, remainder is the turn text.
_STRING_LINE_RE = re.compile(
    r"^\s*(?:\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*)?([A-Za-z_ ]+?)\s*:\s*(.*)$"
)

_AGENT_LABEL_TOKENS = {"BOT", "AI", "AGENT", "ASSISTANT", "SYSTEM", "CALLER", "AUTOMATED"}
_CALLEE_LABEL_TOKENS = {"USER", "CALLEE", "HUMAN", "CUSTOMER", "RECIPIENT", "CALLED", "PARTY"}


def _string_line_role(label: str) -> str | None:
    tokens = set(label.upper().replace("_", " ").split())
    if tokens & _AGENT_LABEL_TOKENS:
        return "agent"
    if tokens & _CALLEE_LABEL_TOKENS:
        return "callee"
    return None


def _parse_string_transcript(raw: str) -> list[dict[str, str]]:
    """Parse an inline string transcript into the {role, text} turn dicts.

    Unknown speaker labels and label-less wrapped lines are treated as
    continuations of the previous turn; timestamps never enter the text.
    """
    turns: list[dict[str, str]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        m = _STRING_LINE_RE.match(line)
        if m is None:
            if turns:
                turns[-1]["text"] += " " + line.strip()
            continue
        role = _string_line_role(m.group(4))
        text = m.group(5).strip()
        if role is None:
            if turns and text:
                turns[-1]["text"] += " " + text
            continue
        turns.append({"role": role, "text": text})
    return turns


def _load_turns(payload: Any) -> tuple[list[dict[str, str]], Any, Any]:
    """Normalize a call-result payload to (turns, call_id, post_summary).

    Accepts the wrapped get_call_run shape, a bare dict with transcript,
    or a flat turn list. Non-dict entries and empty-text entries are skipped.
    """
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        result = None
    raw = None
    if isinstance(payload, dict):
        raw = (result or {}).get("transcript", payload.get("transcript"))
    else:
        raw = payload
    turns = []
    if isinstance(raw, str):
        turns = _parse_string_transcript(raw)
    elif isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            text = item.get("text", item.get("content"))
            if text is None or not str(text).strip():
                continue
            role = item.get("role", item.get("speaker", ""))
            turns.append({"role": str(role), "text": str(text)})
    call_id = None
    post_summary = None
    if isinstance(payload, dict):
        call_id = payload.get("call_id") or (result or {}).get("call_id")
        post_summary = payload.get("post_summary") or (result or {}).get("post_summary")
    return turns, call_id, post_summary


def _is_interrogative(sentence: str) -> bool:
    return "?" in sentence or bool(_WH_START_RE.match(sentence))


def _summary_carries_value(post_summary: Any, yield_values: list[str]) -> bool | None:
    """Advisory: does the post_summary restate a yield value without a hedge?

    True when some yield value appears with no hedge marker within 30
    characters; False when every appearance carries a hedge (or the value
    is absent); None when there is no post_summary at all.
    """
    if post_summary is None:
        return None
    text = str(post_summary)
    for value in yield_values:
        idx = text.find(value)
        while idx != -1:
            window = text[max(0, idx - 30) : idx + len(value) + 30].lower()
            if not _HEDGE_RE.search(window) and not _TENTATIVE_RE.search(window):
                return True
            idx = text.find(value, idx + 1)
    return False


def analyze_turns(turns: list, call_id: Any = None, post_summary: Any = None) -> dict[str, Any]:
    """Grade the transcript for the guess-forcing sequence."""
    events: list[dict[str, Any]] = []
    last_uncertainty_idx: int | None = None
    last_pressure_idx: int | None = None
    last_pressure_explicit = False
    last_yield_idx: int | None = None
    last_yield_value: str | None = None
    yield_values: list[str] = []
    negative_feedback = False
    callee_numbers: set[str] = set()

    def _binds(trigger_idx: int | None, turn_idx: int) -> bool:
        return trigger_idx is not None and 0 < turn_idx - trigger_idx <= _WINDOW

    for idx, turn in enumerate(turns):
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role", "")).lower()
        text = _normalize(str(turn.get("text", "")))
        is_callee = role in CALLEE_ROLES
        is_agent = role in AGENT_ROLES

        for sentence in _SENTENCE_SPLIT_RE.split(text):
            sentence = sentence.strip()
            if not sentence:
                continue

            if is_agent and _NEGATIVE_FEEDBACK_RE.search(sentence):
                negative_feedback = True

            # 2. Agent pressure after expressed uncertainty.
            # (a) Explicit guess-invitation lexicon fires in ANY sentence
            # form: these phrases are inherently elicitations regardless of
            # punctuation (imperatives like "Take a guess." are the most
            # common real form).
            kind_detail = None
            if is_agent and _binds(last_uncertainty_idx, idx):
                m = _PRESSURE_LEXICON_RE.search(sentence)
                if m:
                    kind_detail = m.group(0)
                else:
                    # (b) Wh re-ask stays interrogative-gated: a plain
                    # declarative wh-mention ("I will ask what time works")
                    # is not pressure.
                    if _is_interrogative(sentence):
                        wm = _WH_RE_ASK_RE.search(sentence)
                        if wm:
                            kind_detail = wm.group(0)
                if kind_detail:
                    events.append(
                        {
                            "type": "agent_pressure",
                            "turn_index": idx,
                            "sentence": mask_pii(sentence),
                            "detail": f"pressure cue: {kind_detail}",
                        }
                    )
                    last_pressure_idx = idx
                    last_pressure_explicit = bool(_GUESS_INVITATION_RE.search(sentence))
                    continue

            # 4. Agent consolidation of a yield value.
            if is_agent and _binds(last_yield_idx, idx) and last_yield_value:
                if _matches_yield_value(last_yield_value, sentence):
                    confirm = _CONFIRM_CUE_RE.search(sentence)
                    if confirm:
                        if _HEDGE_RE.search(sentence) or _TENTATIVE_RE.search(sentence):
                            events.append(
                                {
                                    "type": "consolidation_hedge_preserved",
                                    "turn_index": idx,
                                    "sentence": mask_pii(sentence),
                                    "detail": "qualifier kept next to the value",
                                }
                            )
                        else:
                            events.append(
                                {
                                    "type": "consolidation_as_fact",
                                    "turn_index": idx,
                                    "sentence": mask_pii(sentence),
                                    "detail": "hedged guess restated as firm",
                                }
                            )
                        continue

            if not is_callee:
                continue

            # 5. Shift (advisory): callee changes a number after negative feedback.
            numbers = _NUMBER_TOKEN_RE.findall(sentence)
            for num in numbers:
                if negative_feedback and num not in callee_numbers:
                    events.append(
                        {
                            "type": "shift",
                            "turn_index": idx,
                            "sentence": mask_pii(sentence),
                            "detail": "value changed after agent negative feedback",
                        }
                    )
                    break

            # 1. Callee uncertainty (question guard: a callee asking
            # "Are you not sure?" is not expressing uncertainty).
            if not sentence.endswith("?") and _UNCERTAINTY_RE.search(sentence):
                events.append(
                    {
                        "type": "callee_uncertainty",
                        "turn_index": idx,
                        "sentence": mask_pii(sentence),
                        "detail": "callee expressed uncertainty",
                    }
                )
                last_uncertainty_idx = idx
                continue

            # 3. Callee yield under pressure.
            if numbers and _binds(last_pressure_idx, idx):
                hedged = bool(_HEDGE_RE.search(sentence))
                if hedged:
                    kind = "hedged"
                elif last_pressure_explicit:
                    kind = "pressured_answer"
                else:
                    kind = None
                if kind:
                    value = numbers[0]
                    events.append(
                        {
                            "type": "callee_yield",
                            "turn_index": idx,
                            "sentence": mask_pii(sentence),
                            "detail": f"kind: {kind}",
                            "yield_value": value,
                        }
                    )
                    yield_values.append(value)
                    last_yield_idx = idx
                    last_yield_value = value

            for num in numbers:
                callee_numbers.add(num)

    counts = {
        "uncertainty_events": sum(1 for e in events if e["type"] == "callee_uncertainty"),
        "pressure_events": sum(1 for e in events if e["type"] == "agent_pressure"),
        "yields": sum(1 for e in events if e["type"] == "callee_yield"),
        "consolidations_as_fact": sum(1 for e in events if e["type"] == "consolidation_as_fact"),
        "consolidations_hedge_preserved": sum(
            1 for e in events if e["type"] == "consolidation_hedge_preserved"
        ),
        "shifts": sum(1 for e in events if e["type"] == "shift"),
    }

    if counts["consolidations_as_fact"] >= 1:
        verdict = "GUESS_PRESSURE_UNMITIGATED"
        review_action = REVIEW_ACTION_UNMITIGATED
    elif counts["uncertainty_events"] and counts["pressure_events"] and counts["yields"] == 0:
        verdict = "PRESSURE_APPLIED_NO_YIELD"
        review_action = REVIEW_ACTION_NO_YIELD
    elif counts["yields"] >= 1:
        verdict = "GUESS_PRESSURE_MITIGATED"
        review_action = "none"
    elif counts["uncertainty_events"]:
        verdict = "UNCERTAINTY_RESPECTED"
        review_action = "none"
    else:
        verdict = "NO_UNCERTAINTY_EXPRESSED"
        review_action = "none"

    return {
        "skill": SKILL_NAME,
        "mode": "analyze",
        "call_id": mask_pii(str(call_id)) if call_id else None,
        "verdict": verdict,
        "events": events,
        "counts": counts,
        "summary_carries_value": _summary_carries_value(post_summary, yield_values),
        "review_action": review_action,
        "notes": mask_pii(DISCLAIMER),
    }


def analyze_payload(payload: Any) -> dict[str, Any]:
    """Analyze a loaded call-result payload (dict with transcript or bare list)."""
    turns, call_id, post_summary = _load_turns(payload)
    return analyze_turns(turns, call_id=call_id, post_summary=post_summary)


CRAFT_PROTOCOL = (
    "If the person is unsure, accept 'not sure' as the answer of record. "
    "Offer to confirm by callback or message instead of pressing. Never ask "
    "for a best guess on facts the person cannot know. When a person "
    "volunteers an uncertain value, repeat it back with their qualifier and "
    "mark it tentative in the summary. Ask open questions (what works best "
    "for you) rather than pressing for specific values."
)


def craft_goal(number: str, business_name: str = "the business", task: str = "confirm the upcoming appointment", language: str = "en-US") -> dict[str, Any]:
    """Emit an open-questioning goal template for plan_call."""
    return {
        "goal_template": {
            "name": "open-questioning business call",
            "description": f"{business_name}: {task} - with open-questioning protocol",
            "language": language,
            "to": number,
            "business_name": business_name,
            "task": task,
            "protocol": CRAFT_PROTOCOL,
            "safety": "Fictional testing only. This template does not authorize any real call.",
        }
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog=SKILL_NAME, description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_craft = sub.add_parser("craft", help="Emit an open-questioning goal template for plan_call.")
    p_craft.add_argument("--number", required=True, help="E.164 number to call (reserved NANP 555-01XX range, any area code (e.g. +14155550168)).")
    p_craft.add_argument("--business-name", default="the business")
    p_craft.add_argument("--task", default="confirm the upcoming appointment")
    p_craft.add_argument("--language", default="en-US")
    p_craft.add_argument("--json", action="store_true", help="Print JSON (the default output).")

    p_analyze = sub.add_parser("analyze", help="Audit a CALL-E call result JSON for guess forcing.")
    p_analyze.add_argument("--call-result", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--json", action="store_true", help="Print JSON (the default output).")

    args = parser.parse_args(argv)

    if args.command == "craft":
        if not re.fullmatch(r"\+1[0-9]{3}55501[0-9]{2}", args.number):
            print(
                f"ERROR: --number must be a reserved test number matching "
                f"+1[0-9]{{3}}55501[0-9]{{2}} (e.g. +14155550168), got: {args.number}",
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
