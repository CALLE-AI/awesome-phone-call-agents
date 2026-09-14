# PagerZero

Autonomous SRE incident remediation pager that auto-resolves routine outages while on-call engineers sleep, and uses CALL-E for zero-trust spoken PIN voice authorization on high-impact production runbooks.

- Repository: [https://github.com/adamm285-dev/pagerzeropro](https://github.com/adamm285-dev/pagerzeropro)
- Live Application: [https://pagerzero.pro](https://pagerzero.pro)
- License: MIT

PagerZero is hosted in its own repository. It is not a CALL-E SDK and does not define a supported application API.

## Overview

PagerZero eliminates 3:00 AM on-call pager fatigue by introducing a multi-tier autonomy gate for production incidents:

- **Tier 1 (Safe Autonomous Remediation — Zero Wakeup):** For low-risk, idempotent operational runbooks (e.g. log disk pruning, expired Redis cache purging), PagerZero executes the remediation autonomously, verifies health recovery through a canary window, and logs the post-mortem to Discord. **The on-call engineer stays asleep.**
- **Tier 2 (CALL-E Voice Authorization with Security PIN — Stay in Bed):** For high-impact actions with production blast radius (e.g. database connection pool cycling, container cluster bounce), PagerZero dials the engineer's phone via CALL-E. The engineer hears a 15-second diagnostic briefing and speaks their approval with a 4-digit security PIN (e.g., *"Approve 1234"*). PagerZero verifies the PIN, executes the runbook, confirms recovery on the phone, and closes the alert.
- **Tier 3 (Emergency Escalation):** If an alert is rejected, an invalid PIN is spoken, or the engineer cannot be reached, the incident immediately escalates to the secondary on-call schedule.

## Architecture

```text
Alert (Prometheus/Chaos) ──► AI SRE Diagnostic Engine ──► Autonomy Policy Gate
                                                               │
     ┌─────────────────────────────────────────────────────────┴────────────────────────┐
     ▼                                                                                  ▼
Tier 1: Safe Runbook                                                    Tier 2: High-Impact Runbook
Autonomous execution & canary verification                              CALL-E Outbound Voice Call (+15555550100)
Engineer stays asleep in bed                                            Spoken Decision + 4-Digit Security PIN
Discord post-mortem mirror                                              Real-time carrier event streaming (listEvents)
                                                                        PgBouncer recycle & cluster recovery
```

## Setup

Requirements: Node.js 20+, npm.

```bash
git clone https://github.com/adamm285-dev/pagerzeropro.git
cd pagerzeropro

# Install dependencies
npm install

# Build server and client
npm run build

# Start local server (defaults to safe Voice Simulator mode)
npm start
```

For development with hot reload:
```bash
npm run dev
```

Visit `http://localhost:4000` to access the PagerZero Mission Control console.

## CALL-E integration method

PagerZero integrates with CALL-E using the official `@call-e/calle` TypeScript server SDK from a secure Node.js backend. 

Key architectural components:
1. **Dynamic Task Prompting:** Compiles live Prometheus/chaos telemetry into a concise operational briefing for the voice AI actor.
2. **Structured Result Validation:** Enforces a JSON schema requiring `approval_status` (`approved`, `rejected`, `escalate`, `snooze`), `spoken_notes`, and confidence scores.
3. **Dual-Factor PIN Extraction:** Spoken digits (e.g., `1234`) are extracted on the server via phonetic pattern matching (`extractSpokenPin`) to ensure security without triggering anti-phishing keyword filters in the prompt.
4. **Real-Time Carrier Telephony Event Streaming:** Polls CALL-E's `client.calls.listEvents` API every 2 seconds and broadcasts carrier lifecycle events (`botlab create bot`, `calling resolve robot id`, `Call is ringing`, `Call connected`) live over WebSockets to the web dashboard.
5. **ChatOps Mirroring:** Automatically mirrors root-cause diagnoses, CALL-E spoken approval notes, and post-mortems to Discord webhooks.

## Call side effects

Outbound phone calls are placed **only** when an incident is classified as Tier 2 or when an operator explicitly triggers a high-impact chaos scenario. 

Every outbound call:
- Targets the verified on-call engineer's phone number configured in Settings.
- Has a bounded 120-second telecom timeout before escalating.
- Employs 429 concurrency retries and 402 balance fallback to the simulator.
- Requires verbal authorization before mutating any cluster service.

## Safe testing path with no calls

PagerZero provides a complete, high-fidelity **Voice Simulator** mode enabled by default:
- Uses browser Web Speech synthesis and recognition.
- Renders the full telephony drawer, speaks the diagnostic briefing aloud via local male speech synthesis, and listens for the engineer's verbal *"Approve 1234"* command.
- Runs the full diagnostic, remediation, canary verification, and post-mortem pipeline with **zero outbound phone calls placed** and **zero API costs**.
- Automated test suite runs with Vitest (`npm test`) covering PIN extraction, Discord webhooks, diagnostics, and cluster fault injection offline.

## Confirmation for the submitted build

The submitted build deployed at `https://pagerzero.pro` has live CALL-E credentials configured securely on Google Cloud Run. Visitors can try either:
1. **Live CALL-E Telephony:** Enter their own mobile phone number in Settings and trigger a Tier 2 chaos scenario to receive a real phone call.
2. **Offline Simulator:** Toggle Call Mode to "Voice Simulator" in Settings to test the complete voice authorization flow directly in the browser with zero external calls.

## Credential handling

All CALL-E API keys and Discord webhook URLs are stored strictly server-side in Cloud Run environment variables (`CALLE_API_KEY`, `DISCORD_WEBHOOK_URL`). They are never bundled into client-side code, never exposed in HTTP responses, and never logged in plain text.

## Cancellation and duplicate-call protections

- **Single Active Call per Incident:** The incident manager locks the incident state during dialing; duplicate alerts for the same service update the existing incident rather than spawning parallel calls.
- **Snooze Support:** Spoken snooze requests (e.g., *"snooze for 5 minutes"*) temporarily pause redials until the snooze window expires.
- **Automatic Fallback:** If CALL-E reports balance exhaustion (402) or repeated carrier busy signals, PagerZero gracefully falls back to the in-browser simulator.

## Phone-number handling

Phone numbers are normalized to E.164 format (e.g. `+15555550100`). Recipient numbers can be updated at any time in Settings.

## Boundaries

PagerZero is designed for SRE incident response, infrastructure runbook execution, and DevOps on-call management. It is not an emergency 911 dispatch system and should only be used to contact registered on-call team members who have consented to operational alerts.
