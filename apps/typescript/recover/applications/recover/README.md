<div align="center">
  <img src="logo.png" alt="Recover Logo" width="120" />
  <h1>Recover — AI Voice Payment Recovery Agent</h1>
  <p><strong>Order / Exception Follow-Up Reference Application</strong></p>
  <p>🏆 <em>Submitted to: <a href="https://call-e.devpost.com/">CALL-E: &ldquo;Your Code Is Calling&rdquo; Hackathon</a></em> &nbsp;·&nbsp; 📦 <em><a href="https://github.com/rehna-jp/Recover">Source Repository</a></em></p>
</div>

---

## ⚡ Overview

When a recurring payment method fails on a subscription, passive automated emails often go unread.

**Recover** provides an exception follow-up workflow powered by **CALL-E**. It contacts the subscriber with a human-in-the-loop safety gate, clarifies their situation in natural conversation, and gathers an advisory resolution:
1. **Retry Now**: Captures customer authorization to re-attempt the charge for human operator approval.
2. **Update Card**: Prepares a self-service customer billing portal link.
3. **Pause Subscription**: Records customer request for a 30-day grace period.
4. **No Answer**: Intelligently schedules capped follow-ups (maximum 3 attempts) with operator pause controls.

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
                │ Confirmed by human operator
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
                │ Authenticated & Verified Webhook
                ▼
┌────────────────────────────────┐
│      Advisory Resolutions      │
│  • Human operator confirmation │
│  • Self-service portal link    │
│  • SQLite telemetry & metrics  │
└────────────────────────────────┘
```

---

## 🎯 Key Features

- **Operator Safety Gate**: No voice call is placed without explicit operator confirmation showing the exact natural-language task instruction being sent to CALL-E.
- **Server-Bound Destination & Strict ASCII E.164**: Enforces strict ASCII E.164 and server-bound destination lookups so callers cannot inject arbitrary target numbers.
- **Advisory Financial Actions**: Financial retries and subscription adjustments remain advisory until confirmed by a human operator; calls do not autonomously execute card charges.
- **Authoritative Webhook Verification**: Untrusted webhooks trigger an authoritative re-fetch against CALL-E before recording outcomes.
- **PII Deep-Sanitization**: Customer phone numbers, emails, and provider transcripts are sanitized across UI, API, logs, and telemetry.
- **Transcript & Intelligence Modal**: Replays turn-by-turn conversations with speaker timestamps (`bot` vs `user`), summaries, and confidence scores.
- **Honest Offline Demo & Judge Mode**: Operates seamlessly offline with zero live credentials, pre-seeded with standards-reserved demo fixtures (`example.com/org/net`).

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
RECOVER_API_KEY=your_recover_secret
NEXT_PUBLIC_RECOVER_API_KEY=your_recover_secret
CALLE_API_KEY=your_calle_api_key
APP_BASE_URL=https://your-domain.ngrok-free.app
CALLE_WEBHOOK_SECRET=your_calle_webhook_secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
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
