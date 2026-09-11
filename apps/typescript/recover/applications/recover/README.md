<div align="center">
  <img src="logo.png" alt="Recover Logo" width="120" />
  <h1>Recover — AI Voice Payment Recovery Agent</h1>
  <p><strong>Automating involuntary churn recovery using live CALL-E voice interventions and instant Stripe resolution.</strong></p>
  <p>🏆 <em>Submitted to: <a href="https://call-e.devpost.com/">CALL-E: &ldquo;Your Code Is Calling&rdquo; Hackathon</a></em> &nbsp;·&nbsp; 📦 <em><a href="https://github.com/rehna-jp/Recover">Source Repository</a></em></p>
</div>

---

## ⚡ Overview

When a credit card fails on a SaaS subscription, conventional dunning systems send automated emails that get lost in spam or ignored, resulting in **20–40% involuntary customer churn**.

**Recover** turns passive email dunning into an immediate, conversational voice intervention. Powered by **CALL-E**, Recover dials the customer within seconds of a Stripe failure, understands why the payment failed (expired card, fraud block, travel), and captures an immediate decision:
1. **Retry Now**: Automatically re-attempts the charge via Stripe API.
2. **Update Card**: Immediately texts a secure Stripe Customer Billing Portal link.
3. **Pause Subscription**: Grants a 30-day grace period while maintaining account retention.
4. **No Answer**: Intelligently schedules capped follow-ups with full human-in-the-loop oversight.

---

## 🏗 Architecture & Flow

```
┌────────────────────────────────┐
│   Stripe Subscription Event    │
│  (invoice.payment_failed)      │
└───────────────┬────────────────┘
                │
                ▼
┌────────────────────────────────┐
│       Recover Dashboard        │
│    (Operator Safety Gate)      │
└───────────────┬────────────────┘
                │ Confirmed by operator
                ▼
┌────────────────────────────────┐
│           CALL-E API           │
│  Task: "Call customer about    │
│   failed charge of $X.XX"      │
└───────────────┬────────────────┘
                │ Voice call & natural dialogue
                ▼
┌────────────────────────────────┐
│       Customer Decision        │
│  retry_now / update / pause    │
└───────────────┬────────────────┘
                │ Structured Webhook
                ▼
┌────────────────────────────────┐
│       Automated Actions        │
│  • Stripe charge retry         │
│  • Billing portal SMS dispatch │
│  • SQLite telemetry & metrics  │
└────────────────────────────────┘
```

---

## 🎯 Key Features

- **Operator Safety Gate**: No voice call is placed without explicit operator confirmation showing the exact natural-language task instruction being sent to CALL-E.
- **Server-Bound Destination & E.164**: Enforces strict ASCII E.164 and server-bound destination lookups so callers cannot inject arbitrary target numbers.
- **Authoritative Webhook Verification**: Untrusted webhooks trigger an authoritative re-fetch against CALL-E before performing any Stripe retries or follow-ups.
- **PII Masking**: Customer phone numbers and emails are masked across UI, API, logs, and telemetry.
- **Closed-Loop Fulfillment**: Connects CALL-E call outcomes directly to the Stripe API (`stripe.charges.create`, hosted portal sessions) to immediately settle delinquent balances.
- **Transcript & Intelligence Modal**: Replays complete turn-by-turn conversations with speaker timestamps (`bot` vs `user`), sentiment summaries, and decision confidence scores.
- **Honest Offline Demo & Judge Mode**: Operates seamlessly offline with zero live credentials, pre-seeded with judge demo scenarios using the reserved CALL-E test number (`+12763229632`).
- **Dark-Mode Command Center**: Crafted with modern typography, glowing metric cards, custom SVG icons, and real-time ARR recovery tracking.

---

## 🚀 Quick Setup

### 1. Clone & Install
```bash
git clone https://github.com/rehna-jp/Recover.git
cd Recover
npm install
```

### 2. Environment Variables
Create `.env.local`:
```env
CALLE_API_KEY=your_calle_api_key
APP_BASE_URL=https://your-domain.ngrok-free.app
STRIPE_SECRET_KEY=sk_test_...
```

### 3. Run Locally
```bash
npm run dev
# Open http://localhost:3000
```

---

## 🌍 Region Support
Recover adheres to CALL-E carrier coverage standards. For live testing, calls are directed to verified CALL-E numbers (e.g. `+12763229632`).

---

## 👥 Authors
- GitHub: [@rehna-jp](https://github.com/rehna-jp)
