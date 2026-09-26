# Monetization Safety and Ethics

## Non-negotiables

1. Never paywall urgent care, core safety, privacy controls, or essential offline functionality.
2. Never use health attributes, triage state, or inferred vulnerability for pricing or upsells.
3. Never store payment credentials in the Expo client.
4. Never claim live billing is production-ready unless verified with real providers.

## Upsell rules

- Contextual upgrades only at operational limits (call credits, exports, seats).
- No monetization prompts during urgent-risk or distress flows.
- AI plan advisor uses **catalog facts only** — no invented prices or refund terms.

## Prohibited pricing signals

`triage_state`, `diagnosis`, `pregnancy_risk`, `distress_score`, `vulnerability_index`

## Analytics

Revenue events exclude names, phone numbers, care notes, transcripts, and beneficiary IDs.
