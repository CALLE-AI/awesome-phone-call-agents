# 🍽️ CALLFORGE AI

>  — powered by CALL-E.

## What is CALLFORGE AI
CallForge AI is an AI-powered phone agent and restaurant comparison system. Instead of the user manually calling every restaurant, the user simply defines what they are looking for. For example, they can specify the number of guests, the date, the requested time, and whether they prefer outdoor seating. They can then add the restaurants they want to compare by entering the restaurant name, phone number, region, and locale directly from the dashboard. Nothing is hardcoded into the system, so the same platform can be used with different restaurants and different phone numbers.

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
https://youtu.be/43nEwfc_QsY

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
