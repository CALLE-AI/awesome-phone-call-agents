<div align="center">
  <img src="public/logo.png" alt="Recover Logo" width="120" />
  <h1>Recover — AI Voice Payment Recovery Agent</h1>
  <p><strong>Order / Exception Follow-Up Reference Application for the <a href="https://call-e.devpost.com/">CALL-E Hackathon</a></strong></p>
  <p><em>Follows up with subscribers on failed billing charges to capture conversational decisions with strict human-in-the-loop safety gates.</em></p>
</div>

---

## 🎯 Purpose & Problem Statement

Involuntary billing failures (such as card expiration or temporary bank declines) often lead to silent subscription cancellations when automated dunning emails go unread.

**Recover** provides an interactive voice follow-up workflow powered by **CALL-E**:
1. Captures a failed payment event.
2. Formulates an outbound call task with a mandatory human safety gate.
3. The AI agent conducts an outbound telephone conversation to clarify intent (`retry_now`, `update_card`, `pause_subscription`, or `no_answer`).
4. Structures the customer decision and presents an **advisory resolution** for human operator review and execution.

---

## 💡 Workflow

```
Subscription payment fails
      │
      ▼
Recover records the exception
      │
      ▼
Operator reviews task in Safety Gate & approves
      │
      ▼
AI voice agent calls customer (via CALL-E)
      │
      ▼
Customer decision captured: "retry now" / "update card" / "pause"
      │
      ▼
Authoritative webhook re-fetches & validates terminal result
      │
      ▼
Outcome presented as ADVISORY resolution for human operator review
```

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Frontend                        │
│  Next.js 16 App Router (React, TypeScript)          │
│  - Live dashboard with auto-refresh                 │
│  - Metric cards: at-risk revenue & resolution rate  │
│  - Operator safety gate (confirm before dialing)    │
│  - Deep-sanitized call transcript modal             │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│                    API Layer                        │
│  POST /api/stripe/simulate-failure  — demo trigger  │
│  POST /api/stripe/webhook           — Stripe events │
│  POST /api/calle/place-call         — confirmed dial│
│  POST /api/calle/cancel-call        — cancel preview│
│  POST /api/calle/pause-followups    — stop chain    │
│  POST /api/calle/webhook            — verify outcome│
│  GET  /api/calls                    — call timeline │
│  GET  /api/subscribers              — account list  │
│  GET  /api/admin/metrics            — summary data  │
└───────────────────────┬─────────────────────────────┘
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
  ┌───▼───┐       ┌─────▼───┐      ┌─────▼──────┐
  │CALL-E │       │ Stripe  │      │  SQLite DB │
  │Voice  │       │ (Test / │      │ (WAL mode) │
  │  API  │       │  Mock)  │      └────────────┘
  └───────┘       └─────────┘
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Operator Safety Gate** | Displays the exact task text and masked destination that CALL-E will receive. No phone rings without human confirmation. |
| **Server-Bound Destinations** | Client requests supply only an internal `callLogId`. The server looks up the authorized number from stored records. |
| **Advisory Resolutions** | Customer recovery choices (`retry_now`, `update_card`, `pause_subscription`) remain strictly advisory for operator review rather than autonomously executing charges. |
| **Authoritative Webhook Verification** | Webhooks trigger a direct re-fetch of the call object from CALL-E's API. Caller-supplied payloads are never trusted directly. |
| **Bounded Follow-up Safety** | Unanswered calls auto-schedule up to 3 bounded follow-up attempts with operator pause controls. |
| **PII Deep-Sanitization** | Phone numbers, emails, and provider transcripts are masked across all UI displays, APIs, and logs. |
| **Zero-Credential Offline Mock** | Fully testable without live Stripe or CALL-E credentials via honest local mocks. |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- CALL-E API key ([request at call-e.devpost.com](https://call-e.devpost.com/)) or use offline mock mode
- Stripe test-mode API keys (optional; offline mock provided)

### Setup

```bash
git clone https://github.com/rehna-jp/Recover
cd Recover
npm install

cp .env.example .env.local
# Set your RECOVER_API_KEY, CALLE_API_KEY, STRIPE_SECRET_KEY, and APP_BASE_URL
```

### Running locally

```bash
npm run dev
# → http://localhost:3000
```

---

## 🔒 Security & Architecture Standards

- **Fail-Closed API Authentication**: All REST endpoints require authorization (`x-recover-key` or Bearer token). The application strictly fails closed if `RECOVER_API_KEY` is omitted.
- **Strict ASCII E.164 Enforcement**: Validates phone numbers strictly against the ASCII E.164 specification (`+[country][digits]`) and rejects non-ASCII or malformed input.
- **Webhook Authentication**: Incoming webhooks verify configured secrets (`CALLE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_SECRET`) and reject unauthenticated deliveries with 401.
- **Destination & Intent Binding**: Before accepting a terminal result, Recover validates that the provider record matches the exact local call ID and stored subscriber phone.
- **Ambiguity & Conflict Halting**: Concurrent calls or duplicate subscriber creations halt with `409 Conflict`. Unconfirmed call attempts transition to an `uncertain` state for operator reconciliation.

---

## 🎬 Demo Flow (for judges)

1. Open the dashboard at `localhost:3000`
2. **Offline Simulation**: If live keys are not configured, Recover runs in zero-credential simulation mode.
3. Click **"⚡ Load Demo Data"** to view 3 standards-reserved scenarios:
   - ✅ **Demo Customer Alpha** (`alpha@example.com`) — Reached, authorized retry advisory recommendation.
   - ✅ **Demo Customer Beta** (`beta@example.org`) — Reached, self-service card update portal link prepared.
   - 🔄 **Demo Customer Gamma** (`gamma@example.net`) — Missed initial attempt, bounded follow-up attempt 2 of 3 scheduled.
4. Click **"🎙 Conversation"** on any completed call to inspect the sanitized turn-by-turn AI transcript.
5. For an interactive test: Add a test subscriber → click **"⚡ Simulate Stripe failure"** → review the Safety Gate → click **"Confirm & place call"**.

> **Note:** Live carrier calls require the official CALL-E developer test number (`+12763229632`) reserved for testing.

---

## 🧪 Build & Lint Commands

```bash
# Linting (0 errors)
npm run lint

# Production Build (offline type-check + page generation)
npm run build
```

---

## 📁 Key Files

```
app/
  page.tsx                    — Dashboard UI with Safety Gate & transcript viewer
  api/
    stripe/simulate-failure/  — Demo: triggers simulated card decline
    stripe/webhook/           — Authenticated Stripe webhook receiver
    calle/place-call/         — Places confirmed call with server-bound destination
    calle/webhook/            — Authoritative CALL-E webhook receiver (advisory outcomes)
    calle/cancel-call/        — Operator discard path for pending call previews
    calle/pause-followups/    — Operator pause control for follow-up chains
    admin/metrics/            — Dashboard telemetry summary
    admin/demo-data/          — Standards-reserved judge demo dataset
lib/
  auth.ts                     — Fail-closed authentication & strict E.164 validation
  masking.ts                  — PII masking & transcript deep-sanitization
  calle.ts                    — CALL-E SDK client & offline mock store
  db.ts                       — SQLite database schema, queries, and seed data
  stripe.ts                   — Stripe client & offline mock provider
```

---

## 📄 License

MIT