---
name: longitudinal-cognitive-decline-tracker
description: Analyzes longitudinal acoustic metadata across recurring phone calls to detect early signs of mild cognitive impairment (MCI).
version: 1.0.0
---

# Longitudinal Cognitive Decline Tracker

This skill analyzes metadata (specifically acoustic and pacing metrics) over a series of recurring welfare check calls to detect statistical degradation indicative of Mild Cognitive Impairment (MCI) or Alzheimer's Disease.

## Background
Voice has emerged as a reliable digital biomarker. By avoiding the storage of actual conversational text (transcripts) and only tracking acoustic metadata (like pause length and speech rate), this approach maintains strict HIPAA compliance while allowing for long-term health analytics.

## Scientific Basis
- **Acoustic Biomarkers**: Longer pauses and reduced speech rates strongly correlate with cognitive load and early-stage dementia.
- **Foundation Models**: Utilizing accurate, frame-level diarization to capture precise timing rather than manual analysis.
- **Longitudinal Trend Analysis**: Evaluating slopes over multiple time intervals (e.g., weekly) provides far more clinical validity than single-point-in-time assessments.

## Usage
```python
from cognitive_tracker import analyze_longitudinal_biomarkers

report = analyze_longitudinal_biomarkers(historical_metadata)
if report["CLINICAL_REVIEW_RECOMMENDED"]:
    alert_medical_professional(report["degradation_slope"])
```
