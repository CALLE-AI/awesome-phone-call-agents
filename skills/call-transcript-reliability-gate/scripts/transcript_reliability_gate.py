#!/usr/bin/env python3
"""call-transcript-reliability-gate - audit CALL-E transcripts for ASR-hallucination symptoms.

Twin-mode heuristic skill:
  analyze  grade a finished call result's transcript RELIABLE / SUSPECT / UNUSABLE
  craft    emit an ASR-risk-aware goal template for the next plan_call

Runs offline, deterministic, no LLM, no network. Input errors exit 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

# Speaker-role labels that represent the contacted party. Any other label is
# the agent side. Kept identical to call-summarizer for cross-skill
# consistency.
CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient"}

DISCLAIMER = (
    "Heuristic text-only analysis. These signals are reasons to re-confirm "
    "values or seek the audio, not proof that the provider hallucinated. A "
    "clean verdict does not certify transcription accuracy."
)

# A candidate is a digit run in which every separator (space, dash, dot,
# comma, slash) sits BETWEEN two ASCII digits. That prevents trailing
# separators from being masked and keeps "10:00" or "3rd" untouched because
# their digit runs are shorter than 7. ASCII [0-9] only, never \d.
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
    """Load a CALL-E call result and normalize its transcript to turns.

    Accepts both the real get_call_run shape ({status, result: {transcript}})
    and the flat fixture shape ({status, transcript}) used by sibling skills.
    A plain-string transcript becomes one agent-labelled turn.
    """
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


# Detectors. Each returns a list of rule names that fired for one turn.
# Grounding: text-side hallucination detection is an established paradigm
# (Jasinski et al., Interspeech 2026, arXiv:2606.23060); non-speech audio
# triggers boilerplate phantoms (Baranski et al., arXiv:2501.11378); harms
# appear in ~38% of studied hallucinations (Koenecke et al., FAccT 2024,
# arXiv:2402.08021); distribution shift incl. language switches (Atwany et
# al., ACL 2025, arXiv:2502.12414).

# Caption-credit boilerplate that Whisper-family models emit on non-speech
# audio (music, silence). None of it is plausible in a phone call.
_BOILERPLATE_PATTERNS: list[tuple[str, str]] = [
    ("caption_credit", r"\bamara\.org\b"),
    ("caption_credit", r"\btranslated by\b"),
    ("caption_credit", r"\bsubtitles? (?:by|done) by\b"),
    ("video_boilerplate", r"\bthank(?:s| you) for watching\b"),
    ("video_boilerplate", r"\bsubscribe to (?:this|my|the) channel\b"),
    ("video_boilerplate", r"\blike and subscribe\b"),
    ("video_boilerplate", r"\bclick (?:the|on the) (?:link|bell|notification)\b"),
    ("video_boilerplate", r"\bsee you in the next (?:video|episode)\b"),
]

# Narrow harm lexicon. These categories match the documented harm taxonomy
# of ASR hallucinations. In an outbound confirmation call they are either
# hallucinated or genuinely serious - both require a human, so the verdict
# routes to review either way. Bare "kill" is deliberately excluded so
# hyperbole like "this price will kill me" does not fire; violence terms
# require an object or an unambiguous standalone form. Not exhaustive.
_HARM_PATTERNS: list[tuple[str, str]] = [
    ("harm_violence", r"\bkill(?:ed|ing)?\s+(?:him|her|them|someone|you|all)\b"),
    ("harm_violence", r"\b(?:murder(?:ed|ing)?|rape[ds]?|stab(?:bed|bing)?|strangl(?:ed|ing))\b"),
    ("harm_extremism", r"\b(?:nazi|white power|terrorist group|jihad)\b"),
    ("harm_slur_prefix", r"\byou (?:are|r) (?:a|an) (?:stupid|dirty|filthy) (?:woman|man|immigrant|foreigner)\b"),
]

# Non-Latin script coverage: Cyrillic, CJK, Arabic, Hebrew, Hangul, Thai,
# Devanagari. Three or more consecutive codepoints from one script inside an
# otherwise English call is a distribution-shift symptom, not an accented
# name (which stays in Latin) or a two-letter loanword.
_SCRIPT_RANGES = [
    ("cyrillic", 0x0400, 0x04FF),
    ("cjk", 0x4E00, 0x9FFF),
    ("arabic", 0x0600, 0x06FF),
    ("hebrew", 0x0590, 0x05FF),
    ("hangul", 0xAC00, 0xD7AF),
    ("thai", 0x0E00, 0x0E7F),
    ("devanagari", 0x0900, 0x097F),
]

_SCRIPT_MIN_RUN = 3

_WORD_RE = re.compile(r"[a-z']+", re.IGNORECASE)

# A loop is the same 3-to-6-word n-gram appearing 3+ times inside ONE turn.
# Requiring 3+ words keeps backchannels ("yes yes yes", "okay okay") and
# legitimate short affirmations out of scope.
_LOOP_MIN_REPEATS = 3
_LOOP_MIN_WORDS = 3
_LOOP_MAX_WORDS = 6

# Single turns above this many words are flagged as an extreme shape for a
# phone conversation, where long unbroken monologues usually mean a
# transcription merge failure rather than real speech.
_EXTREME_TURN_WORDS = 120

_DATE_WORD_RE = re.compile(
    r"\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"january|february|march|april|may|june|july|august|september|october|"
    r"november|december|tomorrow|today|tonight|morning|afternoon|evening)\b",
    re.IGNORECASE,
)
# Digit values for re-confirmation lists. Lookarounds (not \b) so ordinals
# like "15th" still yield "15" - a digit next to a letter stays a value.
_VALUE_RE = re.compile(r"(?<![0-9])[0-9](?:[ ,./-]?[0-9])*(?![0-9])")


def _find_loops(text: str) -> list[str]:
    """Return n-grams (as text) that repeat 3+ times inside one turn."""
    words = _WORD_RE.findall(text.lower())
    if len(words) < _LOOP_MIN_WORDS * _LOOP_MIN_REPEATS:
        return []
    seen: Counter[tuple[str, ...]] = Counter()
    for size in range(_LOOP_MIN_WORDS, _LOOP_MAX_WORDS + 1):
        for start in range(0, len(words) - size + 1):
            seen[tuple(words[start : start + size])] += 1
    loops = [" ".join(ngram) for ngram, count in seen.items() if count >= _LOOP_MIN_REPEATS]
    # Report the longest repeating n-grams only; shorter substrings of an
    # already-reported loop add noise.
    loops.sort(key=len, reverse=True)
    kept: list[str] = []
    for candidate in loops:
        if not any(candidate in longer for longer in kept):
            kept.append(candidate)
    return kept


def _script_switches(text: str) -> list[str]:
    """Return non-Latin scripts present with 3+ consecutive codepoints."""
    found: list[str] = []
    for name, low, high in _SCRIPT_RANGES:
        run = 0
        best = 0
        for ch in text:
            if low <= ord(ch) <= high:
                run += 1
                best = max(best, run)
            else:
                run = 0
        if best >= _SCRIPT_MIN_RUN:
            found.append(name)
    return found


def grade_turn(text: str) -> dict[str, Any]:
    """Grade one turn against every reliability signal."""
    rules: list[str] = []
    spans: dict[str, str] = {}

    loops = _find_loops(text)
    if loops:
        rules.append("loop_repetition")
        spans["loop_repetition"] = loops[0]

    for name, pattern in _BOILERPLATE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            if "boilerplate_phantom" not in rules:
                rules.append("boilerplate_phantom")
            spans.setdefault("boilerplate_phantom", "")
            break

    for name, pattern in _HARM_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            rules.append(name)
            spans[name] = ""

    switches = _script_switches(text)
    if switches:
        rules.append("non_english_insertion")
        spans["non_english_insertion"] = ",".join(switches)

    stripped = text.strip()
    if stripped and not _WORD_RE.search(stripped) and not any(ch.isascii() and ch.isalnum() for ch in stripped):
        rules.append("empty_word_content")

    if len(_WORD_RE.findall(text)) > _EXTREME_TURN_WORDS:
        rules.append("extreme_turn_length")

    return {"rules": rules, "spans": spans}


def _extract_fields_to_reconfirm(text: str) -> list[str]:
    """Masked values and date words inside a suspect turn worth re-confirming."""
    found: list[str] = []
    for m in _VALUE_RE.finditer(text):
        token = m.group(0).strip()
        if len(token.strip(" ,./-")) >= 1:
            masked = mask_pii(token)
            if masked not in found:
                found.append(masked)
    for m in _DATE_WORD_RE.finditer(text):
        word = m.group(0).lower()
        if word not in found:
            found.append(word)
    return found


def analyze_turns(turns: list[dict[str, str]]) -> dict[str, Any]:
    """Build the reliability card from normalized turns."""
    card: dict[str, Any] = {
        "skill": "call-transcript-reliability-gate",
        "analysis_mode": "heuristic",
        "reliability_assessment": "assessed",
        "reason": None,
        "verdict": "RELIABLE",
        "evidence": [],
        "signals_summary": {},
        "fields_to_reconfirm": [],
        "harm_review_required": False,
        "recommended_action": {"action": "proceed_with_caution", "guidance": None},
        "disclaimer": DISCLAIMER,
    }

    if not turns:
        card["reliability_assessment"] = "unclear"
        card["reason"] = "empty_transcript"
        card["verdict"] = "UNUSABLE"
        card["recommended_action"] = {
            "action": "do_not_act_on_transcript",
            "guidance": "The transcript contains no turns at all; there is nothing to verify against.",
        }
        return card

    evidence: list[dict[str, Any]] = []
    signal_counts: Counter[str] = Counter()
    harm = False
    empty_turns = 0
    for index, turn in enumerate(turns):
        text = str(turn.get("text", ""))
        stripped = text.strip()
        if not stripped:
            empty_turns += 1
            evidence.append(
                {
                    "turn_index": index,
                    "speaker": str(turn.get("speaker", "unknown")),
                    "span": "",
                    "rules": ["empty_turn"],
                }
            )
            signal_counts["empty_turn"] += 1
            continue
        graded = grade_turn(stripped)
        if graded["rules"]:
            evidence.append(
                {
                    "turn_index": index,
                    "speaker": str(turn.get("speaker", "unknown")),
                    "span": mask_pii(stripped)[:160],
                    "rules": graded["rules"],
                }
            )
            for rule in graded["rules"]:
                signal_counts[rule] += 1
                if rule.startswith("harm_"):
                    harm = True

    has_callee = any(
        str(t.get("speaker", "")).lower().strip() in CALLEE_ROLES and str(t.get("text", "")).strip()
        for t in turns
    )
    if not has_callee:
        signal_counts["no_callee_turns"] = 1
        evidence.append(
            {
                "turn_index": None,
                "speaker": None,
                "span": None,
                "rules": ["no_callee_turns"],
            }
        )
    if len(turns) == 1:
        signal_counts["single_turn_call"] = 1

    card["signals_summary"] = dict(signal_counts)
    card["evidence"] = evidence
    card["harm_review_required"] = harm

    suspect_indexes = {e["turn_index"] for e in evidence if e["turn_index"] is not None}
    callee_indexes = {
        i
        for i, t in enumerate(turns)
        if str(t.get("speaker", "")).lower().strip() in CALLEE_ROLES and str(t.get("text", "")).strip()
    }

    if not signal_counts:
        card["recommended_action"] = {
            "action": "proceed_with_caution",
            "guidance": "No text-visible hallucination symptoms. This is not a certificate of accuracy.",
        }
        return card

    fields: list[str] = []
    for i in sorted(suspect_indexes):
        for value in _extract_fields_to_reconfirm(str(turns[i].get("text", ""))):
            if value not in fields:
                fields.append(value)
    card["fields_to_reconfirm"] = fields

    callee_suspect = callee_indexes & suspect_indexes
    structural_fail = (not has_callee) or len(turns) == 1 or empty_turns == len(turns)
    all_callee_suspect = has_callee and callee_indexes == callee_suspect

    if harm:
        card["verdict"] = "UNUSABLE" if all_callee_suspect or structural_fail else "SUSPECT"
        card["recommended_action"] = {
            "action": "do_not_act_on_transcript",
            "guidance": (
                "Content matching documented ASR-hallucination harm categories was found. "
                "A human must review the audio before anything in this transcript is used."
            ),
        }
        return card

    if structural_fail or all_callee_suspect:
        card["verdict"] = "UNUSABLE"
        card["recommended_action"] = {
            "action": "do_not_act_on_transcript",
            "guidance": (
                "Structural failure: the transcript has no usable callee-side turns to verify against. "
                "Re-fetch the call run or review the audio."
            ),
        }
        return card

    card["verdict"] = "SUSPECT"
    if fields:
        card["recommended_action"] = {
            "action": "reverify_key_fields",
            "guidance": (
                "Suspect turns contain numbers or dates. Re-confirm these values through a second "
                "channel or a follow-up question before writing them anywhere."
            ),
        }
    else:
        card["recommended_action"] = {
            "action": "proceed_with_caution",
            "guidance": "Hallucination symptoms are present but no key values sit inside suspect turns.",
        }
    return card


ASR_SAFE_GOAL = (
    "You are placing a call whose result depends on numbers, dates, or "
    "exact identifiers. Speak numbers one digit at a time and say each "
    "critical value twice, for example 'on the fifteenth of October - "
    "that is day one five'. After stating a critical value, ask the person "
    "to read it back to you, for example 'can you read that date back to "
    "me?'. If the person goes quiet or you hear hold music, keep saying a "
    "short acknowledgment every few seconds ('Are you still there?') "
    "instead of staying silent, then restate the last critical value once "
    "the person returns. If the person repeats a value back differently "
    "from what you said, do not accept either version silently - restate "
    "your version once more, digit by digit, and note the disagreement in "
    "the summary."
)

CRAFT_SCENARIOS = {"number-critical-call"}


def craft_goal(scenario: str, language: str | None = None) -> dict[str, Any]:
    """Emit plan_call inputs for an ASR-risk-aware outbound call."""
    if scenario not in CRAFT_SCENARIOS:
        raise ValueError(f"unknown scenario: {scenario!r}; expected one of {sorted(CRAFT_SCENARIOS)}")
    return {
        "skill": "call-transcript-reliability-gate",
        "mode": "craft",
        "scenario": scenario,
        "language": language or "en",
        "goal": ASR_SAFE_GOAL,
        "notes": [
            "Heuristic skill: this template is a starting point; adapt wording to the case.",
            "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Grade a finished CALL-E call result's transcript reliability.")
    p_analyze.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    p_analyze.add_argument("--out", default=None, help="Write the card to this path (default: stdout).")

    p_craft = sub.add_parser("craft", help="Emit an ASR-risk-aware goal for the next plan_call.")
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
