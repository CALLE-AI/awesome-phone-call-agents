---
name: longitudinal-cognitive-decline-tracker
description: Offline experimental reference that calculates pause-duration trends from synthetic call metadata for human review; not a cognitive assessment or diagnosis.
version: 1.0.0
---

# Longitudinal Cognitive Decline Tracker

The `longitudinal-cognitive-decline-tracker` skill illustrates a simple trend calculation on supplied synthetic call metadata. It neither records calls nor extracts acoustic features. Its pause-duration threshold is a demonstration choice, not a validated marker of cognitive impairment. Do not use its output to diagnose, triage, or automatically change anyone's care.

## Prototype Scope

This implementation has no clinical validation. See [research scope](references/research-papers.md) for the limits of its research and privacy claims.

## How it works

The skill receives a history of synthetic call metadata and sorts it by timestamp.
1. It extracts the `avg_pause_ms` (average pause length in milliseconds) for each call.
2. It calculates a linear regression slope against session index, not elapsed time.
3. If the slope exceeds 50ms per session, `clinical_review_recommended` is set to true as an advisory demonstration flag. This legacy field name does not establish a clinical finding.

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| Degradation Sensitivity | Not established | No clinical dataset evaluation is supplied; the prototype does not measure statistical significance. |

## Limitations & Known Constraints
- **Data Dependency**: Requires a minimum of 3 historical data points to establish a trend.
- **Environmental Factors**: Does not account for temporary conditions (e.g., fatigue, medication effects) that might cause an isolated spike in pause lengths.
- **Not a Diagnosis**: Use only synthetic no-call examples. A pause trend does not establish cognitive decline or rule it out.
