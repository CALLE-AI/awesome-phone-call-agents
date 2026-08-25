---
name: ghost-network-audit
description: Audit a health-plan provider directory for ghost listings by placing one disclosed, administrative-only CALL-E phone call per listed office to confirm whether the provider still practices there, still accepts the plan, and is still accepting new patients, then score network adequacy from the call evidence.
---

# Ghost Network Audit

Health-plan provider directories are wrong at a rate that keeps people from getting
care. A listing says a clinician is in-network and taking patients; the caller finds a
disconnected number, a clinician who left three years ago, or a practice that stopped
accepting the plan. Those listings are "ghosts." Regulators treat directory accuracy as
a network-adequacy obligation, and the only way to test a listing is to call the office
and ask.

This skill turns that audit into a bounded, evidence-producing phone workflow: one
disclosed call per office, four administrative questions, a schema-validated answer, and
a scored report that separates *confirmed accurate*, *confirmed ghost*, and
*unverified* — without ever guessing which is which.

## When to use this

Use it when someone needs to know whether directory listings are real:

- a plan or provider-network team auditing its own directory before a filing or a review
- a digital-health or care-navigation product checking referral targets before it sends a patient
- a researcher or journalist measuring the ghost rate in a published directory
- an employer or benefits team validating that a purchased network is actually reachable

Do not use it to book care, to ask about a specific patient, or to ask any clinical
question. See "Hard boundaries" below — those limits are the reason this workflow is
safe to run at all.

## What it is not

This is an **administrative directory-accuracy check**, not a medical workflow. Every
question is about the office's own published business facts. Nothing about a patient,
a condition, a treatment, or a medication is ever spoken, requested, or recorded.

## Required inputs

The caller must supply, explicitly:

| Input | Meaning |
| --- | --- |
| `listings` | The directory rows to test. Each needs a listing id, provider name, specialty, office phone in E.164, and the plan/network name as published. |
| `auditing_organization` | The real organization on whose behalf the call is placed. Spoken in the disclosure. |
| `plan_name` | The exact plan or network name to ask about, as a patient would read it. |
| `callback_number` | A real number the office can call back to verify the audit is genuine. |

Never infer `plan_name` from a listing's internal code, and never let the model invent
an `auditing_organization`. A disclosure that names the wrong organization is worse than
no disclosure.

Read `references/call-contract.md` for the exact task text and result schema to send to
CALL-E, and read `references/adequacy-methodology.md` for how the score is computed.

## Workflow

### 1. Gate every listing before it becomes a call

A listing only becomes a call if it passes all of these. The gates run locally, before
any request reaches CALL-E:

- **E.164 required.** A listing whose phone is not valid E.164 is recorded as
  `skipped / bad_number` and never dialed. That is a data-quality finding, not a
  statement about the provider.
- **Line-type skip list.** Any listing whose number is flagged as an emergency line,
  after-hours line, nurse triage line, crisis line, or answering service is skipped
  permanently. Auditing a crisis line is never acceptable, even in a dry run.
- **Calling window.** Office local time only, weekdays, business hours. Outside the
  window the listing is deferred, not dialed.
- **Suppression list.** A number on the do-not-call list is never dialed, and — unlike
  the calling window — is not dialed in a dry run either.
- **One call per office per audit window.** Offices are de-duplicated by phone number,
  so a practice with nine listed clinicians receives one call asking about nine names,
  not nine calls.

### 2. Place one disclosed call

The first thing the call says is what it is: an automated call from
`auditing_organization`, verifying a public directory listing, with a callback number
offered. If the person asks to end the call, the call ends and the listing is recorded
as `unverified / declined` — a refusal is a valid outcome, not a retry trigger.

The call asks at most four administrative questions:

1. Does this provider still practice at this location?
2. Does this office currently accept `plan_name`?
3. Is this provider accepting new patients under that plan?
4. If yes, roughly how far out is the next new-patient appointment?

