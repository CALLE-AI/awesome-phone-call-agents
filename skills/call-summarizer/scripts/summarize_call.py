#!/usr/bin/env python3
"""Turn a CALL-E call transcript into a structured post-call brief.

This script uses only the Python standard library. It makes no network calls
and places no phone calls. It reads a CALL-E call result containing a
transcript and emits a masked, actionable brief.

Usage:
    python3 scripts/summarize_call.py --transcript path/to/transcript.json
    python3 scripts/summarize_call.py --transcript path/to/transcript.json --out brief.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Masking patterns
# ---------------------------------------------------------------------------

PHONE_RE = re.compile(
    r"(?<!\w)(\+?\d[\d\s().-]{7,}\d)(?!\w)"
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ID_RE = re.compile(
    r"\b(?:account|reference|order|case|ticket|claim|policy|invoice)\s*(?:#|no\.?|number)?\s*([A-Z0-9][A-Z0-9-]{3,})\b",
    re.IGNORECASE,
)

MASK_TOKEN = "[redacted]"


def mask_pii(text: str) -> str:
    """Replace phone numbers, emails, and account IDs with a redaction token."""
    text = PHONE_RE.sub("[phone:\u2022\u2022\u2022\u2022]", text)
    text = EMAIL_RE.sub("[email:\u2022\u2022\u2022\u2022]", text)

    def _id_repl(match: re.Match[str]) -> str:
        return match.group(0).replace(match.group(1), "[id:\u2022\u2022\u2022\u2022]")

    return ID_RE.sub(_id_repl, text)


# ---------------------------------------------------------------------------
# Transcript loading
# ---------------------------------------------------------------------------


def load_transcript(path: Path) -> tuple[str, list[dict[str, str]]]:
    """Load a CALL-E call result and return (raw_text, turns).

    Accepts both a plain-string transcript and a list-of-turns transcript.
    """
    data = json.loads(path.read_text(encoding="utf-8"))

    raw = data.get("transcript", "")
    if isinstance(raw, str):
        turns = [{"speaker": "agent", "text": raw}] if raw.strip() else []
    elif isinstance(raw, list):
        turns = []
        for item in raw:
            if isinstance(item, dict):
                speaker = str(item.get("speaker", "unknown"))
                text = str(item.get("text", ""))
                turns.append({"speaker": speaker, "text": text})
        if not turns and data.get("status"):
            turns = [{"speaker": "agent", "text": str(data.get("summary", ""))}]
    else:
        turns = []

    flat = " ".join(f"{t['speaker']}: {t['text']}" for t in turns).strip()
    return flat, turns


# ---------------------------------------------------------------------------
# Outcome detection
# ---------------------------------------------------------------------------

OUTCOME_CUES = [
    ("confirmed", r"\b(confirm(?:ed)?|yes,?\s*(?:i )?can|sounds good|great|perfect)\b"),
    ("declined", r"\b(decline|no,?\s*(?:i )?can'?t|can'?t make it|not able to|won'?t be able)\b"),
    ("rescheduled", r"\b(reschedul|move it|different (?:time|day|slot)|need to change)\b"),
    ("no-answer", r"\b(no response|no answer|did not respond|silence)\b"),
    ("voicemail", r"\b(voicemail|answering machine|leave a message|machine detected)\b"),
]


def detect_outcome(flat: str) -> str:
    """Return a one-line outcome grounded in transcript language."""
    low = flat.lower()
    if not flat.strip():
        return "unknown"
    for label, pattern in OUTCOME_CUES:
        if re.search(pattern, low):
            if label == "confirmed":
                return "Appointment or request confirmed."
            if label == "declined":
                return "Request declined by the callee."
            if label == "rescheduled":
                return "Reschedule requested."
            if label == "no-answer":
                return "No answer; call ended without contact."
            if label == "voicemail":
                return "Voicemail reached; no live contact."
    return "unknown"


# ---------------------------------------------------------------------------
# Action item extraction
# ---------------------------------------------------------------------------

ACTION_CUE = re.compile(
    r"(?:^|\.\s+)(?P<speaker>agent|callee|assistant|representative)\b[^.]*?"
    r"\b(?:will|i'?ll|i will|i can|let me|i need to|i have to)\s+"
    r"(?P<verb>[^.]+?)\.",
    re.IGNORECASE,
)

DUE_CUE = re.compile(
    r"\b(today|tomorrow|tonight|next week|this week|next month|"
    r"(?:by|before|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
    r"(?:in|within)\s+\d+\s+(?:day|days|hour|hours|week|weeks))\b",
    re.IGNORECASE,
)

SENSITIVE_CUE = re.compile(
    r"\b(medication|prescription|diagnosis|doctor|provider|attorney|lawyer|"
    r"legal|court|payment|invoice|refund|account balance|emergency|"
    r"hospital|clinic|insurance|claim)\b",
    re.IGNORECASE,
)


def extract_actions(turns: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Extract action items with owners, verbs, due dates, and sensitivity."""
    actions: list[dict[str, Any]] = []
    seen_verbs: set[str] = set()
    for turn in turns:
        text = turn.get("text", "")
        speaker = turn.get("speaker", "unknown").lower()
        owner = "agent" if speaker in ("agent", "assistant", "representative") else "callee"
        for match in ACTION_CUE.finditer(f"{speaker}: {text}."):
            verb_text = match.group("verb").strip().rstrip(".")
            verb_key = verb_text.lower()
            if verb_key in seen_verbs:
                continue
            seen_verbs.add(verb_key)
            due = None
            due_match = DUE_CUE.search(text)
            if due_match:
                due = due_match.group(1).lower()
            category = "logistics"
            sensitive = False
            if SENSITIVE_CUE.search(text):
                category = "sensitive"
                sensitive = True
            actions.append(
                {
                    "owner": owner,
                    "verb": verb_text,
                    "due": due,
                    "category": category,
                    "sensitive": sensitive,
                    "source_span": text.strip(),
                }
            )
    return actions


