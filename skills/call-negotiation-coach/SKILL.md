---
name: call-negotiation-coach
description: Pre-call negotiation strategy engine and post-call debrief skill. Uses BATNA/ZOPA/Dual Concern Model theory to generate a structured strategy card before a negotiation call, then analyses the transcript to score outcome quality, detect anti-patterns, and return coaching notes. Backed by arXiv:2411.05816 (2024), AgenticPay arXiv (2026), NegotiationArena (2024), and the BATNA-aware reward design framework (2025).
license: MIT
---

# call-negotiation-coach

> **Prepare smarter. Debrief faster. Negotiate better — every call.**

Most negotiation calls happen without structured preparation and without any post-call analysis of whether value was actually created or left on the table. This skill applies game-theoretic negotiation science — BATNA, ZOPA, the Dual Concern Model, and LLM strategy research — to every negotiation call: generating a preparation card before the call and a debrief card after it.

---

## Why This Skill Exists

`hifi-hotel-negotiator` in this repository is a narrow, hotel-specific negotiation script. No skill applies **general principled negotiation theory** to arbitrary domains: procurement, collections, B2B sales, hiring, contract renewal, vendor pricing.

The research gap is equally real: 2025–2026 studies (AgenticPay, BATNA-aware LLM agents) show that standard frontier LLMs have an **"agreeableness bias"** — they accept deals they should reject. A skill that encodes BATNA awareness, ZOPA estimation, and the warmth-dominance balance explicitly outperforms unconstrained LLM negotiation.

---

## Scientific Foundation

| Paper / Source | Year | Relevance |
|---|---|---|
| **"LLM as Strategic Negotiator: Combining Dialogue Fluency with Explicit Strategy"** arXiv:2411.05816 | Nov 2024 | LLMs as meta-strategists; tit-for-tat, time-dependent concessions; beats unconstrained LLM baseline |
| **AgenticPay: Multi-Agent Negotiation Framework** arXiv | 2026 | Multi-agent buyer-seller simulation; BATNA-aware reward design prevents agreeableness bias |
| **NegotiationArena** arXiv | 2024 | Platform for probing irrational LLM negotiation behaviours; identifies common failure modes |
| **"Warmth × Dominance in AI Negotiation"** MIT Sloan | 2024 | Empirical: warmth + assertiveness beats either alone; pure agreeableness fails to claim value |
| **"BATNA-Aware Reward Design for LLM Agents"** ResearchGate | 2025 | Introduces "tunable utility floor" — the agent walks away below its BATNA; key for procurement |
| **Dual Concern Model** — Pruitt & Carnevale | *Social Conflict*, 1993 (foundational) | 2×2 concern matrix (self × other) → competing / collaborating / accommodating / avoiding |
| **Getting to Yes** — Fisher, Ury & Patton | 3rd ed. 2011 (foundational) | BATNA, ZOPA, interest-based vs position-based negotiation — the canonical framework |
| **"Rapport Building Strategies for Voice Agents"** INTERSPEECH | 2024 | Small talk, name use, shared-goal framing as evidence-backed openers for Steady/Influential counterparties |

Full citations: [`references/research-papers.md`](references/research-papers.md)

---

## Quick Start

### Mode 1 — Pre-call strategy card

```bash
python3 scripts/negotiation_coach.py prepare \
  --goal "Renew supplier contract at ≤5% price increase" \
  --batna "Switch to Supplier B — 15% higher but confirmed available" \
  --counterparty-disc "Steady" \
  --dry-run \
  --out /tmp/strategy_card.json
```

### Mode 2 — Post-call debrief

```bash
python3 scripts/negotiation_coach.py debrief \
  --transcript path/to/transcript.json \
  --strategy-card /tmp/strategy_card.json \
  --dry-run \
  --out /tmp/debrief_card.json
```

---

## Core Concepts

### BATNA — Best Alternative to a Negotiated Agreement
Your walk-away point. Any deal worse than your BATNA should be rejected. This skill encodes BATNA as an explicit numeric or qualitative floor — and flags in the debrief if the actual outcome violated it.

### ZOPA — Zone of Possible Agreement
The range between your floor and the counterparty's ceiling. Deals outside the ZOPA are impossible without changing alternatives. The skill estimates ZOPA from the stated positions and returns an overlap band.

### Dual Concern Model
Research-backed 2×2 matrix: how much you care about **your outcome** vs. **the relationship**:

| | High Self-Concern | Low Self-Concern |
|---|---|---|
| **High Other-Concern** | Collaborating (win-win) | Accommodating (lose-win) |
| **Low Other-Concern** | Competing (win-lose) | Avoiding (deadlock) |

The coach recommends a mode based on the stated goal and counterparty DISC archetype.

---

## Output — Strategy Card (Pre-call)

