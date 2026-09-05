---
name: countercall
description: Call a government service counter to find out exactly what a person must bring before they travel there, and return it as a validated checklist. Use when published requirements are incomplete or contradicted at the window and the only reliable source is the office's phone line. Returns required documents, total fee, payment method, whether an appointment is needed, and how certain the clerk sounded.
license: MIT
---

# CounterCall

Pak Yanto took the morning off work, rode forty minutes to the Samsat counter, and was
turned away because his photocopy was folio instead of A4. He lost a day's income, and he
still did not know what else was missing for tomorrow.

Public service counters publish requirement lists that are incomplete, outdated, or quietly
contradicted at the window. The one reliable source is the office's phone line, and that
line is busy, IVR-gated, and answered on the fourth try. So people do not call. They
travel, they queue, and they get turned away over one document.

This skill makes the call instead, and returns a checklist the person can screenshot and
take with them.

It is a good fit for CALL-E's design: low-frequency, personal, high-stakes phone work
against a number that a human would otherwise have to redial all morning.

## Before you start

**This skill places a real phone call to a real public office.** Confirm with the user:

- which procedure they are asking about, in the office's own words
- which office, and the phone number in E.164 format, from the office's published page
- that they want a call placed now

**Never infer a phone number.** Not from a directory, not from a similar office, not by
guessing a country code. A number enters the flow only when a human has read it off the
office's own published page. Calling the wrong number means an automated caller reaches a
stranger, which is the worst thing this skill can do.

## Safety boundaries

This skill gathers **counter requirements only**.

- It does not submit an application, book an appointment, pay a fee, or commit the user to
  anything. It asks and reports.
- It does not give legal or immigration advice. If a clerk suggests an alternative route,
  report it verbatim as something the clerk said, never as a recommendation.
- A clerk's spoken answer is **informational, not legally binding**, and every rendered
  result says so. Requirements change and individual counters apply discretion.
- It states plainly at the start of the call that it is an automated assistant, and why it
  is calling. If the person declines to answer, it thanks them and ends the call. It does
  not persist, re-ask, or call back the same day.
- **One call per office per procedure per day.** These are public service lines staffed by
  people with a queue in front of them. The idempotency key enforces this; do not remove it.
- When the clerk is unsure, the result says unsure. It never fills a gap with what is
  typical, and it never presents a hedge as a fact. A person may travel across a city on
  the strength of this answer.
- It calls offices during their published opening hours only. A public line ringing out at
  22:00 is not a data point, it is a nuisance.

Read `references/safety.md` before adapting this skill to a new institution. Some callees
are not appropriate targets for an automated caller at all.

## What makes this different from a transcript

Most call skills return prose and let the reader interpret it. This one returns a **pinned,
validated object**, and refuses to return anything else.

The Goal's `result_schema` sets `additionalProperties: false` and constrains four fields to
enumerations — `payment_method`, `appointment_required`, `originals_or_copies` and
`clerk_certainty`, each of which includes a value for "the clerk did not know". If the call comes back shaped differently, the result is quarantined rather
than rendered. A half-parsed checklist is worse than no checklist, because the user acts
on it.

The full contract is in `references/result-contract.md`.

## Workflow

### 1. Collect the request

Required: the procedure name, the office name, the office's phone number in E.164, and the
published source URL the number came from.

**Validate the number before anything else happens.** E.164 is a plus, a non-zero country
code digit, then 7 to 14 more digits: `^\+[1-9]\d{7,14}$`. Reject anything else and ask the
user. Never guess a country code. A local-format number reaching the dialler is how the
wrong person gets called.

Run `scripts/preflight.mjs` to check the number and the contract without dialling.

### 2. Check the published contract has not drifted

Before every run, read the live Goal interface and compare it against the contract this
skill was written for.

```js
const goal = await client.goals.get(GOAL_ID);
const drift = diffContract(PINNED_CONTRACT, goal.published_run_spec);
if (drift.length) throw new ContractDrift(drift);   // refuse to dial
```

The CALL-E documentation recommends this comparison before deploying a variable change.
Doing it on **every run** costs one API call and converts a silent failure into a loud
refusal. Dialling a real person with a stale schema produces a result that looks fine and
is quietly wrong.

### 3. Place one call

`goals.run` with an `Idempotency-Key` scoped to office, procedure and date, so a retry
never double-dials a public line:

```text
countercall:{office}:{procedure}:{yyyy-mm-dd}:v1
```

### 4. Poll to a result or an error

`goals.waitForResult` has one completion rule: stop when either `result` or `error` is
non-null. A completed call can briefly return both null while CALL-E parses the structured
result, so do not treat that window as a failure.

### 5. Render, or fail honestly

| Outcome | What the user sees |
|---|---|
| valid result | the checklist, with the clerk's verbatim line and the source URL |
| `no_answer` | "the line did not answer" and the number of attempts. No checklist |
| `declined` | "the office declined to answer an automated caller". No checklist |
| `result_invalid` | quarantined. No checklist, and the raw result is kept for inspection |
| `timed_out` | "no usable answer". No checklist |

**No branch renders a partial checklist.** Worked examples of each are in
`references/examples.md`.

## Running it

`scripts/call.mjs` is **dry-run by default**. It prints the exact request it would send and
places no call. Dialling requires an explicit `--live`:

```bash
node scripts/call.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor"
node scripts/call.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor" --live
```

A skill that dials by default is a skill that dials by accident.

## When not to use this

- **Emergencies.** This is a requirements lookup with a multi-minute latency. It is not a
  way to reach anyone urgently.
- **Offices with a published, reliable, current requirements page.** If the website is
  right, read the website. The call is justified only where the published answer is known
  to be incomplete.
- **Any institution that has asked not to be called by automated systems**, or where local
  law restricts automated calling. Check before adding an office.
- **High-volume lookups.** One office per procedure per day is the ceiling by design. If
  you need bulk, you need a data-sharing agreement, not a phone.
- **Anything where being wrong is cheap.** The value here comes from the cost of a wasted
  trip. If the user can simply go and find out, let them.

## Honest limitations

- Coverage is limited to offices in the seed file, each with a published-source URL.
- Answer rates on public service lines vary by office and time of day, and a large share of
  calls will not be answered. That unreliability is the reason this skill exists, and it is
  reported rather than hidden.
- The result is one clerk's answer on one day. It is evidence, not a guarantee.
