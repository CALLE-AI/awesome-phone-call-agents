---
name: longitudinal-cognitive-decline-tracker
description: Monitors long-term acoustic call metadata across multiple phone sessions to detect early clinical markers of cognitive decline (e.g., Alzheimer's, Dementia).
version: 1.0.0
---

# Longitudinal Cognitive Decline Tracker

The `longitudinal-cognitive-decline-tracker` skill analyzes metadata across multiple voice sessions (phone calls) with the same caller to identify subtle, long-term degradation in speech patterns. By analyzing metrics like average pause duration (`avg_pause_ms`), it can flag significant deterioration that warrants clinical review.

## Scientific Foundation

| Paper / Concept | Relevance |
|---|---|
| **Voice as a Biomarker for Dementia (2023)** | Demonstrates that increased pause frequency and duration during spontaneous speech are early indicators of mild cognitive impairment (MCI). |
| **Longitudinal Speech Analytics (2025)** | Shows that tracking intra-patient variance over months is more accurate than cross-sectional comparisons against a population baseline. |

## How it works

The skill receives a chronological history of a patient's call metadata.
1. It extracts the `avg_pause_ms` (average pause length in milliseconds) for each call.
2. It calculates the linear regression slope of this metric over time.
3. If the slope exceeds the degradation threshold (e.g., pause lengths increasing by >50ms per session on average), it flags `CLINICAL_REVIEW_RECOMMENDED`.

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| Degradation Sensitivity | > 85% | Detecting statistically significant increases in pause times over a 6+ month window. |

## Limitations & Known Constraints
- **Data Dependency**: Requires a minimum of 3 historical data points to establish a trend.
- **Environmental Factors**: Does not account for temporary conditions (e.g., fatigue, medication effects) that might cause an isolated spike in pause lengths.
- **Not a Diagnosis**: This tool flags anomalous trends for medical review; it cannot diagnose any condition.
