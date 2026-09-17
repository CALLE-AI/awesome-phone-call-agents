#!/usr/bin/env python3
"""
call-negotiation-coach · negotiation_coach.py

Pre-call strategy engine and post-call debrief for negotiation calls.
Implements BATNA/ZOPA/Dual Concern Model + DISC-matched tactics.

Scientific basis:
  arXiv:2411.05816 (Nov 2024) — LLM as strategic negotiator with explicit tactics
  AgenticPay arXiv (2026) — BATNA-aware reward design; multi-agent buyer-seller framework
  NegotiationArena (2024) — Probing irrational LLM negotiation behaviours
  MIT Sloan Warmth×Dominance (2024) — Warmth + assertiveness maximises joint value
  BATNA-Aware Reward Design (ResearchGate, 2025) — Tunable utility floor for walk-away
  Dual Concern Model — Pruitt & Carnevale (1993)
  Fisher, Ury & Patton — Getting to Yes, 3rd ed. (2011)
  INTERSPEECH 2024 — Rapport building strategies for voice agents

Usage:
    # Pre-call
    python3 scripts/negotiation_coach.py prepare \
        --goal "Renew at ≤5% price increase" \
        --batna "Supplier B — 15% higher" \
        --counterparty-disc Steady \
        --dry-run --out /tmp/strategy_card.json

    # Post-call
    python3 scripts/negotiation_coach.py debrief \
        --transcript transcript.json \
        --strategy-card /tmp/strategy_card.json \
        --dry-run --out /tmp/debrief.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Tactic library (backed by arXiv:2411.05816, NegotiationArena, MIT Sloan 2024)
# ---------------------------------------------------------------------------

TACTIC_LIBRARY: dict[str, dict] = {
    "rapport_building": {
        "description": "Open with shared history, express appreciation, establish trust.",
        "rationale": "Steady and Influential counterparties respond poorly to immediate transactional openers. INTERSPEECH 2024: name use and appreciation framing increases subsequent concession willingness.",
        "script_hint": "Acknowledge the relationship before discussing numbers.",
    },
    "anchor_high": {
        "description": "State an opening position above your target to shape the perceived range.",
        "rationale": "Anchoring bias: the first number uttered anchors the negotiation range. NegotiationArena 2024: agents that anchor strongly achieve higher utility floors.",
        "script_hint": "State your opening figure confidently. Do not justify it immediately.",
    },
    "label_emotion": {
        "description": "Name the counterparty's concern explicitly before offering a concession.",
        "rationale": "MIT Sloan Warmth×Dominance (2024): labelling reduces reactance and increases perceived empathy, enabling larger concession to be received positively.",
        "script_hint": "It sounds like cost certainty matters more than the headline rate.",
    },
    "timed_concession": {
        "description": "Offer a concession contingent on a reciprocal commitment (term, volume, speed).",
        "rationale": "arXiv:2411.05816: contingent concessions increase joint value vs unconditional price drops. Time-dependent patterns prevent value leak.",
        "script_hint": "I can move to [X] if you can commit to [Y-term/volume].",
    },
    "batna_reference": {
        "description": "Reference your BATNA as a credible walk-away alternative.",
        "rationale": "AgenticPay 2026: BATNA-aware reward designs prevent agents from accepting sub-optimal deals. Fisher & Ury: BATNA sets the true walk-away threshold.",
        "script_hint": "We do have an alternative arrangement we could pursue, though we would prefer to resolve this with you.",
    },
    "interest_exploration": {
        "description": "Ask open questions to surface underlying interests beyond stated positions.",
        "rationale": "Getting to Yes (Fisher & Ury): interest-based negotiation produces durable agreements; position-based bargaining leads to deadlock.",
        "script_hint": "What's most important to you in how this contract works going forward?",
    },
    "silence": {
        "description": "Allow 3–5 seconds of silence after making a strong point or anchoring.",
        "rationale": "Research on negotiation dynamics shows that silence after an anchor creates psychological pressure for the counterparty to respond and potentially concede.",
        "script_hint": "State your figure, then wait. Resist the urge to fill the silence.",
    },
    "conditional_close": {
        "description": "Propose a conditional agreement that both sides can accept.",
        "rationale": "MIT Sloan 2024: conditional offers reduce impasse rates by giving both sides a face-saving path to agreement.",
        "script_hint": "If you can confirm [condition] today, I'm authorised to agree to [outcome].",
    },
}

DISC_TACTIC_MATRIX: dict[str, list[str]] = {
    "Dominant":    ["anchor_high", "timed_concession", "batna_reference", "conditional_close"],
    "Influential": ["rapport_building", "interest_exploration", "label_emotion", "conditional_close"],
    "Steady":      ["rapport_building", "label_emotion", "timed_concession", "interest_exploration"],
    "Analytical":  ["interest_exploration", "anchor_high", "timed_concession", "batna_reference"],
    "Unknown":     ["rapport_building", "anchor_high", "label_emotion", "timed_concession"],
}

CONCERN_MODE_MAP: dict[str, dict] = {
    "collaborating": {
        "label": "Collaborating",
        "description": "High concern for own outcome AND for relationship. Seek win-win.",
        "warmth": "high",
        "dominance": "high",
    },
    "competing": {
        "label": "Competing",
        "description": "High concern for own outcome, low concern for relationship. Claim maximum value.",
        "warmth": "low",
        "dominance": "high",
    },
    "accommodating": {
        "label": "Accommodating",
        "description": "Low concern for own outcome, high concern for relationship. Preserve goodwill.",
        "warmth": "high",
        "dominance": "low",
    },
    "avoiding": {
        "label": "Avoiding",
        "description": "Low concern for both. Delay or disengage.",
        "warmth": "low",
        "dominance": "low",
    },
}

ANTI_PATTERNS: list[dict] = [
    {
        "pattern": "pre_emptive_concession",
        "description": "Conceding before the counterparty responds to your anchor.",
        "detection": [r"\bi can go (lower|down|to)\b", r"\bwe could do\b", r"\bactually[,.]? let me offer\b"],
    },
    {
        "pattern": "positional_bargaining",
        "description": "Arguing about positions rather than exploring underlying interests.",
        "detection": [r"\bwe will not go (above|below|under|over)\b", r"\bthat'?s our final offer\b"],
    },
    {
        "pattern": "batna_reveal",
        "description": "Disclosing your BATNA before using it as leverage.",
        "detection": [r"\bwe'?ve been (talking|speaking|negotiating) with (another|a different|other)\b"],
    },
    {
        "pattern": "emotional_capitulation",
        "description": "Conceding because of emotional pressure rather than logic.",
        "detection": [r"\bi understand you'?re (frustrated|upset|angry)\b.*\b(so|therefore|thus) we can\b"],
    },
]

# ---------------------------------------------------------------------------
# Transcript loader
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
    return []


def get_text(turn: dict) -> str:
    for key in ("text", "content", "message", "utterance"):
        if key in turn and isinstance(turn[key], str):
            return turn[key]
    return ""


# ---------------------------------------------------------------------------
# PREPARE mode
# ---------------------------------------------------------------------------

def prepare(
    goal: str,
    batna: str,
    counterparty_disc: str = "Unknown",
    concern_mode: str = "collaborating",
    dry_run: bool = True,
) -> dict:
    disc_key = counterparty_disc if counterparty_disc in DISC_TACTIC_MATRIX else "Unknown"
    tactic_keys = DISC_TACTIC_MATRIX[disc_key]
    mode = CONCERN_MODE_MAP.get(concern_mode.lower(), CONCERN_MODE_MAP["collaborating"])

    tactic_sequence = [
        {
            "step": i + 1,
            "tactic": key,
            "description": TACTIC_LIBRARY[key]["description"],
            "script_hint": TACTIC_LIBRARY[key]["script_hint"],
            "rationale": TACTIC_LIBRARY[key]["rationale"],
        }
        for i, key in enumerate(tactic_keys)
        if key in TACTIC_LIBRARY
    ]

    # BATNA floor heuristic: extract first percentage or currency mentioned
    batna_floor_note = (
        f"Walk away if outcome is worse than: {batna}"
    )

    return {
        "negotiation_id": str(uuid.uuid4())[:8],
        "mode": "prepare",
        "goal": goal,
        "batna": batna,
        "batna_floor_note": batna_floor_note,
        "zopa_note": (
            "Estimate ZOPA by subtracting your floor from the counterparty's likely ceiling. "
            "Any deal within that band is reachable without BATNA leverage."
        ),
        "dual_concern_mode": mode["label"],
        "dual_concern_description": mode["description"],
        "warmth_dominance_balance": f"warmth={mode['warmth']}, dominance={mode['dominance']}",
        "counterparty_disc": disc_key,
        "tactic_sequence": tactic_sequence,
        "anti_patterns_to_avoid": [
            {"pattern": ap["pattern"], "description": ap["description"]}
            for ap in ANTI_PATTERNS
        ],
        "false_positive_disclaimer": (
            "This strategy card is a structured starting point, not a guarantee of outcome. "
            "Negotiation involves real-time adaptation. Human judgement is always required."
        ),
        "flags": [],
        "analysis_mode": "heuristic",
        "dry_run": dry_run,
        "schema_version": "1.0",
    }


# ---------------------------------------------------------------------------
# DEBRIEF mode
# ---------------------------------------------------------------------------

def debrief(
    transcript_path: str,
    strategy_card: dict,
    dry_run: bool = True,
) -> dict:
    turns = load_transcript(transcript_path)
    full_text = " ".join(get_text(t) for t in turns).lower()

    # Detect anti-patterns in transcript
    detected_anti = []
    for ap in ANTI_PATTERNS:
        for pat in ap.get("detection", []):
            if re.search(pat, full_text):
                detected_anti.append({
                    "pattern": ap["pattern"],
                    "evidence": _find_evidence(turns, pat),
                })
                break

    # Score tactic adherence
    tactic_adherence: dict[str, str] = {}
    for step in strategy_card.get("tactic_sequence", []):
        key = step["tactic"]
        hint = step.get("script_hint", "").lower()
        hint_words = [w for w in re.findall(r"\w+", hint) if len(w) > 4]
        matched = any(w in full_text for w in hint_words) if hint_words else False
        tactic_adherence[key] = "EXECUTED" if matched else "SKIPPED"

    # Value score heuristic: did they mention an agreement/deal?
    agreement_signals = [
        r"\bwe agree\b", r"\bthat'?s agreed\b", r"\bdeal\b", r"\bwe('?ll| will) go with\b",
        r"\bconfirmed\b", r"\baccept\b", r"\bsigned\b",
    ]
    reached_agreement = any(re.search(p, full_text) for p in agreement_signals)
    batna_violated = _batna_violated(full_text, strategy_card.get("batna", ""))

    # Coaching notes
    notes: list[str] = []
    skipped = [k for k, v in tactic_adherence.items() if v == "SKIPPED"]
    if "rapport_building" in skipped:
        notes.append("Rapport building was skipped. For Steady/Influential counterparties this may have reduced receptivity to your anchor.")
    if "label_emotion" in skipped:
        notes.append("Emotion labelling was skipped before the main concession. Consider using it next time to reduce reactance.")
    if detected_anti:
        for da in detected_anti:
            notes.append(f"Anti-pattern detected: {da['pattern']}. Review the transcript evidence.")
    if batna_violated:
        notes.append("WARNING: The outcome may have fallen below your stated BATNA. Review the agreement terms.")
    if not notes:
        notes.append("Execution was clean. No major anti-patterns detected.")

    return {
        "negotiation_id": strategy_card.get("negotiation_id", "unknown"),
        "mode": "debrief",
        "goal": strategy_card.get("goal", ""),
        "batna": strategy_card.get("batna", ""),
        "reached_agreement": reached_agreement,
        "batna_violated": batna_violated,
        "tactic_adherence": tactic_adherence,
        "anti_patterns_detected": detected_anti,
        "coaching_notes": notes,
        "next_call_recommendations": _next_recommendations(skipped, detected_anti),
        "false_positive_disclaimer": (
            "This debrief is based on heuristic pattern matching of the transcript. "
            "Complex negotiation dynamics may not be fully captured. Human review recommended."
        ),
        "flags": (["BATNA_VIOLATED"] if batna_violated else []) +
                 (["ANTI_PATTERN_DETECTED"] if detected_anti else []),
        "analysis_mode": "heuristic",
        "dry_run": dry_run,
        "schema_version": "1.0",
    }


def _find_evidence(turns: list[dict], pattern: str) -> str:
    for turn in turns:
        text = get_text(turn)
        m = re.search(pattern, text.lower())
        if m:
            return text[max(0, m.start() - 10): m.end() + 40].strip()[:100]
    return ""


def _batna_violated(full_text: str, batna: str) -> bool:
    # Heuristic: if BATNA contains a percentage and transcript contains an agreed value
    # worse than that, flag it. For non-numeric BATNA, return False (requires human review).
    pct = re.search(r"(\d+)\s*%", batna)
    if not pct:
        return False
    batna_pct = int(pct.group(1))
    agreed = re.findall(r"(\d+)\s*%", full_text)
    for a in agreed:
        if int(a) > batna_pct:
            return True
    return False


def _next_recommendations(skipped: list[str], anti: list[dict]) -> list[str]:
    recs: list[str] = []
    if "rapport_building" in skipped:
        recs.append("Practice the rapport opener before the next call with this counterparty.")
    if "label_emotion" in skipped:
        recs.append("Rehearse the emotion-labelling tactic: 'It sounds like [X] matters more than [Y].'")
    for da in anti:
        if da["pattern"] == "pre_emptive_concession":
            recs.append("Hold your anchor for at least 2 counterparty turns before moving.")
        if da["pattern"] == "batna_reveal":
            recs.append("Keep your BATNA confidential until you need it as explicit leverage.")
    if not recs:
        recs.append("Maintain current approach. Review BATNA before next negotiation cycle.")
    return recs


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Negotiation strategy engine: prepare a call or debrief after one.",
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    # Prepare
    prep = sub.add_parser("prepare", help="Generate a pre-call strategy card")
    prep.add_argument("--goal", required=True, help="What you want to achieve")
    prep.add_argument("--batna", required=True, help="Your best alternative (walk-away point)")
    prep.add_argument("--counterparty-disc",
                      choices=["Dominant", "Influential", "Steady", "Analytical", "Unknown"],
                      default="Unknown")
    prep.add_argument("--concern-mode",
                      choices=["collaborating", "competing", "accommodating", "avoiding"],
                      default="collaborating")
    prep.add_argument("--dry-run", action="store_true")
    prep.add_argument("--out", default=None)

    # Debrief
    deb = sub.add_parser("debrief", help="Analyse a transcript and generate a debrief card")
    deb.add_argument("--transcript", required=True)
    deb.add_argument("--strategy-card", required=True, help="Path to prepare-mode output JSON")
    deb.add_argument("--dry-run", action="store_true")
    deb.add_argument("--out", default=None)

    args = parser.parse_args()

    if args.mode == "prepare":
        result = prepare(
            goal=args.goal,
            batna=args.batna,
            counterparty_disc=args.counterparty_disc,
            concern_mode=args.concern_mode,
            dry_run=args.dry_run,
        )
    else:
        card = json.loads(Path(args.strategy_card).read_text(encoding="utf-8"))
        result = debrief(
            transcript_path=args.transcript,
            strategy_card=card,
            dry_run=args.dry_run,
        )

    output = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"[call-negotiation-coach] Output written to {args.out}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
