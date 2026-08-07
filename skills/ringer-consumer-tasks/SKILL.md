---
name: ringer-consumer-tasks
description: Handle the dreaded consumer phone calls — negotiate a bill, cancel a subscription, chase a refund, book an appointment, get a price quote, or ask a business a question — by turning a few fields into a precise CALL-E task and a strict structured-result schema, previewing as a dry run, and placing the call only with explicit consent. Includes a Quote Shootout batch mode that calls several businesses and returns per-business results plus a ranked comparison.
license: MIT
---

# Ringer Consumer Tasks

Use this skill when a person wants an AI agent to make a real-world **consumer**
phone call on their behalf and hand back a clean, structured outcome — the new
monthly price, a cancellation confirmation number, the booked time, the refund
amount, the quote. It packages the prompt-engineering and the structured-output
contract for six common, high-friction call types plus a free-form one.

This is a **composition + safety** skill. It does not create a phone provider,
does not manage provider-side recurring schedules, and does not call arbitrary
numbers it scraped. It turns a chosen playbook + a few user-supplied fields into
a reviewed, consent-gated CALL-E call with a strict `result_schema`.

## When To Use

Use this skill for:

- negotiating or lowering a bill, waiving a fee, or matching a competitor offer
- cancelling a subscription or membership past the retention runaround
- chasing a stuck refund or disputing a charge
- booking an appointment (dental, restaurant, service) by phone
- getting a price quote — including calling several businesses to compare (Quote Shootout)
- asking a business a specific question (hours, stock, policy)
- a free-form "call X and find out / do Y" task with a custom result contract
- previewing exactly what an agent will say and return, before any call is placed

## When Not To Use

Do not use this skill to:

- place calls to numbers the user did not provide, or guess/repair phone numbers
- infer country codes, region, or language — require explicit E.164 and region
- make a legally binding commitment on the user's behalf without their approval
- give medical, legal, financial, or emergency advice during a call
- run mass/robo outreach, sales spam, or anything the recipient has not consented to
- impersonate the account holder using invented PII, PINs, or card numbers

## Playbooks

| id | Goal | Required fields | Batch |
|---|---|---|---|
| `negotiate-bill` | Lower a rate, waive a fee, match/extend a promo | `company`, `goal` | — |
| `cancel-subscription` | Cancel cleanly, get a confirmation number | `company` | — |
| `chase-refund` | Recover a refund/credit or dispute a charge | `company`, `issue` | — |
| `book-appointment` | Book a slot that fits the user's constraints | `business`, `purpose` | ✓ |
| `get-quote` | Collect a real price; **Quote Shootout** ranks many | `business`, `service` | ✓ |
| `general-inquiry` | Get straight answers to specific questions | `business`, `question` | ✓ |
| `custom` | Any call, with a user-defined result contract | `task` | ✓ |

Run `node scripts/build-task.mjs --list` for the machine-readable catalog. Field
semantics (`goal`, `walkAway`, `approvalMode`, `resolution`, `declineOffers`,
`preferredTimes`, `collect`, …) and every result schema are in
`references/playbooks.md`.

## Workflow

1. Confirm the user actually wants a real phone call placed, and identify the
   single playbook that fits. If none fit, use `custom`.
2. Collect the playbook's required fields plus any helpful optional ones. Get the
   recipient's phone number in **E.164** (e.g. `+14155550123`) and the region —
   ask; never guess. Optionally collect the caller's name and a callback number.
3. Compose the call with `build-task.mjs` (below). It returns the exact `task`
   text, a strict `result_schema`, and `missing_required`. If `missing_required`
   is non-empty, go back and collect those fields.
4. **Dry-run preview** with `place-call.mjs` (no `--execute`). Show the user the
   masked recipient, the task the agent will follow, and the fields it will bring
   back. This is the default and must happen before any real call.
5. Get **explicit consent** to place the call. For `negotiate-bill` and
   `cancel-subscription`, confirm the decision-authority stance (the agent
   captures offers but does not commit unless the user set an auto-accept limit).
6. Place the call with `place-call.mjs --execute` (requires `CALLE_API_KEY`). Add
   `--poll` to wait for the structured result; calls can take minutes.
7. Report the structured result verbatim from the schema fields, plus CALL-E's
   `completion_confidence` and a one-line summary. If it did not resolve, offer a
   single escalated follow-up rather than looping.

## Scripts

**Compose the task + strict schema** (pure, offline, never dials):

