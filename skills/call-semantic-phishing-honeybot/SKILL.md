---
name: call-semantic-phishing-honeybot
description: An inbound phone-call agent skill that acts as a honeybot to bait scammers, prolonging the call to extract threat intelligence (TTPs) for reporting.
version: 1.0.0
---

# Semantic Phishing Honeybot

This skill transforms an AI phone-call agent into an active defense mechanism ("scam-baiting"). When a known spam/scam number calls, the agent adopts a vulnerable persona to keep the scammer engaged for as long as possible. During the conversation, it dynamically extracts Threat Intelligence (TTPs, crypto wallets, bank drop accounts, fake domains) using semantic extraction.

## How it works

1. The agent intercepts inbound calls flagged as spam.
2. It uses a "vulnerable persona" prompt (e.g., an elderly person struggling with technology) to encourage the scammer to reveal their operation.
3. The LLM continuously extracts entities like URLs, Phone Numbers, and Financial Accounts from the scammer's speech.
4. When the call ends, a STIX/TAXII formatted report is generated for potential sharing with CISA or telecom providers.

## Use Cases
- Active defense for telecom providers to waste scammers' resources.
- Threat intelligence gathering for cybersecurity teams.
- Validating and classifying new phone-based social engineering campaigns.

## Integration
This skill replaces the standard conversational agent prompt with an adversarial "Bot Wars" persona prompt, specifically tuned to maximize call duration and Information Disclosure Rate (IDR).