### 3. Read the answer without over-reading it

The result schema forces every field to be explicitly `yes`, `no`, or `unknown`. There
is no default and no inference. Voicemail, a hangup, an answering service, a language
barrier, and "I'd have to check" are all `unknown` — never `no`. A ghost is only a ghost
when someone at the office said so.

This is the single most important rule in the skill. A false ghost gets a working
clinician struck from a directory; a false confirmation leaves a patient calling a dead
number. Both failures are caused by treating "we could not tell" as an answer.

### 4. Score and report

`scripts/adequacy.mjs` computes the audit metrics — ghost rate, reachable rate,
accepting-new-patients rate, and appointment-wait distribution — over *confirmed* rows
only, and reports the unverified share alongside them so no metric can be quoted
without its own uncertainty. `scripts/report.mjs` renders the evidence table with every
phone number masked.

## Running it

The auditor runs with no credentials and places no calls by default. Use
`scripts/audit.mjs`:

```bash
# 1. Preview: shows exactly what would be sent, dials nothing, needs no API key.
node scripts/audit.mjs --listings scripts/sample-directory.json

# 2. Full offline rehearsal against the bundled fake CALL-E server.
node scripts/fake-calle-server.mjs &
node scripts/audit.mjs --listings scripts/sample-directory.json \
  --base-url http://127.0.0.1:8787 \
  --auditing-organization "Example Health Directory Audit" \
  --callback-number "+12125550100"

# 3. Render the HTML audit report from a finished run.
node scripts/report.mjs --run out/audit-run.json --out out/report.html
```

The sample directory spans four US timezones, so the calling-window gate will defer
every office outside business hours. Pass `--now 2024-06-11T17:00:00Z` — a Tuesday
midday across all four — to get the same reproducible run at any hour.

Run `node scripts/test.mjs` to execute the test suite. Everything is standard-library
Node with no dependencies.

### Going live

A live run places real phone calls to real offices. It requires **all** of:

- `CALLE_API_KEY` set in the environment, never passed as a flag and never written to a file
- `CALLE_LIVE_CALLS_ENABLED=1` set deliberately for that run
- the `--live` flag passed explicitly
- a `--auditing-organization` and `--callback-number` that are real

Missing any one of these previews instead of dialing. The default is always preview:
absence of a setting never means "go ahead and call."

## Hard boundaries

These are not configurable, and `references/safety.md` is the source of truth:

- **Administrative only.** No clinical questions, no symptoms, no medications, no
  treatment, no advice. If the office volunteers clinical or patient information, it is
  not recorded.
- **No patient identity.** The call never references a real patient, and never claims
  to be calling on behalf of one. It is not a secret-shopper call posing as a patient.
- **No booking.** The call asks how far out the next appointment is. It never holds,
  requests, or accepts an appointment slot.
- **No emergency or crisis lines.** Hard skip, no override flag.
- **Disclosure first.** Every call identifies itself as automated, names the auditing
  organization, and offers a callback number before asking anything.
- **Masked output.** Phone numbers are masked in every report, log, and summary.
- **No hidden recurrence.** A run is one pass over one list. Re-auditing is a new run
  that someone starts; the skill never schedules itself.

## Reading the output

Each listing ends in exactly one state:

| State | Meaning |
| --- | --- |
| `confirmed_active` | Someone confirmed the provider practices there and accepts the plan. |
| `confirmed_ghost` | Someone confirmed the provider does not practice there, or the office does not accept the plan. |
| `confirmed_closed_panel` | Provider and plan confirmed, but not accepting new patients. |
| `unverified` | No one answered, the call was declined, or the answer was not clear. Carries a reason. |
| `skipped` | Gated out before dialing. Carries a reason. |

Only the three `confirmed_*` states are evidence. `unverified` is a prompt for a human
follow-up call, never a directory edit.

See `references/examples.md` for worked runs, including the ambiguous ones.
