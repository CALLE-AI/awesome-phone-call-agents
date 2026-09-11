---
name: holdline
description: Ask one question of many places by phone and get back only the answers the call actually established. Use for batch phone enquiries where a wrong answer is worse than no answer — supplier stock checks, capacity and availability enquiries, claim and case status, directory verification. Includes evidence checking that catches values a call returns for questions it never asked.
---

# holdline

Place a batch of phone enquiries through CALL-E, then check every returned
field against the transcript turns the agent actually spoke. A field whose
question was never asked does not come back, whatever the model reported.

## When to use this

Use it when the same question goes to several places and a confidently wrong
answer causes real damage: sourcing a part across suppliers, checking which
clinics have capacity, chasing case status across agencies, verifying that a
directory listing is still true.

Do not use it for a conversation, for anything requiring negotiation or
judgement on the call, or where a person must decide something in the moment.
This asks a fixed question and records the answer.

## Safety

- **Real calls reach real people.** `run_hold` requires `confirm: true` in the
  same request. There is no setting that removes the confirmation.
- **Plan first.** `plan_hold` shows the compiled task, every number it would
  dial, and what the ledger already knows. It never dials.
- Do not guess phone numbers, country codes, or subject ids. Ask the user.
- Emergency and crisis-line prefixes are refused unconditionally and cannot be
  enabled by configuration.
- Every number in every response is masked. Do not attempt to reconstruct one,
  and do not echo raw numbers the user gave you back into a report.
- An unknown call outcome is never re-dialed. If `run_hold` returns
  `outcome: "unresolved"`, report it and stop; a retry rings a second person.

## Setup

**This directory is documentation. It contains no runnable code.** The three
tools below are served by an MCP server that lives in a separate repository,
and the commands here only work from a clone of it:

```bash
git clone https://github.com/Elioz404/HOLDLINE
cd HOLDLINE
npm install
export CALLE_API_KEY=...   # server-side only, never in client code
npm run mcp                # serves plan_hold, run_hold, get_verdict over stdio
```

Then point your MCP client at that command. Nothing in this skill directory is
executable, and running `npm` inside it will not work.

Without `CALLE_API_KEY`, `plan_hold` still works — planning needs no network —
and the dialing tools return an error saying exactly what is missing.

To exercise the tools with no CALL-E account at all, from the same clone:

```bash
HOLDLINE_SIMULATE=1 npm run mcp
```

Every response is then tagged `simulated: true` with a notice saying no
telephone was involved. Treat simulated output as a rehearsal, never as a
finding, and say so if you report it.

## Tools

### `plan_hold`

Compiles the task within CALL-E's 255-character limit, validates every number,
derives the idempotency key from the authorizing record, and reports which
targets the freshness ledger already answers. **Dials nothing.**

Start here every time.

### `run_hold`

Dispatches the batch as one call task with many recipients, then judges each
answer separately. Requires `confirm: true`.

Returns per target: a verdict, the gated result, and the reasons. Fields the
transcript does not support are `null`.

### `get_verdict`

Fetches a call by id and judges it. Use it to re-examine a call, or to
reconcile one whose outcome was unknown.

## Reading the verdicts

| Verdict | Meaning |
| --- | --- |
| `verified` | The agent raised the topic and a usable answer came back. |
| `asked_but_unclear` | The agent asked; the answer was not usable. |
| `unattributed` | Some question was asked and answered, but none of this field's probes match it, so the answer cannot be pinned here. |
| `attributed` | No probe matched, but exactly one question went unclaimed and this was the only unmatched field, so the answer can only have come from it. Weaker evidence than a match, and reported as such. Only appears when elimination is enabled. |
| `never_asked` | Nothing was asked that this value could answer. If a value came back anyway, it is flagged. |
| `no_transcript` | No transcript, so nothing could be checked. |

A batch verdict is `verified` only when every required field is `verified` —
or `attributed`, if the caller enabled elimination — and completion confidence
clears the floor. There is no partial pass.

`never_asked` with a value present is the case worth surfacing to the user: the
call returned something the conversation does not support.

## Writing probes

A probe is the list of phrases that identify the agent raising a topic. Write
the words the agent would actually say, not the field name.

```json
{ "name": "accepts_new_patients", "asks": ["new patients", "accepting new", "taking patients"] }
```

Matching is lexical, so a question phrased in words no probe contains reads as
`unattributed` and is withheld. That is the safe direction, but it costs a real
answer — see `references/probes.md` before writing them for a new workflow.

Every result carries `unclaimedQuestions`: the questions the agent asked that no
probe claimed, verbatim. If one of them is the question you meant to ask, add
its wording to that field. That is the fix; elimination is the fallback.

## Side effects and cancellation

`run_hold` places outbound calls, billed per call, one per dialable target,
dispatched together. Each target carries its own idempotency key derived from
`batchId`, `workflow`, `intent` and that target's subject id; running the batch
again fetches each existing call rather than dialing anyone a second time.

One call per target rather than one call with many recipients, because a
multi-recipient call returns no transcript turns and this skill has nothing to
verify without them.

Nothing in this skill schedules recurring work, so there is nothing to cancel.
A batch in flight cannot be recalled — the confirmation before dispatch is the
only stopping point.

## References

- `references/safety.md` — what a phone answer proves, and what it does not.
- `references/probes.md` — writing probes, and the failure they trade against.
