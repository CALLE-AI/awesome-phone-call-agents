# Safety — calling a public service counter

This skill points an automated caller at a phone line staffed by a public servant who did
not opt in. That asymmetry drives every rule here.

## The consent line

The call opens by stating, before anything is asked:

> This is an automated assistant calling on behalf of a member of the public. I would like
> to ask what documents are required for one procedure. Is now a good time?

If the answer is no, or the person asks what this is and is unsatisfied, or asks to be
removed: **thank them and end the call.** Do not re-ask, do not rephrase the request as a
different question, do not call back the same day. Record the outcome as `declined` and
render no checklist.

## Rate discipline

**One call per office, per procedure, per day.** Enforced by the idempotency key:

```text
countercall:{office}:{procedure}:{yyyy-mm-dd}:v1
```

The key exists because these are queues with real people in them, not an API. A retry that
mints a fresh key is a bug, not a workaround. `no_answer` is the single exception: one
retry under a `:v2` suffix, then abstain for the day.

Call during the office's published opening hours only.

## Never infer a number

A number enters the seed file only when a human has read it off the office's own published
page and recorded the URL and the date they checked it. No directory scraping, no pattern
matching from a sibling office, no guessing a country code.

Every number is validated against `^\+[1-9]\d{7,14}$` before the dialler sees it. A
local-format number that reaches the dialler is how a stranger's phone rings.

## Report, never advise

The skill returns what a clerk said. It does not interpret it.

- If a clerk suggests a different route, that is reported as a quotation, attributed to the
  clerk, never as a recommendation from the system.
- No legal or immigration advice, ever, including "this usually means".
- Every rendered result carries: *a clerk's spoken answer is informational, not legally
  binding.* Requirements change, and individual counters apply discretion.

## Uncertainty is a first-class result

`clerk_certainty` is `confident`, `unsure`, or `refused`, and the rendered card shows it.

An individual field the clerk did not know stays **empty and grey** — not filled with a
typical value, not omitted so the gap disappears. A user may travel across a city on this
answer. An honest "we do not know the fee" costs them one question at the counter; an
invented fee costs them the trip.

Abstention is a correct output. Treat it as a success, not a degraded result.

## Do not point this at the wrong callee

Appropriate: a published general-enquiries line for a public office, during opening hours,
for a factual question that office answers many times a day anyway.

Not appropriate:
- personal mobile numbers of individual staff
- emergency, medical, or crisis lines, under any circumstances
- any institution that has asked not to be contacted by automated systems
- jurisdictions whose law restricts automated calling — check before adding an office
- anything where the question is not routine and factual

## Data handling

- The call is about a procedure, not a person. Do not send the user's name, identity
  number, case reference, or any other personal detail as a variable. The clerk does not
  need it, and it should not exist in a call record.
- Store the published source URL alongside every result, so any answer can be traced back
  to the office it came from.
- Credentials live outside the repository. `CALLE_API_KEY` is read from the environment and
  is never committed.

## If a call goes wrong

Stop. Do not retry into the same office. Record what happened, including the clerk's own
words if they objected, and treat it as a signal that the callee list needs revisiting
rather than as a transient failure to route around.
