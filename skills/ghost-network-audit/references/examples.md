# Worked examples

All numbers below are fictional reserved 555-01xx numbers, and every run shown here was
produced against the bundled fake server. Nothing in this file placed a call.

## Example 1: preview a run before anyone dials anything

```bash
node scripts/audit.mjs --listings scripts/sample-directory.json \
  --now 2024-06-11T17:00:00Z
```

```text
Preview mode. No calls will be placed.
  --live was not passed
  CALLE_LIVE_CALLS_ENABLED is not "1"
  CALLE_API_KEY is not set
  --callback-number was not provided
  --auditing-organization was not provided

Previewed 11 calls covering 15 listings. Nothing was dialed.

  offices that would be called   11
  offices skipped before dial    3
  offices deferred by the clock  1

  skipped   L-015  blocked_line_type:crisis
  skipped   L-016  bad_number
  skipped   L-017  suppressed
  deferred  L-018  no_timezone
```

Two things worth noticing.

The sample file has 18 listings but only 11 calls. Riverbend Behavioral Health lists
three clinicians on one number and Northgate lists two, so each of those offices is
called once and asked about all of its clinicians. Calling a front desk five times to
ask five variants of the same question is how automated callers get blocked.

The four excluded listings each say *why*. `L-015` is a 24-hour crisis line and is never
dialed under any flag. `L-016` has `555-0155` in the phone field, which is not E.164, so
it is a data-quality finding rather than a call. `L-017` is on the suppression list.
`L-018` has no timezone, so it is deferred for human scheduling instead of dialed on an
area-code guess.

## Example 2: full offline rehearsal

```bash
node scripts/fake-calle-server.mjs &
node scripts/audit.mjs --listings scripts/sample-directory.json \
  --base-url http://127.0.0.1:8787 \
  --now 2024-06-11T17:00:00Z \
  --auditing-organization "Example Health Directory Audit" \
  --callback-number "+12125550100"
```

```text
Rehearsal against http://127.0.0.1:8787. No real calls will be placed.

Confirmed 8 of 15 dialable listings (53.3% coverage). Within those confirmed listings:
50.0% were ghosts, 12.5% had closed panels, and 37.5% were actually usable by a new
patient. Median wait among usable listings was 11 weeks. 6 listings could not be
resolved and are reported as unverified, not as findings.

  coverage              53.3%
  ghost rate            50.0%
  closed panels         12.5%
  usable to a patient   37.5%
  median wait (weeks)   11
  unverified            6
  skipped before dial   3
```

Read that top line before the ghost rate. The audit confirmed just over half the
dialable listings, so "50% ghosts" is a finding about those eight listings — not about
the directory. The six unverified listings are not counted as accurate and not counted
as ghosts; they are a work queue for a human caller.

`usable to a patient` is the number that matters most and is the one directory-accuracy
reporting usually omits. A listing can be perfectly accurate — the clinician is really
there, the plan is really accepted — and still be unusable because the panel is closed.
Accuracy and availability are different failures.

## Example 3: the answers that are easy to over-read

These four calls all end without a finding. Getting any of them wrong is how an audit
produces damage instead of evidence.

| What happened on the call | Result fields | State | Why |
| --- | --- | --- | --- |
| Rang out to voicemail | `reached_office: "no"` | `unverified / no_answer` | A number that did not answer at 1pm on a Tuesday is a number that did not answer. It is not a disconnected line, and it is not proof the clinician left. |
| Front desk asked to end the call | `declined: true` | `unverified / declined` | A refusal is a valid outcome. The number goes on the suppression list and is never retried. |
| "I'd have to check with billing" | `accepts_plan: "unknown"` | `unverified / ambiguous_answer` | The single most common real answer. It is not a "no". |
| Answering service picked up | `reached_office: "no"` | `unverified / no_answer` | The service cannot speak to the listing, and the call does not try to navigate a phone tree toward a clinical queue. |

Compare with the two that *are* findings:

| What happened on the call | Result fields | State |
| --- | --- | --- |
| "Dr. Alvarez left the practice in 2022." | `practices_here: "no"` | `confirmed_ghost / provider_not_at_location` |
| "We stopped taking that plan in January." | `accepts_plan: "no"` | `confirmed_ghost / plan_not_accepted` |

A ghost requires a person at the office to have said so. Every path out of an `unknown`
lands on `unverified`, and there is no rule anywhere in the mapping table that converts a
missing answer into a negative finding.

## Example 4: a multi-clinician office where the answers differ

One call, three clinicians, three different outcomes:

```json
{
  "reached_office": "yes",
  "providers": [
    { "name": "Dr. Alice Nguyen", "practices_here": "yes" },
    { "name": "Dr. Ben Okafor", "practices_here": "no" },
    { "name": "Dr. Carla Mendes", "practices_here": "unknown" }
  ],
  "accepts_plan": "yes",
  "accepting_new_patients": "yes",
  "next_appointment_weeks": 6,
  "declined": false,
  "notes": "Dr. Okafor left last spring. Front desk was unsure about Dr. Mendes."
}
```

| Listing | State | Reason |
| --- | --- | --- |
| L-001 Dr. Alice Nguyen | `confirmed_active` | `verified` |
| L-002 Dr. Ben Okafor | `confirmed_ghost` | `provider_not_at_location` |
| L-003 Dr. Carla Mendes | `unverified` | `ambiguous_answer` |

The office-level answers (`accepts_plan`, `accepting_new_patients`) apply to all three,
but they never rescue a clinician the office could not speak to. Dr. Mendes does not
inherit a confirmation from the two clinicians beside her on the same call.

## Example 5: a run that should not be quoted

```text
Confirmed 2 of 40 dialable listings (5.0% coverage).
```

At 5% coverage there is no ghost rate worth reporting. This is a finding about the audit,
not the directory — almost always a calling window set to the runner's timezone instead
of the offices', or a list of numbers that all route to answering services during the
chosen hours. `summarize()` refuses to lead with a rate when nothing was confirmed, and
prints the diagnostic instead:

```text
No listing produced a confirmed answer across 40 dialable listings. This run says
nothing about the directory - it says the audit did not connect. Check the calling
window and the line-type gates before running again.
```

## Example 6: the disclosure is enforced, not just documented

The bundled fake server rejects a call whose task text does not introduce itself:

```text
CALL-E request failed (422). CALL-E asked for clarification before dialing: Who is this
call from? The task must name the auditing organization in an automated-call disclosure
before it asks anything.
```

This is deliberate. A fake server that accepts any payload only proves the client can
send one. The rehearsal is more useful when it fails the same way a reviewer would.

## Example 7: rendering the report

```bash
node scripts/report.mjs --run out/audit-run.json --out out/report.html
```

The HTML report leads with coverage, puts every headline percentage next to its
denominator, and lists every listing with the state and reason it ended in — including
the ones skipped before dialing. Phone numbers are masked to the country code and last
two digits everywhere they appear.