# ---------------------------------------------------------------------------
# Sentiment
# ---------------------------------------------------------------------------

POSITIVE_CUE = re.compile(
    r"\b(great|perfect|thank you|thanks|sounds good|yes,? i can|confirmed|happy to)\b",
    re.IGNORECASE,
)
NEGATIVE_CUE = re.compile(
    r"\b(no,?\s?i can'?t|can'?t make it|not able|frustrated|angry|unhappy|complaint|"
    r"this is unacceptable|i want to cancel)\b",
    re.IGNORECASE,
)
MIXED_CUE = re.compile(r"\b(but|however|although|i think so|maybe|probably|i guess)\b", re.IGNORECASE)


def detect_sentiment(flat: str) -> dict[str, str]:
    """Return a coarse sentiment label with a short justification."""
    if not flat.strip():
        return {"label": "unknown", "justification": "No respondent turn to classify."}
    low = flat.lower()
    pos = bool(POSITIVE_CUE.search(low))
    neg = bool(NEGATIVE_CUE.search(low))
    mixed = bool(MIXED_CUE.search(low))
    if pos and neg:
        return {"label": "mixed", "justification": "Both positive and negative cues present."}
    if neg:
        m = NEGATIVE_CUE.search(low)
        return {"label": "negative", "justification": m.group(1) if m else "Negative cue detected."}
    if mixed and not pos:
        return {"label": "mixed", "justification": "Hedged or qualified language present."}
    if pos:
        m = POSITIVE_CUE.search(low)
        return {"label": "positive", "justification": m.group(1) if m else "Positive cue detected."}
    return {"label": "neutral", "justification": "No strong sentiment cue detected."}


# ---------------------------------------------------------------------------
# Caller fingerprint
# ---------------------------------------------------------------------------


def caller_fingerprint(callee_masked: str, call_id: str) -> str:
    """Return a one-way hash of the redacted caller identity for dedup."""
    h = hashlib.sha256()
    h.update(callee_masked.encode("utf-8"))
    h.update(b"|")
    h.update(call_id.encode("utf-8"))
    return f"sha256:{h.hexdigest()[:12]}"


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def build_summary(turns: list[dict[str, str]]) -> str:
    """Build a masked, short prose summary from the turns."""
    if not turns:
        return "No transcript content to summarize."
    callee_turns = [t for t in turns if t.get("speaker") == "callee"]
    agent_turns = [t for t in turns if t.get("speaker") in ("agent", "assistant")]
    parts: list[str] = []
    if callee_turns:
        callee_text = callee_turns[0].get("text", "")
        if callee_text:
            parts.append(f"The callee said: {callee_text}.")
    if len(agent_turns) > 1:
        agent_text = agent_turns[-1].get("text", "")
        if agent_text:
            parts.append(f"The agent responded: {agent_text}.")
    if not parts:
        parts.append("The call completed with minimal dialogue.")
    summary = " ".join(parts)
    return mask_pii(summary)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def summarize(path: Path) -> dict[str, Any]:
    """Produce the full brief from a CALL-E call result file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    flat, turns = load_transcript(path)
    callee_masked = data.get("callee_masked", data.get("callee", "[redacted]"))
    call_id = data.get("call_id", "unknown")
    outcome = detect_outcome(flat)
    actions = extract_actions(turns)
    sentiment = detect_sentiment(flat)
    summary = build_summary(turns)
    brief = {
        "outcome": outcome,
        "summary": summary,
        "actions": actions,
        "sentiment": sentiment,
        "caller_fingerprint": caller_fingerprint(str(callee_masked), str(call_id)),
        "masked": True,
    }
    return brief


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transcript", required=True, help="Path to a CALL-E call result JSON file.")
    parser.add_argument("--out", default=None, help="Write the brief to this path (default: stdout).")
    args = parser.parse_args(argv)

    path = Path(args.transcript)
    if not path.is_file():
        print(f"ERROR: transcript file not found: {path}", file=sys.stderr)
        return 2

    try:
        brief = summarize(path)
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in transcript file: {exc}", file=sys.stderr)
        return 2

    output = json.dumps(brief, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(f"Brief written to {args.out}", file=sys.stderr)
    else:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
