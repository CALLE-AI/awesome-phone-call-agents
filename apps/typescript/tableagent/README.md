# 🍽️ TableAgent

> AI agent that calls restaurants on your behalf, attempts to book a table, handles voicemails, and returns a structured comparison — powered by CALL-E.

## What it does

- Calls restaurants in natural language using CALL-E SDK
- Introduces itself as calling on behalf of the customer by name
- Attempts to complete the actual reservation
- Detects voicemails vs human answers and handles each correctly
- Returns structured results: confirmed, available, voicemail left, or no answer
- Stores full call transcripts and history in a dashboard

## Source code
https://github.com/fayyazsarah07/Call-Forge-AI

## Demo video
[YouTube link — add before submitting]

## Tech Stack
- CALL-E SDK (`@call-e/calle`)
- Next.js 16 + TypeScript
- Prisma + SQLite
- Tailwind CSS

## CALL-E Integration

```typescript
const call = await client.calls.createAndWait({
  task: `You are calling on behalf of ${customerName}.
         Book a table for ${partySize} people on ${date} at ${time}.
         If voicemail, leave name and callback: ${customerPhone}.`,
  recipients: [{ phones: [restaurant.phone], region, locale }],
  resultSchema: {
    type: "object",
    properties: {
      confirmed: { type: "boolean" },
      available: { type: "boolean" },
      callback_requested: { type: "boolean" },
      price_range_per_person: { type: "string" },
    }
  }
});
```

## Setup

```bash
git clone https://github.com/fayyazsarah07/Call-Forge-AI
cd Call-Forge-AI
npm install
npx prisma migrate dev
```

Add `.env.local`:
```
CALLE_API_KEY=your_key_here
CALLE_BASE_URL=https://api.heycall-e.com
```

```bash
npm run dev
# Open http://localhost:3000
```

## Contribution Area
apps/typescript — User-facing TypeScript application
