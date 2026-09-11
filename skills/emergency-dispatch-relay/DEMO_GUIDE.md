# Demo Guide

A five-minute, zero-cost walk-through of the skill that never places a call,
followed by the one authorized real call for a live demo.

## 0. Preconditions

- Node 20+; `npm i @call-e/calle` (or use your own copy of the SDK).
- `CALLE_API_KEY` exported only for step 4.
- A number you are authorized to call — for first tests, your own phone.

## 1. Preview (no call, no key)

```bash
node scripts/relay.mjs \
  --case-id DEMO-1 \
  --incident "Cardiac / breathing emergency (CRITICAL P1)" \
  --location "Shalimar Bagh B-block, Delhi" \
  --unit-name "PCR Van 11" \
  --phone "+91<your-number>" \
  --confirmed-by "your-name"
```

Read the printed payload aloud in a demo: goal, recipient, locale, schema,
policy. Point at the hard constraints — this is the auditability story.

## 2. The refusal (no call, by design)

Drop `--confirmed-by` and re-run: the script exits non-zero with usage. No
human decision, no call — demonstrate the boundary.

## 3. Schema talk-track

`unit_accepted` is yes/no/unknown. `eta_minutes` returns digits ("12") or the
word "unknown". `notes` is one English sentence. Unknown is a real answer for
a bad line — the console keeps a predictable shape in every possible world.

## 4. One real call (authorized, budgeted)

```bash
node scripts/relay.mjs ... --confirmed-by "your-name" --real
```

The script prints the provider call id, reminds that a submitted call cannot
be recalled, polls every 5s, and prints the structured result with schema
validation and a transcript excerpt. Answer your phone; reply in the relay
locale; watch the JSON come back.

## 5. After the demo

Nothing to clean up: single attempt, no schedules, no recurrence. The
idempotency key means a replay of the same command cannot place a second call.
