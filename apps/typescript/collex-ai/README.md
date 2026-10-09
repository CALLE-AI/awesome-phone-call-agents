# Collex AI — AI lead follow-up agent (CALL-E integration)

Collex AI is an AI-powered lead engagement platform. This folder is a trimmed-down,
standalone copy of the `call-agent` piece of the product — the LangGraph agent that
builds a call task for a lead and hands it to CALL-E.

The full product also includes a website chat widget, a CRM dashboard, team/agent
management, and billing. None of that is needed to demonstrate the CALL-E
integration, so it isn't included here.

## What it does

For each lead, the graph runs:

1. **`fetchLead`** — loads the lead's details
2. **`retrieveContext`** — pulls relevant context from the business's knowledge base (RAG) so the call is personalized, not generic
3. **`buildTask`** — turns the lead + context into a short call task/script
4. **`triggerCall`** — sends it to CALL-E to place the call
5. **`processResult`** — reads back the structured call result
6. **`router`** — decides what happens next: end, or loop back for a retry, based on the result

`state.js` defines the shared state shape passed between nodes; `graph.js` wires the
nodes above together. See `nodes/triggerCall.js` for the actual CALL-E call.

## Setup

```bash
npm install
cp .env.example .env
```

Nothing needs to be filled in to run the demo — see below.

## Running it (dry-run, default — no credentials needed)

```bash
node src/examples/run-dry-run.js
or npm run demo
```

This runs the full graph against the sample leads in `fixtures/sample-leads.json`.
With `CALLE_DRY_RUN=true` (the default), `triggerCall` never hits the real CALL-E API —
it logs what it _would_ send and returns a mock response in the same shape CALL-E
returns, so the rest of the graph (result processing, routing) runs exactly as it
would in production.

## Running it live

Set `CALLE_API_KEY` and `CALLE_DRY_RUN=false` in `.env`, then run the same command.
This will place a real phone call to whatever number is in the lead fixture — only do
this with a number you own/control.

## TODO

In `src/fixtures/sample-leads.json`, replace the `phone` field with a real phone number to make calls.

## Current status

Collex AI's calling feature is temporarily paused in our own production deployment.
Indian numbers were landing in visitors' spam/robocall filters when dialed from a US
caller ID, so we're working with CALL-E on local caller-ID provisioning before we
re-enable it for real users. The dry-run mode above reflects the intended real flow
and is safe to run and review regardless of that in-progress fix.

## Side effects & safety

- `triggerCall` is the only node that can create a real-world side effect (a phone
  call). It's gated behind `CALLE_DRY_RUN`, which defaults to `true`.
- `router` caps retries so a lead isn't called indefinitely on repeated failures.
- No phone numbers or personal data are committed to this repo — `sample-leads.json`
  uses fictional names and clearly fake numbers.
- Credit/quota checks for the business happen at the API layer before this graph is
  invoked, not inside the graph itself.

## Cancellation

Since retries are handled by `router`'s conditional edges rather than a separate
scheduled job, cancelling a follow-up just means the graph run isn't re-invoked for
that lead — there's no standing subscription or recurring job created on the CALL-E
side.

## Links

- Live product: https://collex-ai.vercel.app
- Contact: WhatsApp +91 95847 12453

## License

MIT
