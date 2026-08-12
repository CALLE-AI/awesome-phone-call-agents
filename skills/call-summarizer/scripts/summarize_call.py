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


# Speaker-role labels that represent the contacted party (the callee). Any
# other label is treated as the agent side. This keeps outcome detection
# grounded in the callee's own words, not in the agent's prompts.
CALLEE_ROLES = {"callee", "customer", "patient", "caller", "recipient"}


def _callee_effective_text(turns: list[dict[str, str]]) -> str:
    """Return the callee's latest non-trivial response text.

    "Effective" means we skip empty, placeholder, and no-answer turns such as
    "(no response)" so a trailing machine placeholder cannot be misread as a
    decline or a confirmation. If the callee never spoke effectively, this
    returns an empty string and the caller must fail closed to "unknown".
    """
    placeholder_re = re.compile(r"^\s*(?:\(no response\)|\(silence\)|\(no answer\)|\(voicemail\)|\.\.\.)\s*$", re.IGNORECASE)
    effective: list[str] = []
    for turn in turns:
        speaker = str(turn.get("speaker", "")).lower().strip()
        if speaker not in CALLEE_ROLES:
            continue
        text = str(turn.get("text", "")).strip()
        if not text or placeholder_re.match(text):
            continue
        effective.append(text)
    return effective[-1] if effective else ""


def _classify_callee_response(text: str) -> str:
    """Classify a single callee utterance. Returns one of the OUTCOME_CUES
    labels, or 'unknown' when no cue matches."""
    if not text.strip():
        return "unknown"
    low = text.lower()
    for label, pattern in OUTCOME_CUES:
        if re.search(pattern, low):
            return label
    return "unknown"


def detect_outcome(turns: list[dict[str, str]]) -> str:
    """Return a one-line outcome grounded in the callee's latest effective
    response.

    Per review item #2, outcome detection must consider only the callee's own
    words (the agent asking "can you confirm?" must not be read as a
    confirmation) and must fail closed (return 'unknown') when the callee's
    responses contradict one another.
    """
    if not turns:
        return "unknown"
    callee_text = _callee_effective_text(turns)
    if not callee_text:
        # The callee never spoke effectively (no-answer / voicemail path).
        # Detect those system-level signals from the full transcript so the
        # caller still gets a meaningful outcome line, but never "confirmed"
        # or "declined" from agent-only text.
        flat_low = " ".join(t.get("text", "") for t in turns).lower()
        if re.search(OUTCOME_CUES[3][1], flat_low):  # no-answer cue
            return "No answer; call ended without contact."
        if re.search(OUTCOME_CUES[4][1], flat_low):  # voicemail cue
            return "Voicemail reached; no live contact."
        return "unknown"

    latest = _classify_callee_response(callee_text)
    if latest in ("no-answer", "voicemail"):
        # A callee explicitly saying "no answer"/"voicemail" is a system-style
        # signal; keep the dedicated outcome lines for those.
        if latest == "no-answer":
            return "No answer; call ended without contact."
        return "Voicemail reached; no live contact."

    # Fail-closed contradiction check: gather every distinct cue the callee
    # produced across the call. If the latest cue conflicts with an earlier
    # positive/decline cue (e.g., "yes" earlier then "can't" later, or vice
    # versa), we refuse to assert an outcome and fail closed to "unknown".
    callee_utterances = [
        str(t.get("text", ""))
        for t in turns
        if str(t.get("speaker", "")).lower().strip() in CALLEE_ROLES
        and str(t.get("text", "")).strip()
    ]
    seen_labels: set[str] = set()
    for utt in callee_utterances:
        lab = _classify_callee_response(utt)
        if lab and lab != "unknown":
            seen_labels.add(lab)
    contradiction_pairs = {("confirmed", "declined"), ("confirmed", "rescheduled"), ("declined", "rescheduled")}
    for a, b in contradiction_pairs:
        if a in seen_labels and b in seen_labels and latest in (a, b):
            return "unknown"

    if latest == "confirmed":
        return "Appointment or request confirmed."
    if latest == "declined":
        return "Request declined by the callee."
    if latest == "rescheduled":
        return "Reschedule requested."
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
                    "verb": mask_pii(verb_text),
                    "due": due,
                    "category": category,
                    "sensitive": sensitive,
                    "source_span": mask_pii(text.strip()),
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


def caller_fingerprint(callee_masked: str, caller_id: str | None = None) -> str:
    """Return a one-way hash of a stable caller identity for dedup.

    Per review item #3, the fingerprint must be stable across calls from the
    same caller. We therefore deliberately exclude `call_id` (which is unique
    per call) and instead hash a stable caller identity input.

    Preference order for the stable identity:
      1. `caller_id` — an explicit, operator-provided stable caller identifier
         (e.g., a CRM contact id, a normalized phone number), if present.
      2. `callee_masked` — the caller's masked phone number, e.g.
         "+155****1234". This is already redacted (so we do not hash raw PII)
         and is stable across calls from the same number.

    We hash whichever identity we use so the fingerprint is one-way and the
    raw identifier cannot be recovered from it. If neither field is available,
    we fail closed and return a fingerprint of the literal string "unknown"
    rather than mixing in `call_id` (which would silently break dedup).
    """
    stable = ""
    if caller_id and str(caller_id).strip():
        stable = str(caller_id).strip()
    elif callee_masked and str(callee_masked).strip() and str(callee_masked).strip() != "[redacted]":
        stable = str(callee_masked).strip()
    else:
        stable = "unknown"
    h = hashlib.sha256()
    h.update(stable.encode("utf-8"))
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
    caller_id = data.get("caller_id")  # optional stable caller identifier
    outcome = detect_outcome(turns)
    actions = extract_actions(turns)
    sentiment = detect_sentiment(flat)
    summary = build_summary(turns)
    brief = {
        "outcome": outcome,
        "summary": summary,
        "actions": actions,
        "sentiment": sentiment,
        "caller_fingerprint": caller_fingerprint(str(callee_masked), caller_id),
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
