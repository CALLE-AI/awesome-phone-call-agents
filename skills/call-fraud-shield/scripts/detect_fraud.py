#!/usr/bin/env python3
"""
call-fraud-shield · detect_fraud.py

Analyses a CALL-E transcript for vishing, spam, social engineering,
and scam-script patterns. Returns a structured risk card
with XAI-explained evidence spans and a recommended action.

Usage (dry-run, heuristic mode):
    python3 detect_fraud.py \
        --transcript references/example-transcript.json \
        --dry-run \
        --out /tmp/risk_card.json

No external packages required. Heuristic mode only; no LLM call is made.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0"
MIN_TURNS_FOR_LEVEL = 3  # Below this turn count the skill abstains (risk_level UNKNOWN).

# ---------------------------------------------------------------------------
# Threat taxonomy
# ---------------------------------------------------------------------------

THREAT_CATEGORIES = frozenset(
    ["SPAM", "VISHING", "SOCIAL_ENGINEERING", "SCAM_SCRIPT"]
)

RECOMMENDED_ACTIONS = ["PROCEED", "FLAG_FOR_REVIEW", "CAUTION_ADVISE_USER", "TERMINATE_AND_ALERT"]

# ---------------------------------------------------------------------------
# Heuristic signal libraries
# ---------------------------------------------------------------------------

# Urgency / time-pressure language signals.
URGENCY_PATTERNS = [
    r"\bimmediately\b", r"\bright now\b", r"\bwithin \d+ (minute|hour|day)",
    r"\blast chance\b", r"\bexpire[sd]?\b", r"\bsuspend(ed)?\b",
    r"\bact now\b", r"\bdo not hang up\b", r"\burgent\b", r"\bemergency\b",
    r"\blimited time\b", r"\btoday only\b",
]

# Authority impersonation signals.
AUTHORITY_PATTERNS = [
    r"\b(irs|tax authority|government|federal|police|officer|detective)\b",
    r"\b(bank|financial institution|fraud department)\b.*\b(calling|contacting)\b",
    r"\b(microsoft|apple|google|amazon|paypal)\b.*\b(support|security|team)\b",
    r"\byour account (has been|will be) (compromised|suspended|frozen)\b",
]

# Credential / money extraction signals.
CREDENTIAL_PATTERNS = [
    r"\b(otp|one.time.password|verification code|pin|password|ssn|social security)\b",
    r"\b(wire transfer|bitcoin|gift card|google play|itunes|voucher)\b",
    r"\b(bank account|routing number|credit card|card number|cvv)\b",
    r"\bdo not tell anyone\b", r"\bkeep this confidential\b",
]

# Fear induction signals.
FEAR_PATTERNS = [
    r"\b(arrest(ed)?|lawsuit|legal action|court|warrant)\b",
    r"\b(lose your home|lose your savings|criminal charges)\b",
    r"\b(virus|malware|hacked|compromised)\b",
]

# Spam indicators.
SPAM_PATTERNS = [
    r"\b(congratulations|you('ve| have) (won|been selected))\b",
    r"\b(free|complimentary|no cost|zero cost)\b.*\b(offer|trial|gift)\b",
    r"\bdo not miss (out|this)\b",
    r"\b(survey|prize|reward|sweepstakes|lottery)\b",
]


def find_signals(text: str, patterns: list[str]) -> list[str]:
    """Return all non-overlapping matching substrings for a pattern list."""
    matches: list[str] = []
    for pattern in patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            matches.append(m.group(0))
    return matches


# ---------------------------------------------------------------------------
# Transcript loading
# ---------------------------------------------------------------------------

def load_transcript(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "transcript" in data:
        raw = data["transcript"]
        if isinstance(raw, list):
            return raw
        return [{"role": "unknown", "text": str(raw)}]
    raise ValueError(
        f"Cannot parse transcript from {path!r}. "
        "Expected a list of turns or a dict with a 'transcript' key."
    )


def extract_text(turns: list[dict]) -> str:
    return " ".join(
        str(t.get("text") or t.get("content") or t.get("message") or "")
        for t in turns
    )


# ---------------------------------------------------------------------------
# Scam archetype matching
# ---------------------------------------------------------------------------

def load_archetypes(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def match_archetypes(text: str, archetypes: list[dict]) -> list[dict]:
    """Return archetypes whose keyword set has sufficient hits in text."""
    matched: list[dict] = []
    low = text.lower()
    for arch in archetypes:
        keywords: list[str] = arch.get("keywords", [])
        threshold: int = arch.get("match_threshold", 2)
        hits = sum(1 for kw in keywords if kw.lower() in low)
        if hits >= threshold:
            matched.append({"archetype": arch["name"], "keyword_hits": hits})
    return matched


# ---------------------------------------------------------------------------
# Trajectory analysis (heuristic)
# ---------------------------------------------------------------------------

def build_trajectory(turns: list[dict]) -> dict:
    """Compute a simplified trajectory: does threat signal density grow?"""
    all_texts = [
        str(t.get("text") or t.get("content") or "").lower()
        for t in turns
    ]
    n = len(all_texts)
    if n < 2:
        return {"escalating": False, "density_trend": "flat"}

    mid = n // 2
    first_half = " ".join(all_texts[:mid])
    second_half = " ".join(all_texts[mid:])

    all_patterns = (
        URGENCY_PATTERNS + AUTHORITY_PATTERNS + CREDENTIAL_PATTERNS + FEAR_PATTERNS
    )

    def density(text: str) -> float:
        hits = sum(
            len(list(re.finditer(p, text, re.IGNORECASE))) for p in all_patterns
        )
        return hits / max(len(text.split()), 1)

    first_d = density(first_half)
    second_d = density(second_half)

    escalating = second_d > first_d * 1.3
    if second_d > first_d * 1.5:
        trend = "sharply_escalating"
    elif escalating:
        trend = "escalating"
    elif second_d < first_d * 0.7:
        trend = "de_escalating"
    else:
        trend = "flat"

    return {"escalating": escalating, "density_trend": trend}


# ---------------------------------------------------------------------------
# Risk aggregation
# ---------------------------------------------------------------------------

def compute_risk_score(trigger_signals: list[dict]) -> float:
    total = sum(s.get("weight", 0.0) for s in trigger_signals)
    return round(min(total, 1.0), 4)


def risk_level(score: float, threshold: float) -> str:
    if score >= 0.85:
        return "CRITICAL"
    if score >= threshold:
        return "HIGH"
    if score >= 0.35:
        return "MEDIUM"
    return "LOW"


def recommended_action(level: str) -> str:
    return {
        "CRITICAL": "TERMINATE_AND_ALERT",
        "HIGH":     "CAUTION_ADVISE_USER",
        "MEDIUM":   "FLAG_FOR_REVIEW",
        "LOW":      "PROCEED",
    }.get(level, "FLAG_FOR_REVIEW")


# ---------------------------------------------------------------------------
# XAI explanation builder
# ---------------------------------------------------------------------------

def build_xai_explanation(
    trigger_signals: list[dict],
    matched_archetypes: list[dict],
    trajectory: dict,
    risk_lvl: str,
) -> str:
    parts: list[str] = []
    if risk_lvl in ("CRITICAL", "HIGH"):
        parts.append(f"Risk level is {risk_lvl}.")
    top = sorted(trigger_signals, key=lambda s: s.get("weight", 0), reverse=True)[:2]
    for sig in top:
        parts.append(
            f"Signal '{sig['type']}' detected (weight {sig.get('weight', 0):.2f}): "
            f"\"{sig.get('evidence', '')}\"."
        )
    if matched_archetypes:
        names = ", ".join(a["archetype"] for a in matched_archetypes[:2])
        parts.append(f"Matches known scam-script archetype(s): {names}.")
    if trajectory.get("escalating"):
        parts.append(
            f"Conversational trajectory is {trajectory['density_trend']}: "
            "threat-signal density increases in the second half of the call."
        )
    return " ".join(parts) or "No significant fraud signals detected."


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyse(
    transcript_path: str,
    archetypes_path: str,
    threshold: float,
    dry_run: bool,
) -> dict:
    turns = load_transcript(transcript_path)
    full_text = extract_text(turns)

    archetypes = load_archetypes(archetypes_path)

    # Collect trigger signals.
    trigger_signals: list[dict] = []

    urgency_hits = find_signals(full_text, URGENCY_PATTERNS)
    if urgency_hits:
        trigger_signals.append({
            "type": "urgency_language",
            "evidence": urgency_hits[0],
            "weight": min(0.15 * len(urgency_hits), 0.40),
        })

    authority_hits = find_signals(full_text, AUTHORITY_PATTERNS)
    if authority_hits:
        trigger_signals.append({
            "type": "authority_impersonation",
            "evidence": authority_hits[0],
            "weight": min(0.20 * len(authority_hits), 0.45),
        })

    credential_hits = find_signals(full_text, CREDENTIAL_PATTERNS)
    if credential_hits:
        trigger_signals.append({
            "type": "credential_request",
            "evidence": credential_hits[0],
            "weight": min(0.25 * len(credential_hits), 0.55),
        })

    fear_hits = find_signals(full_text, FEAR_PATTERNS)
    if fear_hits:
        trigger_signals.append({
            "type": "fear_induction",
            "evidence": fear_hits[0],
            "weight": min(0.15 * len(fear_hits), 0.35),
        })

    spam_hits = find_signals(full_text, SPAM_PATTERNS)
    if spam_hits:
        trigger_signals.append({
            "type": "spam_signal",
            "evidence": spam_hits[0],
            "weight": min(0.10 * len(spam_hits), 0.30),
        })

    matched_archetypes = match_archetypes(full_text, archetypes)
    if matched_archetypes:
        trigger_signals.append({
            "type": "scam_script_match",
            "evidence": f"Matches archetype: {matched_archetypes[0]['archetype']}",
            "weight": min(0.15 * len(matched_archetypes), 0.35),
        })

    trajectory = build_trajectory(turns)

    # Determine threat categories.
    threat_categories: list[str] = []
    if any(s["type"] == "spam_signal" for s in trigger_signals):
        threat_categories.append("SPAM")
    if any(s["type"] in ("authority_impersonation", "credential_request") for s in trigger_signals):
        threat_categories.append("VISHING")
    if any(s["type"] in ("urgency_language", "fear_induction") for s in trigger_signals):
        threat_categories.append("SOCIAL_ENGINEERING")
    if any(s["type"] == "scam_script_match" for s in trigger_signals):
        threat_categories.append("SCAM_SCRIPT")

    overall_score = compute_risk_score(trigger_signals)
    rl = risk_level(overall_score, threshold)
    action = recommended_action(rl)

    # Abstention: with fewer than MIN_TURNS_FOR_LEVEL turns the trajectory
    # evidence is too thin for a confident level. Keep the signals visible
    # but refuse to label the call (see references/safety.md).
    if len(turns) < MIN_TURNS_FOR_LEVEL:
        rl = "UNKNOWN"
        action = "FLAG_FOR_REVIEW"

    xai = build_xai_explanation(trigger_signals, matched_archetypes, trajectory, rl)

    trajectory_assessment = (
        f"Conversational trajectory is {trajectory['density_trend']}."
        if trajectory["escalating"]
        else "No significant escalation detected in conversational trajectory."
    )

    harm_projection = (
        "If the call continues, the next moves likely escalate toward "
        "credential extraction or a payment request."
        if trajectory["escalating"]
        else "No escalation pattern detected; trajectory appears benign."
    )

    flags: list[str] = []
    if rl in ("CRITICAL", "HIGH"):
        flags.append("REQUIRES_HUMAN_REVIEW")
    if len(turns) < 3:
        flags.append("INSUFFICIENT_TURNS_LOW_CONFIDENCE")

    call_id = "unknown"
    if isinstance(turns, list) and turns:
        call_id = turns[0].get("call_id", "unknown")

    risk_card: dict = {
        "call_id": call_id,
        "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
        "overall_risk_score": overall_score,
        "risk_level": rl,
        "threat_categories": threat_categories,
        "trigger_signals": trigger_signals,
        "trajectory_assessment": trajectory_assessment,
        "harm_projection": harm_projection,
        "recommended_action": action,
        "xai_explanation": xai,
        "false_positive_disclaimer": (
            "This is a probabilistic risk signal, not a legal finding. "
            "A human must review before any adverse action is taken. "
            "Legitimate institutions do not request OTPs, gift cards, or wire transfers by phone."
        ),
        "flags": flags,
        "analysis_mode": "heuristic",
        "dry_run": dry_run,
        "schema_version": SCHEMA_VERSION,
    }

    return risk_card


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Analyse a CALL-E transcript for fraud and vishing patterns."
    )
    p.add_argument("--transcript", required=True, help="Path to the transcript JSON file.")
    p.add_argument(
        "--archetypes",
        default=str(
            Path(__file__).parent.parent / "references" / "scam-archetypes.json"
        ),
        help="Path to the scam archetype library JSON.",
    )
    p.add_argument(
        "--threshold",
        type=float,
        default=0.50,
        help="Risk score above which risk_level is HIGH (default: 0.50).",
    )
    p.add_argument("--dry-run", action="store_true", help="Analyse without side effects.")
    p.add_argument("--out", default=None, help="Write risk card JSON to this path (default: stdout).")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    card = analyse(
        transcript_path=args.transcript,
        archetypes_path=args.archetypes,
        threshold=args.threshold,
        dry_run=args.dry_run,
    )
    output = json.dumps(card, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"Risk card written to {args.out}", file=sys.stderr)
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
