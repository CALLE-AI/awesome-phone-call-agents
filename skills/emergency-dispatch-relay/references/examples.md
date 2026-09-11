# Examples

Synthetic worked examples for `emergency-dispatch-relay`. The reserved fictional
phone is only for no-call preview; live exercises require an authorized recipient.
Result snippets illustrate requested output, not guaranteed or verified decisions.

## Example 1 - The ordinary relay

**Request:** dispatcher confirms PCR Van 11 for a cardiac call.

**Command (preview):**

```bash
node scripts/relay.mjs \
  --case-id KWR-0001 \
  --incident "Cardiac / breathing emergency (CRITICAL P1)" \
  --location "Shalimar Bagh B-block, Delhi" \
  --unit-name "PCR Van 11" \
  --phone "+12025550123" --region US --locale en-US \
  --confirmed-by "dispatcher-a"
```

**Illustrative advisory structured result:**

```json
{
  "unit_accepted": "yes",
  "eta_minutes": "12",
  "notes": "Leaving now via outer ring road."
}
```

A human reviews the answer before recording any confirmation in a separate console.
The CLI makes no case-state mutation and does not certify acceptance or prompt adherence.

## Example 2 - The uncertain answer, which stays unknown

**Request:** fire tender relay after a market blaze call.

**What happened:** the line was noisy; the officer started answering, then
the call dropped mid-sentence.

**Illustrative advisory result (missing or invalid output is also possible):**

```json
{
  "unit_accepted": "unknown",
  "eta_minutes": "unknown",
  "notes": "Answer cut off; line appeared unstable."
}
```

`unknown` is not retried silently. The skill returns it to the human
dispatcher, who decides whether to call again or assign another unit.

## Example 3 - The refusal that guards the boundary

**Request:** an automation pipeline invokes the script directly, without a
human dispatch decision on record.

**Command:**

```bash
node scripts/relay.mjs --case-id KWR-0007 --incident "..." \
  --location "..." --unit-name "Ambulance 302" --phone "+12025550123" --real
```

**Result:** the script exits non-zero:

```text
Usage: relay.mjs --case-id K1 --incident "..." --location "..." --unit-name "..." --phone +E164 --confirmed-by "name" [--locale hi] [--real]
```

No call is placed. The relay only ever carries a decision a named human has
already made.

## Example 4 - The declined unit, handed back

**Request:** ambulance relay for a road accident.

**Result returned:**

```json
{
  "unit_accepted": "no",
  "eta_minutes": "unknown",
  "notes": "Already transporting a patient to Trauma Centre."
}
```

A dispatcher verifies the answer before marking a case declined in their own
console or choosing another unit. The CLI does not mutate case state or
auto-escalate — those decisions remain with a person.
