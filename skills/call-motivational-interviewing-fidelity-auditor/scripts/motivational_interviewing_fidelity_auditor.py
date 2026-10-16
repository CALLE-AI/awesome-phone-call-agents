#!/usr/bin/env python3
"""call-motivational-interviewing-fidelity-auditor - MITI-inspired MI fidelity audit.

Heuristic lexical coder that checks whether a CALL-E phone agent in a
health-behavior call (medication adherence, refill reminders) behaves like
Motivational Interviewing: reflections, open questions, permission-gated
advice, no confrontation.

  analyze  classify every agent sentence (reflection, affirmation, confront,
           warn, advice with/without permission, open/closed question,
           information statement), count callee change-talk markers, and
           report a coarse verdict: MI_ADHERENT, PARTIALLY_ADHERENT,
           NON_ADHERENT, or NOT_MI_CALL
  craft    emit an MI goal template for plan_call (refill reminder)

Documented trap (kept deterministic on purpose): "How about a phone
reminder?" is effectively a closed offer, but the wh-initial rule
classifies any sentence starting with "how" as an open question. We do not
special-case it; counts are the product, the verdict is a coarse summary.
Similarly, "Could you tell me about your week?" grades closed under the
deterministic auxiliary-initial rule even though it invites an open
answer; documented, not special-cased.

Limitation: a string-form transcript becomes a single agent turn, so
callee change talk is never present and the verdict is NOT_MI_CALL;
supply real turn lists.

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
    "Heuristic lexical coding inspired by the MITI 4.2.1 instrument; not "
    "certified MI coding, not a clinical judgment, not a quality label for "
    "any person, and not authorization to act. Counts and ratios are the "
    "product; the verdict is a coarse summary."
)

_DIGIT_RUN_RE = re.compile(r"[0-9](?:[ ,./-][0-9]|[0-9])*")

# Real CALL-E transcription emits typographic apostrophes and quotes; the
# lexicons in this file are written with ASCII quotes. Normalize one-char-
# to-one-char (offset-preserving) before any matching, mirroring the
# convention in skills/verify-by-phone/scripts/extract_answer.py.
_TYPOGRAPHIC = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
    }
)


def normalize_input(text: str) -> str:
    return text.translate(_TYPOGRAPHIC)


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


# ---------------------------------------------------------------------------
# Sentence segmentation + role detection
# ---------------------------------------------------------------------------

# Split on sentence enders, but never right after "a.m."/"p.m." so an
# abbreviation never glues onto (or splits off) the following sentence.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])(?<![aApP]\.m\.)\s+(?=[A-Z])")


def _sentence_spans(text: str) -> list[tuple[int, str]]:
    """Non-empty sentences as (start_offset, sentence) pairs."""
    spans: list[tuple[int, str]] = []
    start = 0
    for m in _SENTENCE_SPLIT_RE.finditer(text):
        spans.append((start, text[start:m.start()]))
        start = m.end()
    spans.append((start, text[start:]))
    return [(s, t) for s, t in spans if t.strip()]


def split_sentences(text: str) -> list[str]:
    """Split turn text into sentences (a.m./p.m. safe)."""
    return [t for _, t in _sentence_spans(text)]


def is_agent_turn(turn: dict[str, str]) -> bool:
    """True when the speaker is not one of the callee-side roles."""
    return str(turn.get("speaker", "unknown")).lower() not in CALLEE_ROLES


# ---------------------------------------------------------------------------
# MITI-inspired lexicons (heuristic, case-insensitive, contracted + uncontracted)
# ---------------------------------------------------------------------------

_REFLECTION_RE = re.compile(
    r"^(?:so[,.]?\s+)?(?:(?:it\s+)?(?:sounds?|sounded|seems?|seemed)\s+like|"
    r"what\s+i(?:\s+hear|'?m\s+hearing)\s+(?:is|that)|i'?m\s+hearing\s+(?:that\s+)?|"
    r"so\s+you(?:'re|\s+are|'ve|\s+have)|you(?:'re|\s+are|'ve|\s+have)\s+been|you(?:'re|\s+are)\s+feeling|you(?:'re|\s+are)\s+saying\s+that|"
    r"you\s+mentioned\s+that|i\s+hear\s+you\s+saying)\b", re.IGNORECASE)
_AFFIRM_RE = re.compile(
    r"\b(?:you\s+did\s+a\s+(?:great|good|wonderful)\s+job|that\s+takes\s+(?:real\s+|a\s+lot\s+of\s+)?effort|"
    r"you'?ve\s+been\s+(?:really\s+|very\s+)?consistent|you\s+should\s+be\s+proud|that'?s\s+impressive|"
    r"good\s+work|well\s+done|that'?s\s+no\s+small\s+thing|you'?ve\s+come\s+a\s+long\s+way)\b", re.IGNORECASE)
_PERMISSION_RE = re.compile(
    r"\b(?:would\s+you\s+mind\s+if\s+i|may\s+i\s+offer|with\s+your\s+permission|can\s+i\s+share|"
    r"would\s+it\s+be\s+(?:okay|ok|all\s+right|alright)\s+if\s+i|is\s+it\s+(?:okay|ok|all\s+right|alright)\s+if\s+i|"
    r"let\s+me\s+(?:offer|share)\s+(?:a|some|one)\s+(?:suggestion|thoughts?|tips?|idea)|"
    r"might\s+i\s+(?:suggest|offer|share)|if\s+you\s+don'?t\s+mind,?\s*i)\b", re.IGNORECASE)
_ADVICE_RE = re.compile(
    r"\b(?:i(?:'d|\s+would)?\s+(?:recommend|suggest)|you\s+(?:should|need\s+to|must|ought(?:a|\s+to))(?!\s+be\s+(?:proud|able))|"
    r"you(?:'ll|\s+will|\s+would|'d)\s+better|the\s+best\s+thing\s+(?:is|to\s+do\s+is|to|would\s+be)|"
    r"it\s+(?:would|'d)\s+be\s+best\s+to|what\s+i\s+would\s+do\s+is|you(?:'ll|\s+will)\s+need\s+to|"
    r"make\s+sure\s+(?:to|you)|consider\s+(?:setting|taking|using|calling|asking))\b", re.IGNORECASE)
_CONFRONT_RE = re.compile(
    r"\b(?:you(?:'re|\s+are)\s+just\s+making\s+excuses|that'?s\s+(?:just\s+)?an\s+excuse|you\s+have\s+to\s+admit|"
    r"you\s+clearly\s+(?:don'?t|do\s+not)\s+(?:want|care)|you(?:'re|\s+are)\s+not\s+(?:really\s+)?trying|"
    # "if you keep ..." is the conditional-warn shape, not confrontation.
    r"(?<!if\s)you\s+keep\s+(?:avoiding|dodging|skipping)|stop\s+(?:lying|arguing)|"
    r"you(?:'re|\s+are)\s+in\s+denial)\b", re.IGNORECASE)
_WARN_IF_RE = re.compile(r"\bif\s+you\s+(?:don'?t|do\s+not|keep|continue\s+to)\b", re.IGNORECASE)
_WARN_WITHOUT_RE = re.compile(
    r"\bwithout\s+(?:a|an|your|the)\b[^.!?]{0,40}?\byou(?:'ll|\s+will)\b", re.IGNORECASE)
_LOSS_RE = re.compile(r"\b(?:run\s+out|lose|losing|miss(?:ing)?|cancel(?:l(?:ed|ing))?)\b", re.IGNORECASE)
_OPEN_Q_RE = re.compile(r"^(?:what|how|why|when|where|who|tell\s+me\s+about|walk\s+me\s+through)\b", re.IGNORECASE)
_CLOSED_Q_RE = re.compile(r"^(?:do|does|did|is|are|was|were|can|could|would|will|won't|have|has|had|should|shall|may|might)\b", re.IGNORECASE)
_CHANGE_TALK_RE = re.compile(
    r"\b(?:i\s+(?:want|wanna|need)\s+to\s+(?:quit|stop|start|cut|take|get|exercise|eat|drink|walk|refill|schedule|come\s+in|reduce|use)|"
    r"i'?m\s+trying\s+to|i\s+(?:will|'ll)\s+(?:start|try|cut|call|take|quit|stop)|i\s+should\s+probably|"
    r"i'?d\s+like\s+to|i'?m\s+hoping\s+to|part\s+of\s+me|on\s+the\s+other\s+hand|torn\s+about|"
    r"i'?ve\s+been\s+trying\s+to|trying\s+my\s+best|maybe\s+i\s+should\s+(?:quit|stop|cut|refill|take)|"
    r"i\s+(?:kinda|kind\s+of|sorta)\s+want\s+to)\b", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Per-sentence classification (first match wins)
# ---------------------------------------------------------------------------

def classify_turn(text: str) -> list[dict[str, str]]:
    """Classify each sentence of one (already masked) turn.

    Priority: reflection -> affirmation -> confront -> warn (conditional if/
    without-clause + loss in the same sentence) -> advice (permission must
    start at or before the advice sentence within the same turn) ->
    question (open/closed by sentence-initial word; declarative questions
    count as closed) -> information statement. A '?' sentence that matched
    reflection stays a reflection (precedence).
    """
    labeled: list[dict[str, str]] = []
    for offset, sentence in _sentence_spans(text):
        stripped = sentence.strip()
        if _REFLECTION_RE.search(stripped):
            label = "reflection"
        elif _AFFIRM_RE.search(stripped):
            label = "affirmation"
        elif _CONFRONT_RE.search(stripped):
            label = "confront"
        elif (_WARN_IF_RE.search(stripped) or _WARN_WITHOUT_RE.search(stripped)) and _LOSS_RE.search(stripped):
            label = "warn"
        elif _ADVICE_RE.search(stripped):
            permission_before = any(
                m.start() <= offset for m in _PERMISSION_RE.finditer(text)
            )
            label = "advice_with_permission" if permission_before else "advice_without_permission"
        elif stripped.endswith("?"):
            if _OPEN_Q_RE.search(stripped):
                label = "open_question"
            else:
                # Closed by starter, or declarative question ("You took it?").
                label = "closed_question"
        else:
            label = "information_statement"
        labeled.append({"text": stripped, "label": label})
    return labeled


# ---------------------------------------------------------------------------
# Counting, ratios, verdict
# ---------------------------------------------------------------------------

_LABEL_TO_COUNT = {
    "reflection": "reflections",
    "affirmation": "affirmations",
    "confront": "confront",
    "warn": "warn",
    "advice_with_permission": "advice_with_permission",
    "advice_without_permission": "advice_without_permission",
    "open_question": "open_questions",
    "closed_question": "closed_questions",
    "information_statement": "information_statements",
}


def _empty_counts() -> dict[str, int]:
    return {
        "sentences": 0,
        "reflections": 0,
        "open_questions": 0,
        "closed_questions": 0,
        "affirmations": 0,
        "advice_with_permission": 0,
        "advice_without_permission": 0,
        "confront": 0,
        "warn": 0,
        "information_statements": 0,
    }


def verdict_of(counts: dict[str, int], agent_turns_present: bool, change_talk_present: bool) -> str:
    if not agent_turns_present or not change_talk_present:
        return "NOT_MI_CALL"
    if counts["confront"] > 0 or counts["warn"] > 0 or counts["advice_without_permission"] >= 3:
        return "NON_ADHERENT"
    if counts["advice_without_permission"] == 0 and counts["reflections"] >= 1 and counts["open_questions"] >= counts["closed_questions"]:
        return "MI_ADHERENT"
    return "PARTIALLY_ADHERENT"


def analyze(turns: list[dict[str, str]], call_id: str | None = None) -> dict[str, Any]:
    """Audit MI fidelity over (unmasked) transcript turns; PII is masked first."""
    counts = _empty_counts()
    agent_turns = 0
    change_talk_markers = 0
    for turn in turns:
        masked = mask_pii(normalize_input(str(turn.get("text", ""))))
        if is_agent_turn(turn):
            agent_turns += 1
            for labeled in classify_turn(masked):
                counts["sentences"] += 1
                counts[_LABEL_TO_COUNT[labeled["label"]]] += 1
        else:
            change_talk_markers += len(_CHANGE_TALK_RE.findall(masked))

    questions = counts["open_questions"] + counts["closed_questions"]
    ratios: dict[str, Any] = {
        "reflections_per_question": round(counts["reflections"] / questions, 2) if questions else None,
        "open_question_share": round(counts["open_questions"] / questions, 2) if questions else None,
    }
    verdict = verdict_of(counts, agent_turns > 0, change_talk_markers > 0)
    advisories = ["low_sample"] if agent_turns < 6 else []
    return {
        "skill": "call-motivational-interviewing-fidelity-auditor",
        "call_id": call_id,
        "verdict": verdict,
        "counts": counts,
        "ratios": ratios,
        "change_talk_markers": change_talk_markers,
        "advisories": advisories,
        "disclaimer": DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# Craft: MI goal template
# ---------------------------------------------------------------------------

_CRAFT_BODY = (
    "GOAL: call the patient about their medication refill using Motivational Interviewing.\n"
    "ENGAGE: open with an open question about how they are managing the medication.\n"
    "OARS: use Open questions, Affirmations, Reflective listening (\"It sounds like...\"), and Summaries.\n"
    "PERMISSION: before any suggestion, ask permission (\"Would you mind if I shared what other patients try?\").\n"
    "ROLL WITH RESISTANCE: never argue for change; reflect ambivalence (\"Part of you wants to..., and part of you...\").\n"
    "CLOSE: summarize what the patient said and let THEM choose the next step.\n"
)


def craft_template(mode: str = "refill-reminder", language: str = "en-US") -> str:
    """MI craft template; non-en-US gets a translate-and-apply prefix line."""
    if language != "en-US":
        return f"[{language}] Translate and apply the same MI structure below.\n" + _CRAFT_BODY
    return _CRAFT_BODY


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="motivational_interviewing_fidelity_auditor")
    sub = parser.add_subparsers(dest="command", required=True)
    sub_analyze = sub.add_parser("analyze")
    sub_analyze.add_argument("--call-result", required=True)
    sub_craft = sub.add_parser("craft")
    sub_craft.add_argument("--type", default="refill-reminder", dest="mode")
    sub_craft.add_argument("--language", default="en-US")
    args = parser.parse_args(argv)

    try:
        if args.command == "analyze":
            record = load_call_result(Path(args.call_result))
            card = analyze(record["turns"], call_id=record["call_id"])
            print(json.dumps(card, indent=2))
            return 0
        print(craft_template(args.mode, args.language), end="")
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
