---
name: call-negotiation-coach
description: Pre-call strategy engine and post-call debrief for negotiation calls. Implements BATNA/ZOPA/Dual Concern Model + DISC-matched tactics.
version: 1.0.0
---

# Negotiation Coach

The `call-negotiation-coach` skill acts as a pre-call strategy generator and post-call debrief analyzer. It arms AI agents (or human agents) with customized negotiation tactics based on the counterparty's DISC profile and tracks adherence to those tactics in the post-call transcript.

## Experimental Scope

This offline reference organizes familiar negotiation concepts into tactic cards and heuristic debriefs. It does not implement a validated negotiation policy, enforce a BATNA, accept deals, or execute financial actions. Research attributions and performance targets are not validation of this prototype; see [research scope](references/research-papers.md).

## How it works

### 1. Pre-Call (Prepare Mode)
Generates a structured `strategy_card.json` containing:
- Goal and BATNA floor threshold.
- A customized sequence of tactics matched to the counterparty's DISC personality type.
- A Dual Concern Mode profile (e.g. Collaborating).

### 2. Post-Call (Debrief Mode)
Analyzes the transcript against the `strategy_card` to:
- Score tactic execution (EXECUTED vs SKIPPED).
- Detect Anti-Patterns (e.g., pre-emptive concessions, emotional capitulation).
- Flag if the BATNA was violated (i.e. the agent accepted a deal worse than the walk-away point).

## Decision Matrix

### DISC Tactic Mapping

| DISC Profile | Core Tactics |
|---|---|
| **Dominant** | Anchor high, Timed concession, BATNA reference, Conditional close |
| **Influential** | Rapport building, Interest exploration, Label emotion, Conditional close |
| **Steady** | Rapport building, Label emotion, Timed concession, Interest exploration |
| **Analytical** | Interest exploration, Anchor high, Timed concession, BATNA reference |

### Anti-Patterns Detected

| Anti-Pattern | Description |
|---|---|
| `pre_emptive_concession` | Conceding before the counterparty responds to the anchor. |
| `positional_bargaining` | Arguing strictly on numbers instead of underlying interests. |
| `batna_reveal` | Prematurely disclosing the walk-away alternative. |
| `emotional_capitulation` | Conceding due to emotional pressure (e.g. "I'm sorry you are angry, let me lower the price"). |

## Expected Outcomes & Metrics

The following numbers are unvalidated aspirations, not measured results or guarantees.

| Metric | Target | Notes |
|---|---|---|
| Anti-pattern detection TPR | > 85% | Pattern-matching on well-known concession phrases. |
| BATNA Violation Flags | 100% precision | If numerical BATNA is strictly breached, it must flag. |

## Limitations & Known Constraints
- **Heuristic Pattern Matching**: The debrief engine relies on regex-based heuristics which may miss nuanced, highly sophisticated phrasing.
- **Numeric BATNA Extraction**: The `_batna_violated` function currently only supports percentage-based BATNAs (e.g. "15%"). Currency-based extraction requires future NLP upgrades.
