---
name: bank-acquisition-call-agents
description: >
  Three-agent CALL-E skill for end-to-end AI-driven bank customer acquisition:
  outbound lead outreach, personalised offer explanation, and KYC support
  callbacks — all backed by a live scoring engine, governance layer, and
  audit trail.
version: 1.0.0
integration: cli
calle_tools:
  - plan_call
  - run_call
  - get_call_run
language: TypeScript (Next.js 14)
safety:
  - Calls are only placed when conversionProbability >= 70
  - All calls write an AuditRecord before dialling
  - Do-not-call intent sets a governance flag — no retry
  - Governance disclosures are injected automatically for borderline offers
  - Escalation creates a ManualOverride record and stops the call
---

# Bank Acquisition Call Agents

Three production-ready CALL-E phone-call agents wired into a **white-label bank
customer-acquisition platform**. Any bank can deploy it — the `{bank}` token is
resolved at runtime from a `BankRegistry`.

---

## What it does

| Agent | Trigger | CALL-E goal |
|-------|---------|-------------|
| **Lead Outreach** | `conversionProbability ≥ 70` after scoring | Introduce the bank, qualify intent, capture callback preference |
| **Offer Explanation** | Lead expressed interest in outreach call | Walk through top 3 personalised bundles, handle objections, capture verbal consent |
| **Customer Support** | Post-KYC query or callback request | Answer KYC status questions, explain declined offers, escalate when needed |

---

## Architecture

```
[LeadProfile + Score Engine]
        │  conversionProbability ≥ 70
        ▼
POST /api/calls/outreach  ──► CALL-E (plan_call + run_call)
        │  intent = "interested"
        ▼
POST /api/calls/offer-explain  ──► CALL-E  (offer bundles as goal)
        │  verbal consent captured
        ▼
[KYC Studio — existing onboarding flow]
        │  query / complaint event
        ▼
POST /api/calls/support-inbound  ──► CALL-E  (KYC context as goal)
        │  unresolved after 3 attempts
        ▼
[ManualOverride record → Human agent]

All three agents write to AuditRecord[] for compliance.
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 18, npm
- CALL-E CLI authenticated (`calle auth status` shows `"usable": true`)

```bash
# 1 — Clone the platform repo
git clone https://github.com/<your-org>/bank-acquisition-platform
cd bank-acquisition-platform

# 2 — Install dependencies (including CALL-E CLI if not global)
npm install
npm install -g @call-e/cli

# 3 — Authenticate CALL-E
calle auth login

# 4 — Start the dev server
npm run dev

# 5 — Open the Call Center dashboard
open http://localhost:3000/call-center
```

---

## Placing a Call (dry-run preview first)

```bash
# Preview what goal text will be sent — no call placed
node scripts/preview-goals.js

# Place a real outreach call via the API
curl -X POST http://localhost:3000/api/calls/outreach \
  -H "Content-Type: application/json" \
  -d '{
    "toPhone": "+911234567890",
    "bankId": "default",
    "lead": {
      "id": "lead_001",
      "name": "Priya Sharma",
      "city": "Mumbai",
      "age": 32,
      "income": 75000,
      "digitalAffinity": 82,
      "preferredLanguage": "English",
      "persona": { "title": "Urban Professional", "archetype": "Urban Professional", "motivation": "Cashback" },
      "previousProducts": ["Savings"],
      "segment": "Urban Growth",
      "challengeSummary": "Looking for a better credit card",
      "riskSignals": [],
      "governanceFlags": [],
      "regulatoryNotes": "",
      "score": {
        "conversionProbability": 82,
        "productFit": 78,
        "onboardingConfidence": 85,
        "confidence": 82,
        "businessValue": 110000,
        "complianceRisk": 22,
        "decisionGrade": "A"
      }
    }
  }'
```

---

## API Endpoints

| Method | Path | Agent |
|--------|------|-------|
| `POST` | `/api/calls/outreach` | Lead Outreach |
| `POST` | `/api/calls/offer-explain` | Offer Explanation |
| `POST` | `/api/calls/support-inbound` | Customer Support |
| `GET`  | `/api/calls/call-status?runId=xxx` | Status poll |

All endpoints return:
```json
{
  "ok": true,
  "planId": "...",
  "runId": "...",
  "status": "in_progress",
  "auditRecordId": "...",
  "calleNextAction": null
}
```

---

## Call Goal Construction

Goals are built by `lib/callScriptEngine.ts` from live data:

### Agent 1 — Lead Outreach
- Uses: `lead.name`, `lead.preferredLanguage`, `lead.persona.motivation`, `lead.segment`, `lead.challengeSummary`, `bank.name`
- Does NOT pitch any product — qualification only

### Agent 2 — Offer Explanation
- Uses: `offerResult.topOffers[]` (name, description, benefitsTheme, whyThisOffer)
- Auto-injects compliance disclosure when `policyStatus !== "policy-compliant"`
- Handles live objections via CALL-E's adaptive conversation

### Agent 3 — Customer Support
- Uses: `onboarding.status`, `onboarding.verificationDetails`, `onboarding.sessionId`
- Escalates after 3 failed resolution attempts → `ManualOverride` record created

---

## Safety Notes

1. **Threshold gate** — Agent 1 only fires for leads with `conversionProbability ≥ 70`.
2. **DNC flag** — If a lead says "not interested", `lead.governanceFlags.push("DNC")` is set; no retry.
3. **Governance disclosure** — Borderline/manual-review offers trigger a mandatory spoken disclosure before any pitch.
4. **Audit trail** — Every call writes a timestamped `AuditRecord` before CALL-E dials.
5. **Escalation boundary** — Support agent never makes promises outside the script; unresolvable cases always route to a human.
6. **No credentials in goal** — Phone numbers and API keys are never included in the goal text sent to CALL-E.

---

## Cancellation & Rollback

- Calls cannot be cancelled mid-flight once `run_call` is dispatched.
- To prevent a scheduled call: delete the `CallRecord` from the queue before the scheduled time.
- To mark a lead as do-not-call: `lead.governanceFlags.push("DNC")` — all three agents check this flag before dialling.

---

## Credentials

| Secret | Where stored |
|--------|-------------|
| CALL-E token | `~/.calle-mcp/cli/.../token.json` (local, never committed) |
| Bank config | `lib/bankRegistry.ts` (no secrets — only names/themes) |
| Lead data | In-memory / localStorage for demo; replace with DB for production |

---

## Repository

Full source: https://github.com/kunalchoubey/AgenticAI_Bank  
Call Center UI: `/app/call-center/page.tsx`  
Call Agents: `/app/api/calls/`  
Script Engine: `/lib/callScriptEngine.ts`  
CALL-E Client: `/lib/calleClient.ts`

---

## License

MIT
