# call-rehearsal

Rehearse a CALL-E call plan against every realistic ending of the call, and find
out what your automation does on each one, before a phone rings.

A call plan is the three things that together decide whether a phone workflow is
safe to automate: the `task` the agent speaks, the `result_schema` the call
returns, and the decision rule the surrounding automation applies to that result.
Each is usually reviewed on its own. The expensive bugs live in the seam between
them.

## The bug this catches

A delivery confirmation call. The schema has one field, `confirmed`. The
automation dispatches unless the customer said no:

```text
confirmed != false  ->  dispatch the courier
```

That reads fine. Now the customer's voicemail picks up. Nothing was said, so
nothing is extracted, so `confirmed` is absent, and `absent != false` is true.
**The courier is dispatched because nobody answered the phone.**

The same hole swallows a refused consent, a receptionist who would not pass the
call on, and someone who is not the customer saying "yes, that's fine".

```console
$ python3 -m callrehearsal examples/delivery-confirmation-unsafe.json
Rehearsing call plan: delivery-confirmation (before)
No calls are placed. Nothing is dialled.

What the automation does for each way the call can end:

    Verified human confirmed               ->  dispatch the courier  (side effect)
    Verified human declined                ->  hold the order  (no side effect)
 !! Consent refused                        ->  dispatch the courier  (side effect)
 !! Wrong person answered and agreed       ->  dispatch the courier  (side effect)
 !! Voicemail answered                     ->  dispatch the courier  (side effect)
 !! Nobody answered                        ->  dispatch the courier  (side effect)
    ...

  CRITICAL [voicemail] 'dispatch the courier' runs when voicemail answered
      An answering machine picked up and no person was reached. No person was
      reached at all. The result {} (nothing was extracted) still resolves the
      decision rule to 'dispatch the courier', which changes the real world.
```

Ten of the twelve endings dispatch the courier. Two of them are a real
confirmation and a real refusal.

## Where this sits

Two other pieces of this repository check a call before it goes out, and this is
the third, doing something neither of them does.

| | What it checks |
| --- | --- |
| [`calle-script-advisor`](../../../skills/calle-script-advisor/) | The `task` text and schema, read statically for clarity and extraction quality. |
| [`voice-preflight`](../../../skills/voice-preflight/) | Whether the critical lines survive being spoken aloud. |
| `call-rehearsal` | Whether the structured result can survive how the call actually ends, and what the automation does when it does not. |

## Install

None. Python 3.9 or newer, standard library only, no dependencies, no
credentials, no network access.

```bash
cd apps/python/call-rehearsal
python3 -m callrehearsal examples/delivery-confirmation-unsafe.json
```

## Side effects

This app places no calls. It reads one JSON file and writes to stdout. There is
nothing to cancel and nothing to roll back, because nothing is ever dialled and
no scheduler job is created. It is safe to run in CI on every commit.

It never reads a CALL-E credential, so there is no credential to handle.

## Usage

```bash
python3 -m callrehearsal <plan.json>                  # readable report
python3 -m callrehearsal <plan.json> --json           # machine-readable report
python3 -m callrehearsal <plan.json> --fail-on critical
python3 -m callrehearsal <plan.json> --suggest-fields # candidates, applied to nothing
```

Exit codes follow the convention used elsewhere in this repository:

| Code | Meaning |
| --- | --- |
| `0` | Nothing at or above the failure threshold. The plan may go out. |
| `20` | The plan should not go out as written. |
| `30` | The plan could not be read, so nothing was rehearsed. |

Gate a workflow on it:

```bash
python3 -m callrehearsal call-plans/delivery.json --fail-on high
```

## The call plan

```json
{
  "name": "delivery-confirmation",
  "task": "You are calling on behalf of Northwind Logistics ...",
  "result_schema": {
    "type": "object",
    "properties": {
      "call_status": { "type": "string" },
      "identity_verified": { "type": "boolean" },
      "consent_given": { "type": "boolean" },
      "confirmed": { "type": "boolean" }
    },
    "required": ["call_status"]
  },
  "fields": {
    "decision": "confirmed",
    "reachability": "call_status",
    "consent": "consent_given",
    "identity": "identity_verified"
  },
  "decision_rule": {
    "expression": "confirmed == true and identity_verified == true and consent_given == true",
    "on_true": { "action": "dispatch the courier", "side_effect": true },
    "on_false": { "action": "hold the order", "side_effect": false }
  }
}
```

`fields` maps result fields onto the roles the rehearsal reasons about:
`decision`, `reachability`, `consent`, `identity` and `deferral`. Only
`decision` is required.

**Roles are declared, never inferred.** This repository's design principles say a
workflow must not guess critical values, and which field carries a decision is
exactly such a value. Guessing it wrong would rehearse the wrong thing and then
report a clean run. `--suggest-fields` will offer candidates for a human to pick
between, and selects none of them.

### Decision expressions

The expression is evaluated, never executed. It is parsed to an AST and rejected
unless every node is on a small allow-list, so a call plan from a pull request
cannot run code. There is no attribute access, no indexing and no arbitrary
call; the only callables are `is_missing(field)` and `is_present(field)`.

A field the call never established evaluates to a `MISSING` sentinel that is
falsy and equal to nothing, which is precisely how `result.get("confirmed")`
behaves in real automation code. Modelling that faithfully is what makes the
silently-skipped confirmation visible.

## What gets rehearsed

Twelve endings, in [`callrehearsal/outcomes.py`](callrehearsal/outcomes.py):
verified confirmation and refusal, deferral, callback request, ambiguous answer,
partial answer, refused consent, wrong person, gatekeeper, voicemail, no answer,
and a failed connection.

Only one of them is a confirmation. An outcome counts as a confirmation when a
verified callee, who consented to the call, said yes. Every branch marked
`side_effect: true` that fires on anything else is reported as `CRITICAL`.

| Finding | Severity | Meaning |
| --- | --- | --- |
| `unsafe-side-effect` | critical | A branch that changes the real world runs on an ending that is not a confirmation. |
| `indistinguishable-from-confirmation` | high | A non-confirmation produces byte-identical results to a real one, so no audit can separate them. |
| `unrecordable-outcome` | high / medium | The schema has no field for reachability, identity, consent or deferral, so that distinction is lost. |
| `unsatisfiable-required-field` | medium | A `required` field cannot be established on some endings, so the result violates its own schema. |
| `task-silent-on-outcome` | low | The task text gives the agent no instruction for a path, so behaviour there is improvised. |

## Fixing a plan

[`examples/delivery-confirmation-safe.json`](examples/delivery-confirmation-safe.json)
is the same call after the two changes the report asks for: record what actually
happened on the line, and require a confirmation rather than the absence of a
refusal.

```console
$ python3 -m callrehearsal examples/delivery-confirmation-safe.json
No findings. Every ending that is not a verified confirmation stays away from
the side-effecting branch.
```

## Tests

```bash
cd apps/python/call-rehearsal
python3 -m unittest discover -s tests -t .
```

29 tests, offline, no calls placed. They cover the expression sandbox
(including that `__import__`, attribute access and indexing are rejected), plan
validation, outcome projection, and the exit codes.

## Limits

The outcome library is a model of how calls end, not a transcript of any real
one. It reasons about the *shape* of the result, not the words spoken, so it
cannot tell you whether the agent's phrasing is persuasive or whether extraction
quality is good on a real line. Use `calle-script-advisor` and `voice-preflight`
for those. A clean rehearsal means the plan survives the endings in the library;
it is not a guarantee about a live call.
