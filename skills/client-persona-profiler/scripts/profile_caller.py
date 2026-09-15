#!/usr/bin/env python3
"""
client-persona-profiler · profile_caller.py

Analyses a CALL-E transcript to detect caller persona (DISC archetype),
compute an RFMAP loyalty score, and return a structured persona card.

Usage (dry-run, no LLM, no writes):
    python3 profile_caller.py \
        --transcript references/example-transcript.json \
        --profile-dir /tmp/profiles/ \
        --dry-run \
        --out /tmp/persona_card.json

No external packages required for heuristic mode.
Set OPENAI_API_KEY (or CALLE_LLM_ENDPOINT) for LLM-assisted scoring.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = "1.0"
MIN_TURNS_DEFAULT = 4

# DISC linguistic markers — keyword weights per dimension.
# Source: adapted from DISC validation research (Bonnstetter et al., 2009).
DISC_MARKERS: dict[str, list[str]] = {
    "D": [
        "immediately", "decision", "result", "bottom line", "direct",
        "efficient", "control", "challenge", "bottom line", "decisive",
        "now", "fast", "action", "lead", "take charge",
    ],
    "I": [
        "excited", "collaborate", "together", "feel", "inspire",
        "relationship", "story", "share", "fun", "enthusiastic",
        "people", "team", "connect", "energy", "amazing",
    ],
    "S": [
        "stable", "consistent", "patient", "step by step", "reliable",
        "support", "family", "careful", "steady", "process",
        "routine", "safe", "loyal", "understand", "comfortable",
    ],
    "C": [
        "accurate", "data", "verify", "policy", "detail",
        "standard", "correct", "procedure", "confirm", "analysis",
        "specific", "evidence", "documentation", "systematic", "precise",
    ],
}

ARCHETYPE_LABELS: dict[str, str] = {
    "D": "Dominant",
    "I": "Influential",
    "S": "Steady",
    "C": "Analytical",
}

SENTIMENT_LABELS = ("very_negative", "negative", "neutral", "positive", "very_positive")

CHURN_RISK_MAP = [
    (80, "low"),
    (55, "medium"),
    (0,  "high"),
]

LOYALTY_TIER_MAP = [
    (80, "champion"),
    (60, "high_value"),
    (40, "at_risk"),
    (0,  "low_value"),
]

# ---------------------------------------------------------------------------
# Transcript loading
# ---------------------------------------------------------------------------

def load_transcript(path: str) -> list[dict]:
    """Load a CALL-E transcript from a JSON file.

    Accepts both a list of turn objects and a call-result wrapper that
    contains a ``transcript`` key.
    """
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "transcript" in data:
        raw = data["transcript"]
        if isinstance(raw, list):
            return raw
        # Plain text transcript — wrap as a single pseudo-turn.
        return [{"role": "unknown", "text": str(raw)}]
    raise ValueError(
        f"Cannot parse transcript from {path!r}. "
        "Expected a list of turns or a dict with a 'transcript' key."
    )


def extract_text(turns: list[dict]) -> str:
    """Concatenate all turn texts into a single lower-cased string."""
    parts: list[str] = []
    for turn in turns:
        text = turn.get("text") or turn.get("content") or turn.get("message") or ""
        parts.append(str(text).lower())
    return " ".join(parts)


# ---------------------------------------------------------------------------
# DISC scoring (heuristic)
# ---------------------------------------------------------------------------

def score_disc_heuristic(text: str) -> dict[str, float]:
    """Compute raw DISC dimension scores from keyword frequency."""
    scores: dict[str, float] = {dim: 0.0 for dim in DISC_MARKERS}
    word_count = max(len(text.split()), 1)
    for dim, keywords in DISC_MARKERS.items():
        hits = sum(text.count(kw) for kw in keywords)
        scores[dim] = hits / word_count
    total = sum(scores.values()) or 1.0
    return {dim: round(v / total, 4) for dim, v in scores.items()}


def dominant_archetype(
    disc: dict[str, float],
    margin: float = 0.15,
) -> tuple[str, str]:
    """Return (archetype_key, confidence_label).

    Returns ``("?", "undetermined")`` when the leading dimension does not
    exceed the second by ``margin``.
    """
    sorted_dims = sorted(disc.items(), key=lambda x: x[1], reverse=True)
    top_key, top_val = sorted_dims[0]
    second_val = sorted_dims[1][1] if len(sorted_dims) > 1 else 0.0
    if top_val - second_val < margin:
        return "?", "undetermined"
    confidence = "high" if top_val - second_val >= 0.25 else "moderate"
    return top_key, confidence


# ---------------------------------------------------------------------------
# Sentiment (heuristic)
# ---------------------------------------------------------------------------

POSITIVE_WORDS = {"great", "thanks", "perfect", "happy", "excellent", "good",
                  "appreciate", "wonderful", "sure", "absolutely", "yes"}
NEGATIVE_WORDS = {"frustrated", "unhappy", "terrible", "awful", "angry",
                  "disappointed", "never", "cancel", "refuse", "horrible", "no"}


def score_sentiment_turn(text: str) -> str:
    low = text.lower()
    pos = sum(1 for w in POSITIVE_WORDS if w in low)
    neg = sum(1 for w in NEGATIVE_WORDS if w in low)
    if pos > neg + 1:
        return "positive"
    if neg > pos + 1:
        return "negative"
    return "neutral"


def sentiment_trajectory(turns: list[dict]) -> list[str]:
    callee_turns = [
        t for t in turns
        if t.get("role", "").lower() in ("callee", "user", "customer", "unknown")
    ] or turns
    return [score_sentiment_turn(t.get("text", "")) for t in callee_turns]


def sentiment_trend(trajectory: list[str]) -> str:
    label_to_int = {s: i for i, s in enumerate(SENTIMENT_LABELS)}
    values = [label_to_int.get(s, 2) for s in trajectory]
    if len(values) < 2:
        return "stable"
    delta = values[-1] - values[0]
    if delta >= 1:
        return "improving"
    if delta <= -1:
        return "declining"
    return "stable"


# ---------------------------------------------------------------------------
# RFMAP loyalty scoring
# ---------------------------------------------------------------------------

def compute_rfmap(
    interaction_count: int,
    first_seen_days_ago: int,
    last_seen_days_ago: int,
) -> int:
    """Simplified RFMAP score (0-100).

    Recency (R): lower last_seen → higher score.
    Frequency (F): more interactions → higher score.
    Activation Periods (AP): spread of activity over time.

    Extended from RFMAP model (ResearchGate, 2024).
    """
    recency_score = max(0.0, 1.0 - last_seen_days_ago / 90)
    frequency_score = min(1.0, interaction_count / 10)
    spread = first_seen_days_ago - last_seen_days_ago
    ap_score = min(1.0, spread / 180) if first_seen_days_ago > 0 else 0.0
    raw = (recency_score * 0.45 + frequency_score * 0.35 + ap_score * 0.20)
    return round(raw * 100)


def loyalty_tier(score: int) -> str:
    for threshold, label in LOYALTY_TIER_MAP:
        if score >= threshold:
            return label
    return "low_value"


def churn_risk(score: int) -> str:
    for threshold, label in CHURN_RISK_MAP:
        if score >= threshold:
            return label
    return "high"


# ---------------------------------------------------------------------------
# Profile store (JSONL, one file per caller token)
# ---------------------------------------------------------------------------

def caller_token(raw_id: str) -> str:
    digest = hashlib.sha256(raw_id.encode()).hexdigest()
    return f"sha256:{digest[:16]}"


def profile_path(profile_dir: Path, token: str) -> Path:
    safe = token.replace(":", "_").replace("/", "_")
    return profile_dir / f"{safe}.jsonl"


def load_profile(profile_dir: Path, token: str) -> list[dict]:
    path = profile_path(profile_dir, token)
    if not path.exists():
        return []
    records: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def append_profile(profile_dir: Path, token: str, record: dict) -> None:
    profile_dir.mkdir(parents=True, exist_ok=True)
    path = profile_path(profile_dir, token)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Playbook lookup
# ---------------------------------------------------------------------------

def load_playbooks(playbook_path: str) -> dict[str, Any]:
    with open(playbook_path, encoding="utf-8") as fh:
        return json.load(fh)


def select_playbook(archetype_key: str, playbooks: dict) -> dict:
    label = ARCHETYPE_LABELS.get(archetype_key, "Unknown")
    return playbooks.get(label, playbooks.get("Unknown", {}))


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyse(
    transcript_path: str,
    profile_dir: Path,
    caller_id_override: str | None,
    playbook_file: str,
    min_turns: int,
    dry_run: bool,
) -> dict:
    turns = load_transcript(transcript_path)
    full_text = extract_text(turns)

    # Derive caller token from transcript or override.
    raw_id = caller_id_override or (
        full_text[:64]  # Fallback: first 64 chars of transcript text.
    )
    token = caller_token(raw_id)

    # Load existing profile history.
    history = load_profile(profile_dir, token)
    interaction_count = len(history) + 1  # Including this call.

    # Compute time deltas from history.
    now_ts = int(time.time())
    if history:
        first_seen_days_ago = max(
            0, (now_ts - history[0].get("ts", now_ts)) // 86400
        )
        last_seen_days_ago = max(
            0, (now_ts - history[-1].get("ts", now_ts)) // 86400
        )
    else:
        first_seen_days_ago = 0
        last_seen_days_ago = 0

    # DISC scoring.
    disc = score_disc_heuristic(full_text)
    arch_key, arch_confidence = dominant_archetype(disc)
    archetype_label = ARCHETYPE_LABELS.get(arch_key, "Undetermined")

    # Sentiment.
    traj = sentiment_trajectory(turns)
    trend = sentiment_trend(traj)

    # RFMAP.
    rfmap = compute_rfmap(interaction_count, first_seen_days_ago, last_seen_days_ago)
    tier = loyalty_tier(rfmap)
    risk = churn_risk(rfmap)

    # Playbooks.
    playbooks = load_playbooks(playbook_file)
    playbook = select_playbook(arch_key, playbooks)

    # Flags.
    flags: list[str] = []
    if arch_confidence == "undetermined":
        flags.append("UNDETERMINED_ARCHETYPE")
    if len(turns) < min_turns:
        flags.append("LOW_TURN_COUNT")
    if risk == "high":
        flags.append("CHURN_RISK_ELEVATED")

    # Build the record for this interaction.
    interaction_record: dict = {
        "ts": now_ts,
        "disc": disc,
        "rfmap": rfmap,
        "sentiment_trend": trend,
    }

    if not dry_run:
        append_profile(profile_dir, token, interaction_record)

    persona_card: dict = {
        "caller_token": token,
        "interaction_count": interaction_count,
        "first_seen_days_ago": first_seen_days_ago,
        "last_seen_days_ago": last_seen_days_ago,
        "persona_archetype": archetype_label,
        "disc_scores": disc,
        "archetype_confidence": arch_confidence,
        "sentiment_trajectory": traj,
        "sentiment_trend": trend,
        "rfmap_loyalty_score": rfmap,
        "loyalty_tier": tier,
        "churn_risk": risk,
        "call_driver": "unknown",  # Populated by LLM path when available.
        "recommended_playbook": playbook,
        "flags": flags,
        "analysis_mode": "heuristic",
        "dry_run": dry_run,
        "profile_version": interaction_count,
        "schema_version": SCHEMA_VERSION,
    }

    return persona_card


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Analyse a CALL-E transcript and produce a caller persona card."
    )
    p.add_argument("--transcript", required=True, help="Path to the transcript JSON file.")
    p.add_argument(
        "--profile-dir",
        default="./profiles/",
        help="Directory to read and write caller profiles (default: ./profiles/).",
    )
    p.add_argument("--caller-id", default=None, help="Override the caller identity token.")
    p.add_argument(
        "--playbook",
        default=str(Path(__file__).parent.parent / "references" / "disc-playbooks.json"),
        help="Path to the DISC playbook JSON file.",
    )
    p.add_argument(
        "--min-turns",
        type=int,
        default=MIN_TURNS_DEFAULT,
        help=f"Minimum turns before archetype is emitted (default: {MIN_TURNS_DEFAULT}).",
    )
    p.add_argument("--dry-run", action="store_true", help="Analyse without writing to profile store.")
    p.add_argument("--out", default=None, help="Write persona card JSON to this path (default: stdout).")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    card = analyse(
        transcript_path=args.transcript,
        profile_dir=Path(args.profile_dir),
        caller_id_override=args.caller_id,
        playbook_file=args.playbook,
        min_turns=args.min_turns,
        dry_run=args.dry_run,
    )
    output = json.dumps(card, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"Persona card written to {args.out}", file=sys.stderr)
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
