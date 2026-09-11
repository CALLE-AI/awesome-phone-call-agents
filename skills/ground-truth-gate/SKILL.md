---
name: ground-truth-gate
description: Use when an agent holds some evidence for a physical-world claim but the evidence is broader, narrower, or older than the exact question asked, and it must first decide whether a phone call is warranted at all. Triages the claim, answers provisionally, and gates the fact behind one disclosed CALL-E call to the party whose word is binding. When the decision to call has already been made, use verify-by-phone instead.
license: MIT
---

# Ground Truth Gate

## Overview

Some facts are not on the web. They live in one human's head, behind a phone number: whether the part is on the shelf at *this* branch, whether the unit is still available at the advertised price, whether the slot is really open today.

An agent asked for such a fact has three options, and the first two both fail the user. It can assert from stale text, which produces a confident wrong answer. It can hedge and tell the user to go call, which hands the work straight back. The third option is to gate the claim: answer provisionally now, place one disclosed call to the party that actually knows, and correct the record when the call lands.

**Core principle: absence of evidence is never evidence. A claim is released as fact only on positive evidence from an authoritative source, and only when the abstention gate agrees.**

## When To Use

- The agent is about to state a physical-world fact its sources cannot currently support, and it has not yet decided whether calling is justified.
- The evidence is stale, or its scope does not match the question asked. Text saying an item is "in stock at Northgate Appliance" does not answer "in stock at the Bellevue branch today".
- A wrong assertion is expensive and asymmetric: a wasted trip, a wired deposit, a missed deadline.
- The authoritative party is known and reachable by phone, and the user asked for the answer.

## When Not To Use

- **The decision to call is already made.** Use [`verify-by-phone`](../verify-by-phone/), which owns disclosed verification calls and the calibrated abstention this skill defers to.
- The fact is cheap to be wrong about, or a real API answers it authoritatively. Both are `disclose` or `answer` outcomes here, not calls.
- No authoritative phone contact was supplied by the user. Guessing a number is a blocker, never a default.
- The user has not asked for the answer. This skill never places a call to satisfy the agent's own curiosity.
- The question is time-critical to someone's safety. An emergency is not a claim to triage.

## The Contract

Every gated claim produces exactly these four parts, in this order:

1. `provisional` — the answer available right now, its evidence age, and why it is provisional.
2. `gap` — the single fact the call must establish, as one question a human can answer.
3. `call` — the call task placed to the authoritative party, or the blocker that stopped it.
4. `record` — the durable claim record the correction will be written back into.

`scripts/gate.py` builds all four as data (`format_contract`), so the contract is asserted rather than hoped for. A response missing any part is not a gated claim: with no `gap` nobody knows what the call is for, and with no `record` the correction has nowhere to land.

## Decide: Gate Or Pass

Evaluated in this order. The first row that matches wins.

| Condition | Action |
| --- | --- |
| Every term asked is covered by the evidence, and it is within the staleness limit (default 90 days; a per-claim override may only tighten) | `answer` directly |
| Being wrong is cheap | `disclose` the answer with its evidence age, place no call |
| The cost of being wrong is unknown | `blocked` — ask the user, never assume cheap |
| The user did not ask for this answer | `blocked` — curiosity is not intent |
| No phone contact, or not valid E.164 | `blocked` — state it, ask for the contact |
| Otherwise | `gate` the claim |

Scope comparison is a set of casefolded terms, not an ordered tuple: `("ppo", "aetna")` and `("aetna", "ppo")` are the same scope. The asked terms must be a subset of what the evidence covers.

## Consent And Disclosure

Every call this skill builds opens by identifying itself as an automated assistant, naming who it is calling for, and giving a recording notice, before it asks anything. It asks one question, once. It does not leave voicemail, does not ask for personal data, does not read identifiers aloud to establish trust, and ends the call if the conversation turns to medical, legal, financial, or emergency advice. `build_task()` is the only place a task string is constructed, and `self_test.py` asserts each of those clauses is present.

### Naming who is responsible

47 CFR 64.1200(b)(1)-(2) asks an artificial-voice call to name the entity responsible for it and give a callback number. Two environment variables supply them, because they are properties of the deployment rather than of any one claim:

| Variable | Effect |
|---|---|
| `CALLE_CALLER_IDENTITY` | Spoken as "This call is placed by ...". Unset means the opener stays as it is; it already identifies an automated caller. |
| `CALLE_CALLER_CALLBACK` | Appended as "reachable at ...". Ignored unless an identity is set. |

