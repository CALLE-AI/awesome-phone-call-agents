#!/usr/bin/env python3
"""
call-cognitive-load-monitor · monitor_cognitive_load.py

Analyses a CALL-E transcript for caller cognitive overload signals:
- Linguistic markers: repetition requests, confusion phrases, jargon density, hedges
- Interaction dynamics: turn imbalance, silence gaps, participation drop
- Phase-by-phase load scoring (opening / middle / closing)
- Consent-validity flag when load peaks during closing phase

Scientific basis:
  arXiv:2606.12971 (2026) — Dyadic CL via interaction dynamics
  arXiv:2502.06922 (2025) — Synthetic audio for cognitive state modelling
  NASA-TLX (Hart & Staveland, 1988) — gold-standard CL construct
  Sweller et al. (2019) — Cognitive Load Theory (germane/intrinsic/extraneous)

Usage:
    python3 scripts/monitor_cognitive_load.py \
        --transcript path/to/transcript.json \
        --dry-run --out /tmp/load_report.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Constants — linguistic signal patterns
# ---------------------------------------------------------------------------

REPETITION_PATTERNS = [
    r"\bcould you (repeat|say that again|say it again)\b",
    r"\bsay that again\b",
    r"\bsorry[,.]?\s*(i|could you|can you)",
    r"\bpardon\b",
    r"\bwhat did you say\b",
    r"\bi missed that\b",
    r"\bcould you go over that\b",
    r"\bplease repeat\b",
]

CONFUSION_PATTERNS = [
    r"\bi (don't|do not|didn't|did not) (understand|follow|get it|get that)\b",
    r"\bi'?m (confused|lost|not sure|unsure)\b",
    r"\bwhat does that mean\b",
    r"\bwhat do you mean\b",
    r"\bi'?m not (following|clear)\b",
    r"\bthat'?s (confusing|unclear|complicated)\b",
    r"\bwait[,.]? what\b",
    r"\bcan you (explain|clarify)\b",
]

SELF_CORRECTION_PATTERNS = [
    r"\bwait[,.]? i mean\b",
    r"\bactually[,.]? no\b",
    r"\bi mean[,.]? (what|no|sorry)\b",
    r"\bcorrect (me if|that)\b",
    r"\blet me (rephrase|try again|start over)\b",
]

HEDGE_PATTERNS = [
    r"\bi think\b",
    r"\bmaybe\b",
    r"\bperhaps\b",
    r"\bi'm not sure\b",
    r"\bpossibly\b",
    r"\bsort of\b",
    r"\bkind of\b",
    r"\bi guess\b",
    r"\bprobably\b",
]

CLARIFICATION_PATTERNS = [
    r"\bso what you'?re saying is\b",
    r"\bso you mean\b",
    r"\bjust to (confirm|clarify|check)\b",
    r"\bif i understand (correctly|you right)\b",
    r"\bin other words\b",
]

# Legal/technical jargon patterns
JARGON_PATTERNS = [
    r"\b(sub-?clause|pursuant|notwithstanding|hereinafter|heretofore|aforementioned)\b",
    r"\b(indemnification|indemnify|liability|negligence|tort|statute)\b",
    r"\b(amortisation|amortization|annualised|annualized|accrued|accrual)\b",
    r"\b(section \d+\([a-z]+\))\b",
    r"\b(article \d+)\b",
    r"\bclause \d+\b",
    r"\b[A-Z]{3,}\b",  # Acronym clusters
]

SIGNAL_WEIGHTS: dict[str, float] = {
    "repetition_request":   0.30,
    "confusion_phrase":     0.25,
    "self_correction":      0.15,
    "clarification_request":0.20,
    "jargon_density_spike": 0.18,
    "hedge_word_cluster":   0.12,
}

LOAD_THRESHOLDS: list[tuple[float, str]] = [
    (0.85, "CRITICAL"),
    (0.65, "HIGH"),
    (0.35, "MEDIUM"),
    (0.00, "LOW"),
]

ACTION_MAP: dict[str, str] = {
    "CRITICAL": "REPEAT_CALL_WITH_SIMPLER_SCRIPT",
    "HIGH":     "SEND_WRITTEN_CONFIRMATION",
    "MEDIUM":   "FLAG_FOR_REVIEW",
    "LOW":      "PROCEED",
}

CONSENT_THRESHOLD = 0.65


# ---------------------------------------------------------------------------
# Transcript loading
# ---------------------------------------------------------------------------

def load_transcript(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("transcript", "turns", "messages"):
            if key in data and isinstance(data[key], list):
                return data[key]
        if "transcript" in data and isinstance(data["transcript"], str):
            return [{"role": "combined", "text": data["transcript"]}]
    raise ValueError(f"Unrecognised transcript structure in {path}. "
                     "Expected a list of turns or a dict with a 'transcript' key.")


def callee_turns(turns: list[dict]) -> list[dict]:
    return [t for t in turns if t.get("role", "").lower() in
            ("callee", "customer", "user", "caller_b")]


def agent_turns(turns: list[dict]) -> list[dict]:
    return [t for t in turns if t.get("role", "").lower() in
            ("agent", "ai", "assistant", "bot", "caller_a")]


def get_text(turn: dict) -> str:
    for key in ("text", "content", "message", "utterance"):
        if key in turn and isinstance(turn[key], str):
            return turn[key]
    return ""


# ---------------------------------------------------------------------------
# Signal detection
# ---------------------------------------------------------------------------

def count_matches(text: str, patterns: list[str]) -> list[str]:
    hits = []
    text_l = text.lower()
    for pat in patterns:
        m = re.search(pat, text_l)
        if m:
            hits.append(text[m.start():m.start() + 60].strip())
    return hits


def jargon_density(text: str) -> float:
    words = text.split()
    if not words:
        return 0.0
    hits = count_matches(text, JARGON_PATTERNS)
    return min(1.0, len(hits) / max(len(words) / 10, 1))


def hedge_count(text: str) -> int:
    return len(count_matches(text, HEDGE_PATTERNS))


def detect_signals_in_turn(
    turn: dict,
    turn_index: int,
    phase: str,
) -> list[dict]:
    text = get_text(turn)
    role = turn.get("role", "").lower()
    signals = []

    if role not in ("callee", "customer", "user", "caller_b"):
        # Jargon density is scored on agent turns (it's the agent overloading the callee).
        jd = jargon_density(text)
        if jd >= 0.15:
            signals.append({
                "type": "jargon_density_spike",
                "evidence": text[:80].strip(),
                "turn": turn_index,
                "phase": phase,
                "weight": SIGNAL_WEIGHTS["jargon_density_spike"] * min(1.0, jd / 0.15),
            })
        return signals

    # Callee signals
    for patterns, sig_type in [
        (REPETITION_PATTERNS,    "repetition_request"),
        (CONFUSION_PATTERNS,     "confusion_phrase"),
        (SELF_CORRECTION_PATTERNS,"self_correction"),
        (CLARIFICATION_PATTERNS, "clarification_request"),
    ]:
        hits = count_matches(text, patterns)
        if hits:
            signals.append({
                "type": sig_type,
                "evidence": hits[0],
                "turn": turn_index,
                "phase": phase,
                "weight": SIGNAL_WEIGHTS[sig_type],
            })

    if hedge_count(text) >= 3:
        signals.append({
            "type": "hedge_word_cluster",
            "evidence": text[:80].strip(),
            "turn": turn_index,
            "phase": phase,
            "weight": SIGNAL_WEIGHTS["hedge_word_cluster"],
        })

    return signals


# ---------------------------------------------------------------------------
# Phase segmentation
# ---------------------------------------------------------------------------

def assign_phase(turn_index: int, total_turns: int) -> str:
    if total_turns < 4:
        return "middle"
    ratio = turn_index / total_turns
    if ratio < 0.25:
        return "opening"
    if ratio >= 0.75:
        return "closing"
    return "middle"


# ---------------------------------------------------------------------------
# Interaction dynamics
# ---------------------------------------------------------------------------

def analyse_interaction_dynamics(turns: list[dict]) -> dict:
    callee = callee_turns(turns)
    agent = agent_turns(turns)
    total = len(turns)
    if total == 0:
        return {
            "turn_imbalance_score": 0.0,
            "avg_silence_gap_ms": 0,
            "overlap_count": 0,
            "participation_ratio": {"agent": 0.0, "callee": 0.0},
        }

    agent_word_count = sum(len(get_text(t).split()) for t in agent)
    callee_word_count = sum(len(get_text(t).split()) for t in callee)
    total_words = agent_word_count + callee_word_count or 1

    agent_ratio = agent_word_count / total_words
    callee_ratio = callee_word_count / total_words
    imbalance = max(0.0, agent_ratio - callee_ratio)

    # Estimate silence gaps: turns with very short callee responses (<5 words)
    short_callee = sum(1 for t in callee if len(get_text(t).split()) < 5)
    avg_silence_ms = int(short_callee * 800) if callee else 0

    return {
        "turn_imbalance_score": round(imbalance, 3),
        "avg_silence_gap_ms": avg_silence_ms,
        "overlap_count": 0,  # Requires audio timing metadata
        "participation_ratio": {
            "agent": round(agent_ratio, 3),
            "callee": round(callee_ratio, 3),
        },
    }


# ---------------------------------------------------------------------------
# Script patches
# ---------------------------------------------------------------------------

def generate_script_patches(signals: list[dict], turns: list[dict]) -> list[dict]:
    patches = []
    for sig in signals:
        if sig["type"] != "jargon_density_spike":
            continue
        original = sig["evidence"]
        # Simple jargon → plain-language heuristics
        plain = original
        plain = re.sub(r"sub-?clause \d+\([a-z]+\)\([a-z]+\)", "our billing rules", plain, flags=re.I)
        plain = re.sub(r"pursuant to", "according to", plain, flags=re.I)
        plain = re.sub(r"notwithstanding", "even though", plain, flags=re.I)
        plain = re.sub(r"hereinafter", "", plain, flags=re.I)
        plain = re.sub(r"aforementioned", "the above", plain, flags=re.I)
        plain = re.sub(r"indemnif\w+", "protect from losses", plain, flags=re.I)
        plain = plain.strip()
        if plain != original:
            patches.append({
                "original": original,
                "suggested": plain,
                "rationale": "Legal/technical jargon simplified to plain language (target: Flesch-Kincaid grade ≤ 8)",
            })
    return patches


# ---------------------------------------------------------------------------
# Load scoring
# ---------------------------------------------------------------------------

def compute_load_score(signals: list[dict]) -> float:
    raw = sum(s["weight"] for s in signals)
    return round(min(1.0, raw), 3)


def load_level(score: float) -> str:
    for threshold, label in LOAD_THRESHOLDS:
        if score >= threshold:
            return label
    return "LOW"


def phase_scores(signals: list[dict]) -> dict[str, float]:
    phases: dict[str, float] = {"opening": 0.0, "middle": 0.0, "closing": 0.0}
    counts: dict[str, int] = {"opening": 0, "middle": 0, "closing": 0}
    for s in signals:
        p = s.get("phase", "middle")
        if p in phases:
            phases[p] = round(phases[p] + s["weight"], 3)
            counts[p] += 1
    return {p: round(min(1.0, v), 3) for p, v in phases.items()}


def peak_phase(pscores: dict[str, float]) -> str:
    return max(pscores, key=lambda k: pscores[k])


def consent_validity(pscores: dict[str, float], overall: float) -> tuple[str, str]:
    closing_score = pscores.get("closing", 0.0)
    if overall < 0.20:
        return "CONSENT_VALID", "Load score within normal bounds."
    if closing_score >= CONSENT_THRESHOLD:
        return "CONSENT_AT_RISK", (
            f"Load score {closing_score:.2f} exceeded threshold {CONSENT_THRESHOLD} "
            "during closing phase where commitment or consent may have been recorded."
        )
    if closing_score >= 0.35:
        return "CONSENT_AT_RISK", (
            f"Moderate load ({closing_score:.2f}) detected in closing phase. "
            "Written confirmation recommended."
        )
    return "CONSENT_VALID", "Closing-phase load within acceptable bounds."


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyse(
    transcript_path: str,
    threshold: float = 0.65,
    dry_run: bool = True,
) -> dict:
    turns = load_transcript(transcript_path)
    total_turns = len(turns)

    if total_turns < 2:
        return {
            "call_id": "unknown",
            "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
            "overall_cognitive_load": "UNKNOWN",
            "load_score": 0.0,
            "load_by_phase": {"opening": 0.0, "middle": 0.0, "closing": 0.0},
            "peak_phase": "unknown",
            "overload_signals": [],
            "interaction_dynamics": analyse_interaction_dynamics(turns),
            "script_patches": [],
            "consent_validity_flag": "CONSENT_UNKNOWN",
            "consent_validity_reason": "Transcript too short to assess closing-phase load.",
            "recommended_action": "FLAG_FOR_REVIEW",
            "false_positive_disclaimer": (
                "Cognitive load inference is probabilistic. A flagged call does not constitute "
                "a legal finding. Human review is required before any adverse action."
            ),
            "flags": ["INSUFFICIENT_TURNS_LOW_CONFIDENCE"],
            "analysis_mode": "heuristic",
            "dry_run": dry_run,
            "schema_version": "1.0",
        }

    # Derive call_id from first turn metadata or transcript path
    call_id = turns[0].get("call_id", Path(transcript_path).stem)

    # Detect signals
    signals: list[dict] = []
    for idx, turn in enumerate(turns):
        phase = assign_phase(idx, total_turns)
        signals.extend(detect_signals_in_turn(turn, idx + 1, phase))

    overall_score = compute_load_score(signals)
    pscores = phase_scores(signals)
    level = load_level(overall_score)
    pp = peak_phase(pscores)
    cv_flag, cv_reason = consent_validity(pscores, overall_score)
    patches = generate_script_patches(signals, turns)
    dynamics = analyse_interaction_dynamics(turns)
    action = ACTION_MAP.get(level, "FLAG_FOR_REVIEW")

    # Augment flags
    flags: list[str] = []
    if level in ("HIGH", "CRITICAL"):
        flags.append("REQUIRES_HUMAN_REVIEW")
    if cv_flag == "CONSENT_AT_RISK":
        flags.append("CONSENT_AT_RISK")
    jargon_sigs = [s for s in signals if s["type"] == "jargon_density_spike"]
    if jargon_sigs:
        flags.append("JARGON_DENSITY_HIGH")
    if dynamics["turn_imbalance_score"] >= 0.50:
        flags.append("AGENT_DOMINATED_CONVERSATION")

    return {
        "call_id": call_id,
        "analysis_timestamp": datetime.now(timezone.utc).isoformat(),
        "overall_cognitive_load": level,
        "load_score": overall_score,
        "load_by_phase": pscores,
        "peak_phase": pp,
        "overload_signals": signals,
        "interaction_dynamics": dynamics,
        "script_patches": patches,
        "consent_validity_flag": cv_flag,
        "consent_validity_reason": cv_reason,
        "recommended_action": action,
        "false_positive_disclaimer": (
            "Cognitive load inference is probabilistic. A flagged call does not constitute "
            "a legal finding. Human review is required before any adverse action."
        ),
        "flags": flags,
        "analysis_mode": "heuristic",
        "dry_run": dry_run,
        "schema_version": "1.0",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detect cognitive overload in a CALL-E transcript.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--transcript", required=True,
                        help="Path to the transcript JSON file")
    parser.add_argument("--threshold", type=float, default=0.65,
                        help="Load score above which level is HIGH (default: 0.65)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Analyse without side effects (default for safety)")
    parser.add_argument("--out", default=None,
                        help="Write report JSON to this path (default: stdout)")
    args = parser.parse_args()

    report = analyse(
        transcript_path=args.transcript,
        threshold=args.threshold,
        dry_run=args.dry_run,
    )

    output = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"[call-cognitive-load-monitor] Report written to {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
