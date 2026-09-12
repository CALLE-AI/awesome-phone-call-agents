# Still Covered

**Finding the people who are exempt from the 2027 Medicaid work requirement and do not know it.**

- App: [`apps/typescript/still-covered`](../../apps/typescript/still-covered/)
- Skill: [`skills/medicaid-exemption-screener`](../../skills/medicaid-exemption-screener/)

This is the long-form guide: the evidence the design rests on, the architecture, the failure
semantics, and how to reproduce every number in the demo. The app README is the short version.

![The dashboard after a campaign: one headline number for how many people had never heard of the
rule, then the outcome breakdown, the caseworker queue, and a card for every person](images/dashboard-complete.png)

*One number leads, because one number is the argument: five of the eight people who answered had
never heard of the rule. Everything below it is a queue for a human.*

![A person's detail panel showing every reason the classifier reached its verdict, the correction
required because the agent overclaimed, and four verbatim quotes](images/dashboard-person.png)

*Select anyone and the dashboard shows its working: every reason the code reached that verdict, the
person's own words, and - here - the correction call queued because the agent said more than the
answers support.*

---

## 1. The problem

From 1 January 2027, most adults aged 19-64 enrolled in Medicaid must demonstrate 80 hours a month
of work, education, volunteering or job training - or roughly $580 a month in earnings - to keep
their coverage. The requirement comes from P.L. 119-21 section 71119, with implementation detail in
the CMS interim final rule CMS-2454-IFC (June 2026). Nine categories of people are exempt: parents
of young children, pregnant and postpartum people, caregivers of disabled family members, the
medically frail, SNAP and TANF recipients, veterans with total disability ratings, people in
substance use treatment, former foster youth under 26, and American Indian and Alaska Native
enrollees.

The Congressional Budget Office estimates millions will lose coverage. The question is *who*, and the
answer is the part everyone skips.

**Arkansas already ran this experiment.** In 2018 Arkansas became the first state to implement a
Medicaid work requirement. Within seven months more than 18,000 people lost coverage. Sommers and
colleagues studied it and found **no significant change in employment** (*N Engl J Med*
2019;381:1073-1082). The people who lost coverage were not people who refused to work. They were
overwhelmingly people who were *already working* or *already exempt* and who never completed the
reporting. In surveys, most people subject to the requirement did not even know it applied to them.

**The 2023-24 unwinding said the same thing at national scale.** When continuous enrollment ended,
KFF's tracker put procedural disenrollments at **69% of all disenrollments** - people removed
because the state could not reach them or the paperwork did not come back, not because they were
found ineligible.

**And it is expensive to do badly.** GAO's work on Georgia Pathways documented administrative costs
that dwarfed the benefits paid, most of it spent on processing and chasing paperwork.

So the failure mode is not fraud and it is not unwillingness to work. It is **silence**. And the
interventions being deployed against it - portals, mailings, text campaigns, IVR - are all channels
that fail for exactly the people most likely to be disenrolled: no online account, mail returned,
limited English, previously disenrolled for paperwork.

A phone call that asks the right question in the right language is the one intervention that
addresses the actual failure. That is the whole idea.

## 2. What already exists, and what does not

Worth being precise here, because "AI calls Medicaid members" is not novel and we are not claiming
it is.

**What exists:** health plans and state contractors are already running AI voice outreach for
renewals. A Kern Health Systems / Careforce deployment reported in KFF Health News (4 August 2026)
placed roughly 800,000 calls to 387,000 members in 30+ languages for about $370,000. CMS-pledged
vendors run IVR and call-centre operations (Maximus, Gainwell) and outbound notice campaigns
(Deloitte). All of this says a version of *"your paperwork is due, please call us back."*

**What exists as screening:** exemption screeners exist, but only as self-service **websites** -
medicaidworkcheck.com, a state portal in Illinois - which require the person to already know the
rule exists, have internet access, and choose to act.

**What does not exist:** an outbound call that *screens*. Nobody is phoning the person who has never
heard of the rule and asking them the six questions that would clear them.

That gap is the entire submission. The distinction is not cosmetic: a reminder assumes the person
knows they need to act, and the Arkansas evidence is precisely that they do not.

## 3. What the system does

```
enrollees.csv ──▶ registry ──▶ ex parte clear ──▶ priority ──▶ waves
  (consent,       (masking)     (no call at all)   (deadline +    │
   E.164,                                           paperwork     │
   do-not-call)                                     risk)         ▼
                                              CALL-E calls.create
                                              one task per person
                                              idempotency key per attempt
                                                        │
                          webhook ─────┐                ▼
                          polling ─────┴──▶ classify (fail-closed, 10 steps)
                                                        │
                                                        ▼
                                          cascade ──▶ worklist ──▶ caseworker
                                          (retry / mail / navigator / packet)
```

### 3.1 Ex parte first

Before any call is planned, the enrollee's own record is checked. SNAP or TANF enrolment, a
pregnancy flag, a tribal designation, a veteran disability rating, wage data showing the hours are
already met - any of these clears the person with **zero calls**. In the sample registry that is 2 of
13 people.