Both fail closed. The identity is spoken inside a quoted script, so a value carrying a straight or curly quote is refused rather than escaped - an apostrophe would close that script early and everything after it would reach the calling agent as a fresh instruction. The callback is validated as E.164 and never repaired by guessing. A half-filled disclosure is worse than the plain one, so a malformed value stops the call instead of going out half-right.


## Runtime Workflow

The call is asynchronous by design. A chat reply cannot wait for a phone call, and a phone call must not be hidden behind one.

```text
auth status -> POST /v1/calls -> webhook terminal event -> GET /v1/calls/{id} re-fetch
            -> release() -> write back correction -> notify user
            -> if no terminal event by T+6h: surface the claim as unresolved
```

**The re-fetch is not optional.** CALL-E webhook deliveries are unsigned, so a delivery proves nothing on its own; the authoritative state comes from `GET /v1/calls/{id}`. The webhook URL must also carry an unguessable path segment, which `require_public_https()` enforces along with refusing private and metadata addresses. See [`references/calle-api.md`](references/calle-api.md).

**The sweep is not optional either.** Silence looks identical to a pending correction. A gated claim with no terminal event by the deadline is surfaced to the user as still unconfirmed, rather than left waiting for a correction that is never coming. `sweep_due()` is that check.

Use `POST /v1/calls`, not the goal-run path. The extraction schema is `result_schema()` in `scripts/gate.py`; two rules make it safe, and both are enforced by test: every decision field is a string enum rather than a boolean, and every enum carries `unknown` with a description telling the extractor when to choose it.

## Verdict Rules

| Call result | Released as fact? | What the user is told |
| --- | --- | --- |
| `confirmed_true`, gate did not abstain | Yes | Confirmed, with the quote, who said it and when |
| `confirmed_false`, gate did not abstain | Yes, as a negative | Corrected, with the quote |
| `confirmed_true`, gate abstained | No | Still unconfirmed, quote shown as an unverified note |
| `refused_to_answer` | No | The party would not confirm, which is a normal outcome |
| `unknown`, no answer, voicemail, unreachable | No | Still unconfirmed, provisional answer stands unchanged |
| No abstention decision supplied at all | No | Still unconfirmed — a missing signal is itself absence of evidence |

Never collapse the bottom four rows into a yes. A call that did not happen is not a call that said yes.

This skill decides what counts as positive evidence. It does not decide how much confidence is enough: that rule is a calibrated abstention gate in `verify-by-phone`, so `release(verdict, abstain)` takes the abstain decision as an input. Only an explicit `False` releases. See [`references/composition.md`](references/composition.md) for the handoff.

## Common Mistakes

- Asking the wrong party. Ask the entity whose word is binding, not the one easiest to reach.
- Widening the question on the phone to make an answer likely. The gap is one question, asked as written.
- Booleans in the schema. `in_stock: false` cannot distinguish "no" from "nobody knew".
- Guessing the cost of being wrong. An unknown cost blocks; it does not quietly become cheap.
- Calling without the user asking. A phone call is a real-world side effect on a stranger's day.
- Trusting a webhook body. Re-fetch before you write.
- Overwriting the provisional answer silently. The user who acted on it is the one who must see the correction, on the same channel.

## Quick Start

`scripts/gate.py` triages a claim, prints the four-part contract, and builds the exact request body. It opens no sockets, needs no credential, and never places a call, so any decision can be reviewed before a phone rings.

```bash
python3 scripts/gate.py --demo
python3 scripts/gate.py --input assets/sample-claim.json --claim-id claim-42
python3 scripts/gate.py --reconcile assets/sample-result.json --abstain false
python3 scripts/self_test.py
```

## Side Effects And Cancellation

One outbound phone call per gated claim, plus one correction written into the claim record. Nothing in this directory places that call: the scripts build request bodies and print them. The user can withdraw a claim before the call is placed and no call happens; once a call is in flight it cannot be recalled, and the user is told that plainly rather than promised a cancel that does not exist. Anything that actually sends the request must set an idempotency key, or a network timeout becomes two calls to the same person. See [`references/safety.md`](references/safety.md).

## Files

| Path | What it is |
| --- | --- |
| `scripts/gate.py` | Triage, call construction, webhook validation, release rule |
| `scripts/self_test.py` | No-network regression checks |
| `assets/sample-claim.json` | Input fixture for `--input` |
| `assets/sample-result.json` | Terminal result fixture for `--reconcile` |
| `references/safety.md` | Consent, numbers, credentials, boundaries, storage |
| `references/calle-api.md` | Endpoint choice, webhook trust, schema rules |
| `references/composition.md` | What this defers to `verify-by-phone` and the host scheduler |
| `references/examples.md` | Worked claims, including the ones that do not call |
