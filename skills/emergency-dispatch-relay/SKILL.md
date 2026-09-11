---
name: emergency-dispatch-relay
description: Preview an experimental human-confirmed dispatch relay, or make one authorized call to collect an advisory unit answer. Use to explore a human-to-unit notification workflow, never as autonomous emergency dispatch or a replacement for established command channels.
license: MIT
---

# Emergency Dispatch Relay

Use this skill when a dispatcher has already decided *"PCR Van 11 takes this
cardiac call in Shalimar Bagh"* and the remaining work is to reach the unit by
phone, say it, and record their answer — without a human dialing.

`emergency-dispatch-relay` is an experimental notification demo, not a validated
emergency-dispatch system. It submits one call attempt per invocation and asks
the voice agent to relay a human's decision and request a tri-state answer.
The CLI does not select units, reassign cases, or act on results. Prompt instructions
are not guaranteed conversational enforcement; established human command channels
remain authoritative and must not depend on this demo.

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

The prompt asks for `unknown` when the answer is uncertain. Provider output can
still be missing, invalid, or mistaken: the CLI displays it with `result_validation`
and an advisory flag, without certifying it. A completed call is not proof that a
unit accepted. A human must treat absent, invalid, or unclear answers as unknown,
verify any confirmation or ETA, and decide the next step. Never connect these
outputs directly to dispatch, escalation, or other consequential automatic actions.

## Safety Rules

1. **Human decision required.** No `--confirmed-by`, no call. The relay is
   the second half of a decision a human already made.
2. **Relay, never command.** The goal template forbids instructing the unit
   to move, changing the dispatch decision, and discussing other cases.
3. **Preview first.** Default mode prints the payload with phone-shaped text masked
   and places no call. The private provider request retains the original destination.
   `--real` is the only path to a
   phone call.
4. **Bounded side effect.** One submission, with a two-minute target in the goal
   rather than a client-enforced duration cap.
   No scheduling or recurrence lives in the skill — recurrence belongs to
   the host scheduler (provider/host separation).
5. **Authorized contacts only.** The operator must have the recipient's authorization
   and a human-confirmed assignment before adding `--real`. Output masks phone-shaped
   text and omits raw transcripts/provider errors, but does not remove every kind of
   personal data. Minimize incident details and keep any local records private.

## Setup

```bash
npm i @call-e/calle        # Node SDK for this JavaScript CLI; not needed for preview
export CALLE_API_KEY=...   # server/CLI side only
```

## Usage

```bash
# PREVIEW — fictional exercise, phone-masked output, no call or key needed:
node scripts/relay.mjs \
  --case-id KWR-0001 \
  --incident "Synthetic training exercise" \
  --location "Fictional training room" \
  --unit-name "Training unit" \
  --phone "+12025550123" --region US --locale en-US \
  --confirmed-by "fictional-operator"

# REAL — replace the fictional inputs with an authorized exercise recipient
# and a named human's confirmed assignment before adding --real:
node scripts/relay.mjs ... --real
```

## Side Effects & Cancellation

- `--real` submits one real outbound call attempt to the given number.
- PREVIEW mode (default) has zero side effects.
- There are no recurring jobs. This CLI has no cancellation operation: exiting it
  need not stop an accepted provider call. After an error or timeout, stop and
  reconcile manually before another intent. The stable case key requests provider
  deduplication; it is not an unlimited or crash-proof duplicate-call guarantee.

## References

- `references/goal-template.md` — the exact goal text and the rationale for
  every constraint line.
- `references/result-schema.json` — the tri-state result schema.

## Origin

Built for the [Kwik Relay](https://github.com/areycruzer/kwik-relay) console
(CALL-E hackathon 2026) — the outbound half of emergency dispatch.