```json
{
  "negotiation_id": "neg-001",
  "mode": "prepare",
  "goal": "Renew supplier contract at ≤5% price increase",
  "batna": "Switch to Supplier B — 15% higher but confirmed available",
  "batna_floor": "+15% (the point at which walking away is rational)",
  "zopa_estimate": {
    "your_floor": "0% increase",
    "estimated_counterparty_ceiling": "+12%",
    "overlap_band": "0% to +12%"
  },
  "opening_anchor": "+8% — anchors high, leaves room for a visible concession",
  "dual_concern_mode": "Collaborating",
  "warmth_dominance_balance": "Lead with warmth (rapport); assert on substance",
  "counterparty_disc": "Steady",
  "tactic_sequence": [
    {
      "step": 1,
      "tactic": "rapport_building",
      "script_hint": "Acknowledge the long relationship and express appreciation before discussing numbers.",
      "rationale": "Steady-type counterparty: skipping rapport for numbers backfires. Research: INTERSPEECH 2024."
    },
    {
      "step": 2,
      "tactic": "anchor_high",
      "script_hint": "State your opening position as +8%. Do not justify it immediately.",
      "rationale": "Anchoring bias: first number shapes the perceived range. NegotiationArena 2024."
    },
    {
      "step": 3,
      "tactic": "label_their_concern",
      "script_hint": "It sounds like cost certainty matters more than the headline rate.",
      "rationale": "Labelling reduces reactance before offering a concession. Warmth×Dominance, MIT Sloan 2024."
    },
    {
      "step": 4,
      "tactic": "timed_concession",
      "script_hint": "Offer to move to +5% only if they commit to a 2-year term.",
      "rationale": "Time-dependent concessions — contingent trades increase joint value. arXiv:2411.05816."
    }
  ],
  "anti_patterns_to_avoid": [
    {"pattern": "pre_emptive_concession", "description": "Do not offer below +8% before they make a counter-offer."},
    {"pattern": "positional_bargaining", "description": "Focus on interests (cost certainty, supply stability) not positions."},
    {"pattern": "batna_reveal", "description": "Do not disclose Supplier B until you need the leverage."}
  ],
  "flags": [],
  "schema_version": "1.0"
}
```

## Output — Debrief Card (Post-call)

```json
{
  "negotiation_id": "neg-001",
  "mode": "debrief",
  "outcome_summary": "Agreed +4% increase with 18-month term extension.",
  "outcome_vs_batna": "ABOVE_BATNA",
  "outcome_vs_zopa": "WITHIN_ZOPA",
  "value_claimed_score": 0.72,
  "rapport_score": 0.85,
  "tactic_adherence": {
    "rapport_building": "EXECUTED",
    "anchor_high": "EXECUTED",
    "label_their_concern": "SKIPPED",
    "timed_concession": "PARTIALLY_EXECUTED"
  },
  "anti_patterns_detected": [
    {
      "pattern": "pre_emptive_concession",
      "evidence": "Offered +5% at turn 4 before counterparty responded to +8% anchor.",
      "turn": 4
    }
  ],
  "coaching_notes": [
    "Skipping step 3 (label_their_concern) before conceding may have left value on the table.",
    "The pre-emptive concession at turn 4 compressed the ZOPA unnecessarily. Wait for counterparty response before moving.",
    "Rapport was strong (0.85) — Steady counterparty responded well to the relationship acknowledgement."
  ],
  "next_call_recommendations": [
    "Practice the labelling tactic before the term-renegotiation call in Q1.",
    "Hold the anchor for at least 2 counterparty turns before conceding."
  ],
  "flags": ["PRE_EMPTIVE_CONCESSION_DETECTED"],
  "schema_version": "1.0"
}
```

---

## DISC × Negotiation Strategy Matrix

Integrates with `client-persona-profiler` — if you have a persona card for the counterparty, the coach auto-selects tactics:

| Counterparty DISC | Preferred Opening | Key Tactic | Avoid |
|---|---|---|---|
| **Dominant (D)** | Lead with outcomes and ROI | Direct anchor, short turns | Small talk, excessive rapport |
| **Influential (I)** | Lead with relationship and vision | Shared-goal framing | Pure numbers, legal language |
| **Steady (S)** | Lead with stability and trust | Step-by-step concessions | Surprises, aggressive anchors |
| **Analytical (C)** | Lead with data and precedent | Evidence-backed positions | Emotional appeals, vagueness |

---

## Command-Line Reference

```
usage: negotiation_coach.py <mode> [-h] [options]

Modes:
  prepare    Generate pre-call strategy card
  debrief    Analyse transcript and generate post-call debrief

Prepare options:
  --goal                 What you want to achieve (required)
  --batna                Your best alternative (required)
  --counterparty-disc    DISC archetype: Dominant|Influential|Steady|Analytical
  --concern-mode         Dual concern mode: competing|collaborating|accommodating
  --dry-run
  --out

Debrief options:
  --transcript           Path to transcript JSON (required)
  --strategy-card        Path to prepare-mode output card (required)
  --dry-run
  --out
```

---

## Integration with `client-persona-profiler`

Pass the persona card from `client-persona-profiler` directly as `--counterparty-disc`:

```bash
# Step 1: Profile the counterparty from their last call transcript
python3 ../client-persona-profiler/scripts/profile_caller.py \
  --transcript last_call.json --dry-run --out persona_card.json

# Step 2: Use the archetype to auto-configure negotiation tactics
python3 scripts/negotiation_coach.py prepare \
  --goal "Reduce annual licence fee by 10%" \
  --batna "Migrate to open-source alternative" \
  --counterparty-disc $(jq -r .persona_archetype persona_card.json) \
  --out strategy_card.json
```

---

## Files

```
skills/call-negotiation-coach/
├── SKILL.md
├── scripts/
│   ├── negotiation_coach.py          ← Prepare + debrief runner
│   ├── validate_negotiation_card.py  ← Output schema validator
│   └── test_negotiation_coach.py     ← Test suite (70+ assertions)
└── references/
    ├── negotiation-tactics.json      ← Tactic library (12 tactics)
    ├── disc-negotiation-matrix.json  ← DISC × tactic cross-reference
    ├── example-transcript.json       ← Sample negotiation transcript
    ├── examples.md                   ← Usage examples
    ├── research-papers.md            ← Full citations
    └── safety.md                     ← Ethics and safety reference
```