```bash
node scripts/build-task.mjs \
  --playbook negotiate-bill \
  --values '{"company":"Xfinity","currentAmount":"95","goal":"lower","leverage":"AT&T Fiber offers $55/mo for the same speed; 4-year customer","walkAway":"yes","approvalMode":"ask"}' \
  --caller "Alex Rivera" --callback "+14155550100" > plan.json
```

For **Quote Shootout**, add `--batch` on a batchable playbook to get a
per-business `recipient_result_schema` plus an aggregate call-level
`result_schema` (cheapest business, potential savings):

```bash
node scripts/build-task.mjs --playbook get-quote \
  --values '{"service":"front brake pads + rotors, 2018 Honda Civic; out-the-door price","timeframe":"this week"}' \
  --batch > plan.json
```

For a **non-English** call, add `--language` (e.g. `--language Spanish`) so the
task instructs the agent to run the whole conversation in that language, and pass
the matching CALL-E `--region`/`--locale` to `place-call.mjs` (e.g. `--region MX
--locale es-MX`). CALL-E supports English plus Hindi, Arabic, Vietnamese, German,
Japanese, French, Spanish, and Portuguese in their respective regions.

**Preview, then place** (dry-run by default; `--execute` places the real call):

```bash
# 1) Dry run — prints the plan with masked numbers, places NO call:
node scripts/place-call.mjs --body plan.json --to-phone +14155550123

# 2) After consent — place it and wait for the structured result:
CALLE_API_KEY=calle_live_… \
node scripts/place-call.mjs --body plan.json --to-phone +14155550123 --execute --poll

# Quote Shootout: repeat --to-phone per business (batch is auto-detected):
CALLE_API_KEY=calle_live_… node scripts/place-call.mjs --body plan.json \
  --to-phone +14155550123 --to-phone +14155550188 --to-phone +14155550190 --execute --poll
```

Alternative placement: for a quick goal-only call **without** a custom schema,
the CALL-E CLI works too — `calle call start --to-phone +14155550123 --goal "<task>"`
then `calle call status --run-id <run_id>`. Use `place-call.mjs` (the API path)
whenever you want the strict structured result this skill's schemas define.

## Provider Boundary

This skill prepares and optionally executes CALL-E create-call requests of this
shape (one call task; one or more recipients for batch):

```json
{
  "task": "Composed from the playbook + user fields…",
  "recipients": [{ "phones": ["+14155550123"], "region": "US", "locale": "en-US" }],
  "result_schema": { "type": "object", "additionalProperties": false, "required": ["outcome"], "properties": { "…": {} } },
  "recipient_result_schema": { "…": "present only in batch / Quote Shootout" }
}
```

Result schemas are **strict**: CALL-E rejects any property not declared in
`properties` before returning `structured_result`, so the output is always
exactly the contract above.

## Decision Authority (human-in-the-loop)

The `negotiate-bill` and `cancel-subscription` tasks encode who may say yes:

- **Ask me** (default): the agent may negotiate and capture the exact best offer
  but must **not** commit — it tells the rep the user will confirm shortly.
- **Autonomous under a limit** (`approvalMode: "auto"`, `autoAcceptBelow: <n>`):
  the agent may accept an offer at or below the stated monthly amount.

Never place an autonomous-commit call without the user explicitly choosing it and
setting the limit.

## Safety Rules

Read `references/safety.md` for the full contract. Always:

- Treat a phone call as a real-world side effect; require explicit user intent.
- Require caller-provided **E.164** numbers and region; never guess or repair them.
- Every generated task opens with a fixed **AI disclosure** (`build-task.mjs`
  states the agent must disclose it is an AI assistant at the start); do not
  remove or weaken it.
- **Dry-run first**; place a real call only after the user consents to that exact plan.
- Never invent account numbers, PINs, card numbers, or personal details; if asked
  for something not provided, the agent says it does not have it on hand.
- Do not make a binding commitment unless the user granted decision authority.
- Mask phone numbers in summaries; do not expose API keys or full numbers.
- Do not claim a call happened or a result was achieved unless CALL-E returned it.
- Do not give medical, legal, financial, or emergency advice on the call.

## References

- `references/playbooks.md`: every playbook's fields, option values, and result schema.
- `references/safety.md`: consent, PII, decision-authority, and phone-number rules.
- `references/examples.md`: worked end-to-end examples (compose → dry-run → execute) with sample structured results.
