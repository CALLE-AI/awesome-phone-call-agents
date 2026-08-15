# Scam-Signal Checklist & Scoring

Defines what the screener looks for in a call transcript and how those observations turn into a verdict. Detection of each signal is done by an LLM pass over the transcript (tag present/absent + supporting quote); scoring itself is a deterministic function over those tags, so every verdict is explainable and auditable by a human reviewer.

## Signal categories

### Critical — any single occurrence is sufficient to call it a scam

Legitimate companies never do these things over an inbound "you owe us" call, so no amount of other context offsets them.

| ID | Signal | Example trigger phrases |
|----|--------|--------------------------|
| C1 | Requests installation of remote-access software | "download AnyDesk / TeamViewer / UltraViewer / LogMeIn / Chrome Remote Desktop", "let me take control of your screen" |
| C2 | Requests payment via gift card, crypto, or wire transfer | "buy a Google Play / Apple / Amazon gift card", "send it via Bitcoin/USDT", "wire the funds to..." |
| C3 | Requests a one-time passcode / MFA code / full card PIN or CVV read aloud | "read me the code we just texted you", "what's the 3-digit number on the back" |

### High — strong indicators, weighted heavily but not decisive alone

| ID | Signal | Example trigger phrases |
|----|--------|--------------------------|
| H1 | Discourages independent verification | "don't call the number on your card, that will restart the process", "you have to resolve this with me right now" |
| H2 | Urgency/threat escalation, especially when questioned | "your account will be suspended today", "this is your final notice", "legal action will be taken" |
| H3 | Refuses or hedges on stating company name / department clearly | non-answer or deflection when asked "what company is this" |
| H4 | Cannot provide a callback number matching the company's published support line | mismatch or refusal to give a verifiable number |

### Medium — corroborating signals

| ID | Signal | Example trigger phrases |
|----|--------|--------------------------|
| M1 | No real hold music / IVR / call routing — straight to a live "closer" | (structural, observed from call flow rather than speech) |
| M2 | Inconsistent details vs. the claimed company's known practices | wrong department names, wrong product terminology, hours that don't match |
| M3 | Heavy reliance on a fixed script; poor handling of unexpected/clarifying questions | repeats same phrasing verbatim when asked something off-script |
| M4 | Generic, rehearsed phrasing inconsistent with the claimed company's normal tone | overly formal/scripted language a real support rep wouldn't use |

## Scoring

1. Run the transcript through the signal-tagger once per category list; each signal gets `present: bool` + `quote: str | null`.
2. Score:
   - If any Critical signal is present → **score is forced to max, verdict is Likely Scam**, regardless of other signals.
   - Otherwise: High = 3 points each, Medium = 1 point each.
3. Verdict thresholds (score out of remaining, non-critical signals):
   - **Likely Scam**: any critical signal, OR score ≥ 6
   - **Inconclusive — escalate to human review**: score 3–5
   - **Likely Legitimate**: score 0–2

## Output format (per screening call)

```json
{
  "verdict": "likely_scam | inconclusive | likely_legitimate",
  "score": 0,
  "triggered_signals": [
    {"id": "H2", "quote": "your account will be suspended today if you don't act now"}
  ],
  "transcript": "...",
  "call_metadata": {"number_dialed": "...", "duration_seconds": 0, "timestamp": "..."}
}
```

This is the object handed to the human/SOC queue — the agent stops here. No signal set, however severe, causes the agent to take any action beyond producing this record.

## Notes

- Signals are deliberately behavior-based (what the caller asks you to do) rather than voice/accent/nationality-based, to avoid discriminatory or unreliable heuristics.
- M1 (no IVR) is the weakest signal on its own — many small legitimate businesses also route straight to a person — so it's Medium, not High, and should rarely be the deciding factor by itself.
- The checklist is intentionally a flat, human-readable table so a SOC analyst reviewing an "Inconclusive" verdict can see exactly which signals fired and judge the transcript quote themselves.
