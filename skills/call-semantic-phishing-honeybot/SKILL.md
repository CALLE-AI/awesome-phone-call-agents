---
name: call-semantic-phishing-honeybot
description: An active defense phone call honeybot that engages voice phishers (vishing) to extract Indicators of Compromise (IoCs) and stall attacks.
version: 1.0.0
---

# Semantic Phishing Honeybot

The `call-semantic-phishing-honeybot` skill is an active cyber-defense tool. Rather than simply blocking known spam numbers, this skill actively engages suspected scammers in conversation, using semantic baiting techniques to extract actionable threat intelligence (IoCs) like cryptocurrency wallets, malicious URLs, and drop-phone numbers.

## Scientific Foundation

| Paper / Concept | Relevance |
|---|---|
| **Active Defense & Honeybots (2024)** | Demonstrates that conversational LLMs can keep scammers on the line for an average of 14 minutes, significantly increasing the cost of their operations. |
| **Social Engineering Taxonomy** | Uses established psychological countermeasures (acting confused, feigning compliance) to trigger the scammer into repeating technical instructions (IoCs). |
| **Vishing Kill-Chain Analysis** | Targets the "Action/Exploitation" phase of the voice phishing kill chain to capture the final payload (e.g. the Bitcoin wallet). |

## How it works

1. The bot answers or intercepts a call from a flagged/untrusted number.
2. It processes the scammer's speech in real-time, using regex and NLP to identify requested actions (e.g. "go to this website" or "send Bitcoin").
3. It dynamically generates a `bait_prompt` tailored to the scammer's current objective:
    - If the scammer wants Bitcoin, the bot feigns ignorance about crypto to drag out the call.
    - If the scammer provides a URL, the bot pretends its antivirus blocked it to gather alternative domains.
4. Extracted IoCs are logged in the `HoneybotResponse` for threat intelligence sharing.

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| IoC Extraction Rate | > 75% | Successfully pulling a wallet or URL from a known scam script. |
| Call Duration (Stalling) | > 5 mins | Time wasted per scammer. |

## Limitations & Known Constraints
- **Pattern Matching Limits**: The current IoC extraction relies on basic regex (e.g. base58 for Bitcoin). It may miss newer or obfuscated wallet formats.
- **Resource Exhaustion**: Running an LLM indefinitely to stall a scammer can incur high token costs.
