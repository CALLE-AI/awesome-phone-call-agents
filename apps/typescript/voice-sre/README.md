# VoiceSRE ☎️⚡

> **Autonomous Hands-Free Production Incident Hotfix Agent**  
> *Turn your on-call phone into an authenticated terminal to triage and rollback production outages.*

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CALL-E](https://img.shields.io/badge/Powered%20By-CALL--E%20SDK-blue)](https://open.heycall-e.com)
[![Devpost](https://img.shields.io/badge/Hackathon-CALL--E%20Devpost-003E54)](https://call-e.devpost.com/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

---

## 💥 The Problem

P0 production outages (e.g. checkout errors, API 500 spikes) inevitably hit when SREs and engineers are:
- Driving on the highway.
- Away from keyboards without Wi-Fi.
- Woken up at 2:00 AM in bed.

Passive alerts (SMS, PagerDuty, Slack) require opening a laptop, unlocking VPNs, and typing terminal commands—causing **15–30 minutes of critical revenue loss**.

## 🚀 The Solution: VoiceSRE

**VoiceSRE** bridges the gap between the physical on-call engineer and the digital cloud infrastructure:
1. **Intelligent Outbound Dialing:** When Datadog/Sentry flags a P0 incident, CALL-E dials the on-call engineer.
2. **Immediate AI Disclosure & Root Cause Briefing:** Discloses AI identity immediately, then delivers a concise verbal summary of the failure (service, commit author, error trace).
3. **Conversational Tool Execution:** The engineer issues a verbal hotfix instruction (*"Roll back canary to v2.4.0 and flush Redis"*).
4. **Autonomous Remediation & Health Verification:** CALL-E extracts structured JSON via `resultSchema`, executes Git/Kubernetes rollbacks, validates that error rates normalize, and resolves the PagerDuty ticket.

---

## 🏛️ Architecture Flow

```mermaid
sequenceDiagram
    autonumber
    participant Mon as Monitoring (Datadog/Sentry)
    participant VSRE as VoiceSRE Daemon
    participant Calle as CALL-E Voice Engine
    participant Eng as On-Call Engineer (Phone)
    participant K8s as Production Cluster (K8s)

    Mon->>VSRE: Webhook: P0 HTTP 500 Spike (46.8%)
    VSRE->>Calle: calls.createAndWait(E.164 phone, taskPrompt, resultSchema)
    Calle->>Eng: Phone Rings (Outbound Call)
    Calle->>Eng: "AI Alert: Checkout-service failing on commit by Sarah. Roll back to v2.4.0?"
    Eng->>Calle: "Yes, approve rollback and flush cache"
    Calle-->>VSRE: Returns structuredResult: { action_decision: "rollback" }
    VSRE->>K8s: kubectl rollout undo + Redis cache flush
    VSRE->>Mon: Verify error rate dropped to 0.01% & close incident
```

---

## 🛡️ Safety & Responsible Calling Model

VoiceSRE implements strict guardrails:
- **Immediate AI Disclosure:** Every call begins with explicit disclosure: *"This is VoiceSRE, an AI on-call assistant..."*
- **Strict E.164 Validation:** Rejects any phone numbers not adhering to `/^\+[1-9]\d{7,14}$/`.
- **Zero Phone Leakage:** All logs, previews, and reports mask phone numbers (`+84******1234`).
- **Dry-Run / Preview Mode by Default:** `VOICE_SRE_MODE=preview` simulates the entire remediation pipeline without consuming phone call credits.
- **Idempotency Safeguard:** Prevents duplicate dialing via unique `idempotencyKey` per incident.

---

## ⚡ Quickstart & Installation

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/CALLE-AI/awesome-phone-call-agents.git
cd apps/typescript/voice-sre
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Set your configuration:
```ini
# CALL-E API Key (Get 20 free calls from https://open.heycall-e.com)
CALLE_API_KEY=calle_sk_your_key_here

# Target Engineer Phone (E.164 format)
ONCALL_PHONE_NUMBER=+12025550123

# Set to 'preview' (default safe simulation) or 'live' (real phone call)
VOICE_SRE_MODE=preview

PORT=3000
```

### 3. Run Automated Unit Tests
```bash
npm test
```

### 4. Start Mission Control Dashboard
```bash
npm run dev
```
Open **`http://localhost:3000`** in your browser.

---

## 🎮 How to Demo (3-Minute Hackathon Walkthrough)

1. Open `http://localhost:3000`. You will see the **Mission Control Dashboard** showing a healthy cluster.
2. Click **💥 1. Simulate P0 Outage**. Notice the error rate spike to **46.8%**, latency jump to **1450ms**, and the cluster turns **CRITICAL RED**.
3. In **Preview Mode**: Click **📞 2. Dispatch VoiceSRE Call**. Watch the live terminal logs stream the AI prompt, verbal decision parsing, and automated rollback execution.
4. In **Live Mode**: Set your real phone number, input your CALL-E key, set mode to **Live Call**, and click Dispatch.
   - Your actual phone will ring!
   - Answer and say: *"Roll back the deployment and flush cache"*.
   - Watch the dashboard instantly update: Error rate drops to **0.01%**, latency drops to **45ms**, and the cluster turns **HEALTHY GREEN**.

---

## 📄 License
Distributed under the Apache 2.0 License.
