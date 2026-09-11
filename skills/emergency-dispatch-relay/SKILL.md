---
name: emergency-dispatch-relay
description: Phone a response unit to relay a human-confirmed emergency dispatch decision and collect a tri-state structured answer (unit accepted yes/no/unknown, ETA, notes) without ever instructing the unit to move. Use for 112/911-style control rooms notifying police, ambulance, or fire units, and any life-safety context where the AI must carry the decision, not make it.
license: MIT
---

# Emergency Dispatch Relay

Use this skill when a dispatcher has already decided *"PCR Van 11 takes this
cardiac call in Shalimar Bagh"* and the remaining work is to reach the unit by
phone, say it, and record their answer — without a human dialing.

`emergency-dispatch-relay` is a purpose-bound outbound workflow skill for
life-safety dispatch. It places exactly one bounded call per confirmed
assignment, relays the decision in the unit's language, and returns a
tri-state structured result. It does not select units, reassign cases,
instruct anyone to move, or promise anything to the unit.

The boundary this skill exists to enforce: **an AI voice can carry a human's
dispatch decision to a response unit — it must never become the decision.**

## When To Use

- emergency control rooms (112/911-style) notifying a response unit of an
  assignment a human dispatcher has confirmed in writing
- collecting unit availability and ETA as machine-readable data instead of
  scribbled notes
- multilingual relays — the goal is authored in English, the conversation
  runs in the unit's locale (`hi`, `en-IN`, and other CALL-E locales)
- any life-safety workflow where the caller side must stay auditable: the
  skill refuses to run without a named `--confirmed-by` human

## When Not To Use

Do not use this skill to:

- place any call without a recorded human dispatch decision — the script
  exits if `--confirmed-by` is missing
- instruct, order, or pressure a unit to move (the generated goal forbids
  it; movement is a command-chain action)
- notify next-of-kin, give medical instructions to civilians, or interview
  witnesses — wrong agent, wrong register
- triage inbound calls or grade severity — those happen before dispatch and
  belong to intake tooling
- run automated escalation waterfalls without a human gate between hops

## Result Schema

```json
{
  "unit_accepted": "yes | no | unknown",
  "eta_minutes": "12",
  "notes": "Bridge road blocked; taking alternate route."
}
```

`unknown` is a first-class value. A bad line, an unsure officer, or an
unanswered phone returns `unknown` — never a guess — so downstream consoles
keep a predictable shape for every possible real-world call.

## Safety Rules

1. **Human decision required.** No `--confirmed-by`, no call. The relay is
   the second half of a decision a human already made.
2. **Relay, never command.** The goal template forbids instructing the unit
   to move, changing the dispatch decision, and discussing other cases.
3. **Preview first.** Default mode prints the exact payload (goal, recipient,
   schema, metadata) and places no call. `--real` is the only path to a
   phone call.
4. **Bounded side effect.** One call, capped at two minutes by the goal.
   No scheduling or recurrence lives in the skill — recurrence belongs to
   the host scheduler (provider/host separation).
5. **No personal numbers in code.** Numbers arrive via flags or env;
   samples use masked placeholders.

## Setup

```bash
npm i @call-e/calle        # or: pip install calle-ai
export CALLE_API_KEY=...   # server/CLI side only
```

## Usage

```bash
# PREVIEW — prints the exact call payload, places no call:
node scripts/relay.mjs \
  --case-id KWR-0001 \
  --incident "Cardiac / breathing emergency (CRITICAL P1)" \
  --location "Shalimar Bagh B-block, Delhi" \
  --unit-name "PCR Van 11" \
  --phone "+919999XXXXXX" \
  --confirmed-by "dispatcher-a"

# REAL — places one call (locale defaults to hi, region IN):
node scripts/relay.mjs ... --real
```

## Side Effects & Cancellation

- `--real` places exactly one real outbound call to the given number.
- PREVIEW mode (default) has zero side effects.
- No recurring behavior exists inside the skill, so there is nothing to
  cancel post-hoc; cancellable retry patterns belong to the host.

## References

- `references/goal-template.md` — the exact goal text and the rationale for
  every constraint line.
- `references/result-schema.json` — the tri-state result schema.

## Origin

Built for the [Kwik Relay](https://github.com/areycruzer/kwik-relay) console
(CALL-E hackathon 2026) — the outbound half of emergency dispatch.
