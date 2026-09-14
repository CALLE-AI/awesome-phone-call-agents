# Examples

Worked end-to-end examples: compose the task + strict schema with
`build-task.mjs`, preview it as a dry run, then place the real call with
`place-call.mjs --execute`. Every phone number below is fictional
(`+1 555-01xx` reserved range). `outcome` is always one of
`success` | `partial` | `failed` | `callback_required`.

## 1. Negotiate a bill (ask-first, no auto-commit)

```bash
node scripts/build-task.mjs --playbook negotiate-bill \
  --values '{"company":"Xfinity retention","currentAmount":"95","goal":"lower","leverage":"AT&T Fiber offers $55/mo same speed; 4-year customer","walkAway":"yes","approvalMode":"ask"}' \
  --caller "Alex Rivera" --callback "+14155550100" > plan.json

# Dry run — prints the plan with masked numbers, places NO call:
node scripts/place-call.mjs --body plan.json --to-phone +14155550123

# After consent — place it and wait for the structured result:
CALLE_API_KEY=… node scripts/place-call.mjs --body plan.json --to-phone +14155550123 --execute --poll
```

Sample `structured_result`:

```json
{
  "outcome": "success",
  "previous_amount": 95,
  "new_amount": 65,
  "monthly_savings": 30,
  "promo_length": "12 months",
  "confirmation_number": null,
  "agent_name": "Dana",
  "next_steps": "Offer captured, not committed — you confirm $65/mo to lock it in."
}
```

Because `approvalMode` is `ask`, the agent secured the offer but did **not**
commit; you accept it. Set `approvalMode:"auto"` with `autoAcceptBelow` to let it
accept at or below a monthly ceiling.

## 2. Quote Shootout — call several businesses, ranked (batch)

```bash
node scripts/build-task.mjs --playbook get-quote \
  --values '{"service":"front brake pads + rotors, 2018 Honda Civic; out-the-door price","timeframe":"this week"}' \
  --batch > plan.json

# Repeat --to-phone per business; batch is auto-detected:
CALLE_API_KEY=… node scripts/place-call.mjs --body plan.json \
  --to-phone +14155550123 --to-phone +14155550188 --to-phone +14155550190 --execute --poll
```

Per-business result (`recipient_result_schema`, one per business):

```json
{ "outcome": "success", "price_low": 240, "price_high": 240, "includes": "pads + rotors, labor, out-the-door", "availability": "this week", "contact_name": "Marco", "notes": "OEM rotors +$40" }
```

Call-level aggregate (`result_schema`):

```json
{
  "businesses_called": 3,
  "reached": 2,
  "quotes_received": 2,
  "cheapest_business": "Downtown Auto",
  "cheapest_price": 240,
  "potential_savings": 85,
  "note": "1 of 3 not reached (voicemail) — not counted"
}
```

Only reached businesses are compared; the voicemail is reported in `note`, never
counted as a quote.

## 3. Cancel a subscription (get a confirmation number)

```bash
node scripts/build-task.mjs --playbook cancel-subscription \
  --values '{"company":"Planet Fitness","accountRef":"member 4821","reason":"moving","declineOffers":"yes"}' > plan.json
node scripts/place-call.mjs --body plan.json --to-phone +14155550123            # dry run
CALLE_API_KEY=… node scripts/place-call.mjs --body plan.json --to-phone +14155550123 --execute --poll
```

Sample `structured_result`:

```json
{
  "outcome": "success",
  "cancellation_confirmation": "5173482",
  "effective_date": "today",
  "final_charge": "none",
  "retention_offer": "declined per request",
  "next_steps": "Keep confirmation 5173482 for your records."
}
```

## 4. Non-English call (English inputs, agent speaks the local language)

```bash
node scripts/build-task.mjs --playbook general-inquiry \
  --values '{"business":"Farmacia del Centro","question":"Do you have flu shots available today, and what do they cost?"}' \
  --language Spanish > plan.json

CALLE_API_KEY=… node scripts/place-call.mjs --body plan.json \
  --to-phone +525555550100 --region MX --locale es-MX --execute --poll
```

`--language Spanish` makes the task instruct the agent to run the whole
conversation in Spanish; the structured result still comes back in English:

```json
{ "outcome": "success", "answer": "Yes — flu shots available today, walk-in 9am–5pm, about $25.", "contact_name": "reception", "next_steps": null }
```
