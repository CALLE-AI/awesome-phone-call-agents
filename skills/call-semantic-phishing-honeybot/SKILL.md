---
name: call-semantic-phishing-honeybot
description: Offline experimental text-turn helper for phone scam-review demonstrations. Extracts candidate IoCs and suggests bait responses; it does not place, intercept, or answer calls.
version: 1.0.0
---

# Semantic Phishing Honeybot

The supplied helper uses regex over synthetic transcript text and returns candidate URLs, wallet strings, phone-like strings, and predefined response suggestions. It does not determine that a person is a scammer, operate a call, browse extracted URLs, or send threat reports. Any future engagement must be operator-authorized, bounded, stoppable, and separate from this offline demonstration.

## Scientific Foundation

| Paper / Concept | Relevance |
|---|---|
| **Active Defense & Honeybots** | Email scam-baiting research motivates this design; it does not establish phone-call duration or effectiveness. |
| **Social Engineering Taxonomy** | Uses established psychological countermeasures (acting confused, feigning compliance) to trigger the scammer into repeating technical instructions (IoCs). |
| **Vishing Kill-Chain Analysis** | Targets the "Action/Exploitation" phase of the voice phishing kill chain to capture the final payload (e.g. the Bitcoin wallet). |

## How it works

1. Supply a synthetic transcript turn and fictional caller identifier; no call is answered or intercepted.
2. The helper applies regex to the text to extract candidate indicators.
3. It dynamically generates a `bait_prompt` tailored to the scammer's current objective:
    - If the scammer wants Bitcoin, the bot feigns ignorance about crypto to drag out the call.
    - If the scammer provides a URL, the bot pretends its antivirus blocked it to gather alternative domains.
4. Candidates are returned in `HoneybotResponse`; they are neither verified nor automatically logged/shared.

## Expected Outcomes & Metrics

These are unvalidated design targets for a future integration, not measurements or effects of the local helper.

| Metric | Target | Notes |
|---|---|---|
| IoC Extraction Rate | > 75% | Successfully pulling a wallet or URL from a known scam script. |
| Call Duration (Stalling) | > 5 mins | Time wasted per scammer. |

## Limitations & Known Constraints
- **Pattern Matching Limits**: The current IoC extraction relies on basic regex (e.g. base58 for Bitcoin). It may miss newer or obfuscated wallet formats.
- **Integration Boundary**: No LLM or calling loop is included. A future host must impose an operator-controlled stop and duration limit; returned `continue_baiting` is a suggestion, not authority to continue a call.