A `no` in those same columns is almost as valuable: it removes one question from the call. Maria
Gonzalez gets six questions instead of seven because her record already answers one.

This is not an optimisation. Calling somebody to ask a question your own database already answered
is an intrusion, and at state scale it is a very large number of intrusions.

### 3.2 Priority is risk, not alphabet

Wave order is deadline band first (a coverage check within 150 / 200 / more days), then a paperwork
risk score built from the signals that actually predicted procedural disenrollment during the
unwinding:

| Signal | Points |
| --- | --- |
| Prefers a language other than English | +2 |
| No online account | +2 |
| Mail to them was returned | +3 |
| Lost coverage over paperwork before | +3 |
| Under 27 | +1 |

The person the portal and the mailer will fail is the person the phone should reach first.

### 3.3 The call

One CALL-E call task per person, rendered from the rule file and the state file, in the person's
language. It does four things in a fixed order:

1. **Identity, before anything else.** "Am I speaking with Maria?" then a birth-year check. The
   agent is told, explicitly, never to say the year itself. Nothing about Medicaid or coverage is
   said until both match. If they do not, the agent leaves a neutral callback message.
2. **The awareness question, before the explanation.** "Before this call, had you heard about the new
   Medicaid rule about work hours that starts in January?" Asked first, or the answer is worthless.
3. **The explanation, in plain words**, and only then.
4. **Only the questions this person still needs**, in prevalence order, stopping at the first yes.

Then one of exactly three permitted closings, how to report, the self-attestation note, and an offer
of a human navigator.

Roughly two minutes. The full rendered task for a Spanish-speaking enrollee is printed by
`npm run plan` and is worth reading in full - it is the actual product.

### 3.4 The verdict is not the agent's

`src/classify.ts` is the trust boundary. CALL-E returns a structured result; the code decides what it
means, in a documented order:

1. No completed attempt → `unreachable`
2. Completed but no valid structured result → `unverified`
3. "Do not call me again" → `opted_out` (wins over everything)
4. Voicemail or nobody identifiable → `unreachable`
5. Wrong person or identity unconfirmed → `identity_unconfirmed`
6. Asked for a better time → `declined`
7. Call ended mid-screening → `unverified`
8. An exemption answered yes → `likely_exempt` (medical frailty needs **both** a condition and a
   daily-activity limitation)
9. 80+ hours or $580+ → `likely_meets`
10. Everything answered no and hours known short → `at_risk`; anything unclear → `needs_review`

Then two final passes: **the overclaim check**, and only after it, the low-confidence downgrade.

Order matters there. If the agent told someone they may qualify when the answers do not support it,
that must produce a correction call from a human - and if the confidence downgrade ran first, the
overclaim would be silently absorbed into `needs_review` and nobody would ever call Ahmed back. The
end-to-end test pins this:

```ts
assert.equal(s.get("e011")?.correctionNeeded, true, "the agent overclaimed, so a person must correct it");
```

### 3.5 Everything becomes human work

No outcome is an endpoint. Each becomes a worklist item: `exemption_packet` (needs caseworker
review), `report_hours`, `navigator_callback`, `mail_letter`, `correction_call`, `suppression`,
`operator_review`. In the sample campaign, 13 items, 4 waiting on a caseworker.

Nothing in this system changes anyone's coverage, and it is not able to.

## 4. Building honestly on CALL-E

The platform has real constraints. Designing around them rather than pretending they do not exist is
most of the engineering.

| Constraint | What the app does |
| --- | --- |
| No API to cancel an in-flight call | Wave size is the commitment. Never over-dial expecting to stop. |
| A create that times out may still dial | Every attempt carries `sc:<campaign>:<person>:attempt<n>` as its `Idempotency-Key`; `resume` re-places refused tasks with the *same* key. Tested by replaying a key and asserting the same call id. |
| Webhooks are unsigned | `CALL-E-Event-Id` is a consistency check, not authentication. Mismatch → 400. Duplicate → acknowledged once. The payload is never trusted; the waiter re-fetches the call. |
| A webhook may never arrive | Webhook first, polling always. If neither settles it, the person stays `pending` - never guessed. |
| `failure_code` is not a published enum | Recorded as an opaque string for the operator, never branched on. |
| No `answered_by` disposition | Voicemail detection comes from the structured result, and a voicemail gets only the neutral message. |
| `completion_confidence` is per task, not per recipient | Attributed only when the task has a single recipient. |
| Two recipients sharing a phone collapse into one run | Duplicate phones are refused at registry load rather than silently merged. |
| JSON Schema subset | `assertSupportedSchema` rejects `$ref`, `oneOf`, `anyOf`, `allOf`, `format`, open `additionalProperties` - failing the build rather than the call. |
| ~23s of silence before the first bot word | Recorded per call as `firstBotTurnOffsets` so the operator can see it, and the opening line is written to survive it. |

**The most important line in the failure semantics:** a task CALL-E refuses is `not_attempted`, never
`unreachable`. Our infrastructure failing is not evidence about the enrollee. The robustness suite
drives a total outage and asserts that all 11 people land in `operator_review` and nothing else - no
letters, no navigator calls, no verdicts.

