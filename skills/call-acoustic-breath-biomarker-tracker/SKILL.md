---
name: call-acoustic-breath-biomarker-tracker
description: A telehealth phone-call agent skill that detects dyspnea and respiratory distress from acoustic markers (pause-to-speech ratio) and automatically escalates to a human operator.
version: 1.0.0
---

# Acoustic Breath Biomarker Tracker

This skill enables AI phone-call agents to analyze acoustic properties in real-time during a telehealth conversation to detect potential dyspnea (shortness of breath) or respiratory distress. By measuring the pause-to-speech ratio and detecting abnormal speech deceleration, the agent can interrupt the normal script and immediately trigger an emergency escalation (e.g., transferring to a registered nurse).

## How it works

1. The agent captures the user's speech stream via the microphone.
2. Voice Activity Detection (VAD) calculates the ratio of silence/pauses versus active speech during the caller's turns.
3. If the caller exhibits a high pause-to-speech ratio (e.g., needing to breathe between every 2-3 words), the `detect_dyspnea` function evaluates it against a clinical threshold.
4. If dyspnea is flagged, the agent halts the default workflow and invokes the emergency handoff skill.

## Use Cases
- Post-discharge monitoring for COPD or heart failure patients.
- Daily check-in phone calls for patients with severe asthma.
- Triage in automated telehealth intake systems.

## Integration
This skill runs concurrently with conversational dialogue models. It processes acoustic features decoupled from semantic meaning, ensuring it catches signs of distress even if the user does not explicitly say "I can't breathe."
