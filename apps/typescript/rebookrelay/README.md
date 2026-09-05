---
name: rebookrelay
description: Autonomous revenue recovery that detects calendar no-shows and cascades voice offers to prioritized waitlists via CALL-E.
---

# RebookRelay

No-show recovery platform for service-based businesses (clinics, dental, salons). Detects missed appointments on Google Calendar, makes AI voice calls via CALL-E to the original client, and cascades open slots down a prioritized waitlist until the slot is filled.

## Architecture

```
Google Calendar → No-Show Detection → RecoveryCase → Inngest Workflow
                                                           ↓
                                              CALL-E Voice Call (Original Client)
                                                           ↓
                                                    Declined / No Answer
                                                           ↓
                                              CALL-E Voice Call (Waitlist #1)
                                                           ↓
                                                    Declined / No Answer
                                                           ↓
                                              CALL-E Voice Call (Waitlist #2)
```

## Tech Stack

- **Frontend:** Next.js 16 (App Router), Tailwind CSS, Recharts
- **Backend:** Next.js API Routes, Prisma ORM, Neon PostgreSQL
- **Voice:** CALL-E SDK (`@call-e/calle`)
- **Workflow:** Inngest (durable serverless state machine)
- **Calendar:** Google Calendar API (OAuth2)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/krrish2803/RebookRelay.git
cd RebookRelay
npm install
```

### 2. Environment variables

Create a `.env` file:

```env
DATABASE_URL="postgresql://..."
CALL_E_API_KEY="iams_live_..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/google-calendar-callback"
INNGEST_EVENT_KEY="..."
INNGEST_SIGNING_KEY="..."
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 3. Database setup

```bash
npx prisma migrate dev
```

### 4. Run

```bash
npm run dev
```

## CALL-E Integration

### Call initiation

Calls are placed using the `@call-e/calle` SDK:

```typescript
import { CalleClient } from '@call-e/calle';

const calle = new CalleClient({ apiKey: process.env.CALL_E_API_KEY });

await calle.calls.create({
  task: agentScript,
  recipient: { phone: clientPhone },
  webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/calls/webhook/calle`,
  metadata: { case_id: recoveryCaseId }
});
```

### Webhook handling

CALL-E sends terminal events to `/api/calls/webhook/calle`. The webhook:
1. Updates the `CallAttempt` record in Postgres
2. Sends a `call.completed` event to Inngest
3. Inngest's `step.waitForEvent` resumes the cascade workflow

### Dynamic scripts

Call scripts are generated dynamically based on context:

- **Original client:** Empathetic reschedule offer
- **Waitlist person:** Urgent slot-claim offer with priority framing

## Dry-Run Mode

The dashboard includes an interactive demo that simulates the full cascade flow using `setTimeout` — no live calls are placed. Click "Trigger Test Cascade" on the dashboard to see the workflow in action.

## Cancellation

The Inngest workflow can be stopped by:
- Not sending the `call.completed` webhook event (workflow times out after 10 minutes)
- Manually updating the `RecoveryCase.cascadeStatus` to `COMPLETED` in the database

## Source Code

Full source code: [github.com/krrish2803/RebookRelay](https://github.com/krrish2803/RebookRelay)