## 5. Safety

Summarized here; the full list is
[`references/safety.md`](../../skills/medicaid-exemption-screener/references/safety.md).

- **Consent is mandatory and not overridable.** Rows without `consent=yes` never load. Do-not-call
  rows never load. Invalid phones are refused, not normalised.
- **Identity before disclosure**, always, with the agent never offering the birth year.
- **The voicemail may not mention Medicaid** - validated at load time, because answering machines are
  shared.
- **The agent never asks** for a Social Security number, bank details, immigration status or a
  diagnosis.
- **The agent never grants anything.** "Never say they are exempt" is in the task; the overclaim
  check is in the code.
- **`tribal` is never asked on a call.** Its question is `null` and `validateRules` fails the load if
  that ever changes. Asking someone to declare their ancestry to a robot to keep their health
  coverage is not an acceptable interaction.
- **Three calls per person per campaign, maximum**, as a hard cap independent of configuration.
- **Quiet hours 21:00-08:00 with no override.** Coverage outreach is never urgent enough to call at
  night.
- **Live requires three independent signals** - `SC_MODE=live`, `CALLE_API_KEY`, `--confirm` - plus an
  allowlist for rehearsals, and `POST /api/run` returns 403 in live mode so no campaign can start
  from a browser.
- **Phone numbers are masked everywhere** outside the operator's own file; real lists must be named
  `*.private.csv`, which is git-ignored.
- **Legally**: consented non-marketing outreach to existing enrollees about their own benefits
  (FCC DA 23-62); an AI voice is an "artificial" voice under the TCPA (FCC 24-17), so the call
  identifies itself as automated in its first sentence.

## 6. Reproducing the demo

No credentials, no network, no phone call:

```bash
cd apps/typescript/still-covered
npm install
npm test        # 46 tests
npm run plan    # who is cleared without a call, the wave order, the rendered task
npm run demo    # the full campaign against the bundled fake CALL-E server
npm run serve   # dashboard at http://127.0.0.1:4800
```

Expected end state, asserted in `test/e2e.test.ts`:

```
cleared_by_data 2   likely_exempt 3   likely_meets 1   at_risk 1   needs_review 2
declined 1   opted_out 1   identity_unconfirmed 1   unreachable 1
13 calls   13 worklist items   4 needing caseworker review
Had not heard of the rule: 5 of 8 who answered (63%)
```

The fake CALL-E server implements `calls.create`, `calls.get`, `calls.listEvents`, idempotency
replay, webhook delivery, thirteen behavioural scenarios and injectable failures. Every test runs
against it, so the whole system - including the failure paths - is verifiable by a judge with no
account and no credits.

## 7. Test coverage

46 tests, no network:

- `classify.test.ts` - the fail-closed order, including medical frailty needing both answers, and the
  overclaim check surviving a confidence downgrade.
- `rules.test.ts` - `validateRules` (tribal must have no question; frailty must have a follow-up) and
  `validateState` (the voicemail must not mention Medicaid); question selection and age gating.
- `registry.test.ts` - consent, E.164, duplicate phones, do-not-call, the `known_*` columns, CSV
  quoting and CRLF, masking.
- `e2e.test.ts` - a full campaign with webhook delivery, idempotency replay, the Spanish-language
  evidence assertion, worklist composition, report reproducibility, and a 403 on live drill start.
- `robustness.test.ts` - a retried 429, a total outage, a 422 that is *not* retried, resume
  equivalence, resume idempotence, the three-call cap, and the opt-out.
- `safety.test.ts` - quiet hours across time zones, refused configurations, the live allowlist, and
  the dashboard token.

`npm run check` runs `tsc --noEmit` under `strict` plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`.

## 8. Limitations

Said plainly, because a judge will find them anyway:

- The bundled rule file summarizes **federal** law as of its cited sources. States are still writing
  their own variations, and a real deployment needs the state's rules.
- The sample registry is fictional and the demo runs against a fake server. Live calls were
  rehearsed against consenting participants on an allowlist only.
- The system proposes; it never determines. Every favourable outcome waits on a human.
- Automated screening cannot reach people with no working phone. That is what the `mail_letter` and
  community-outreach items exist for, and why "not reached" is reported as a first-class outcome
  rather than folded into a success rate.

## 9. Sources

- Sommers BD, Goldman AL, Blendon RJ, Orav EJ, Epstein AM. "Medicaid Work Requirements - Results
  from the First Year in Arkansas." *N Engl J Med* 2019;381:1073-1082.
- Congressional Budget Office, coverage estimates for P.L. 119-21.
- KFF, Medicaid Enrollment and Unwinding Tracker (69% of disenrollments procedural).
- KFF Health News, 4 August 2026, on AI voice outreach at Kern Health Systems.
- CMS interim final rule CMS-2454-IFC (June 2026), community engagement requirement.
- GAO reporting on Georgia Pathways administrative costs.
- FCC DA 23-62 (Medicaid outreach consent); FCC 24-17 (AI voices under the TCPA).

Not legal advice. Not a benefits determination. Check the state's own rules before any real use.
