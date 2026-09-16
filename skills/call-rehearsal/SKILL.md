---
name: call-rehearsal
description: Rehearse a phone call plan against every realistic ending of the call before dialling anyone, and refuse a plan whose automation acts on a call that never reached a consenting human.
license: MIT
---

# Call Rehearsal

A CALL-E call returns a structured result, and something downstream acts on it.
The dangerous failure is not a call that fails loudly. It is a call that never
reached a consenting human whose result still resolves to the branch that ships
the order.

That happens because an unestablished field is absent, and absent is falsy. A
rule as ordinary as `confirmed != false` is true when voicemail picked up and
nothing at all was extracted.

This skill covers finding that before the call, by rehearsing the plan against
the ways calls actually end.

## When to use it

Use it before the first real call of any workflow whose result triggers a
real-world side effect: dispatching, shipping, charging, cancelling, granting
access, or writing a confirmation into a system of record. Use it again whenever
the `task`, the `result_schema`, or the rule that reads the result changes, since
this failure is introduced by editing any one of the three without the others.

Skip it for a call whose result nobody acts on automatically. A call that only
produces a note for a human to read has no branch to get wrong.

## The procedure

1. **Name the single decision.** Write down the one thing the call exists to
   establish. If there seem to be several, the call is doing too much and the
   rehearsal will show the decision field carrying weight it cannot hold.
2. **Write the call plan.** One JSON file with the `task`, the `result_schema`,
   the `fields` roles, and the `decision_rule` including what each branch does
   and whether it changes the real world.
3. **Declare the field roles.** Map result fields onto `decision`,
   `reachability`, `consent`, `identity` and `deferral`. Only `decision` is
   required. Do not guess a role: if you cannot say which field carries the
   decision, ask the person who owns the workflow.
4. **Rehearse.** Run the plan and read what the automation does for each ending.
5. **Gate on the exit code.** `0` means no ending above the threshold reaches a
   side effect, `20` means the plan should not go out as written, `30` means the
   plan could not be read.

```bash
cd apps/python/call-rehearsal
python3 -m callrehearsal <plan.json> --fail-on high
```

No call is placed, no credential is read, and nothing connects to the network,
so rehearsing is always safe, including in CI on every commit.

## Reading the result

Every ending that is not a verified, consenting yes must land on a branch with
`side_effect: false`. A `CRITICAL` finding means one did not.

The two fixes that resolve almost every report:

- **Record what happened on the line.** Add fields for reachability, identity
  and consent, so voicemail is distinguishable from a refusal and a stranger
  saying yes is distinguishable from the callee saying yes.
- **Require a confirmation, not the absence of a refusal.** Replace
  `confirmed != false` with `confirmed == true`, and conjoin the identity and
  consent fields.

Read `references/examples.md` for a worked before-and-after, and
`references/safety.md` for the rules about what may follow a call.

## What this does not do

It reasons about the shape of the result, not the words spoken. It cannot tell
you whether the phrasing is persuasive or whether extraction is reliable on a
live line. Use `calle-script-advisor` for the task text and schema, and
`voice-preflight` for what the critical lines sound like when spoken. A clean
rehearsal means the plan survives the endings in the library, which is not a
guarantee about any individual real call.
