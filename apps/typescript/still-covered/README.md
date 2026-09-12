# still-covered

**A phone screener that finds the people who are exempt from the new Medicaid work requirement and do not know it.**

In January 2027 the United States begins requiring most adults on public health coverage to prove,
every month, that they work or study enough hours to keep it. Most of the people who will lose
coverage already satisfy the rule or are exempt from it. They will lose it because nobody told them
they had to prove anything.

Medicaid is that public health coverage: roughly 70 million people in the United States, the largest
health programme in the country.

Starting 1 January 2027, most adults aged 19-64 on Medicaid must show 80 hours a month of work,
school, volunteering or job training - or about $580 a month in earnings - to keep their coverage
(P.L. 119-21 section 71119; CMS interim final rule CMS-2454-IFC, June 2026). Nine categories of
people are exempt. The Congressional Budget Office estimates millions will lose coverage anyway,
and the Arkansas experience says why: when Arkansas ran a work requirement in 2018, more than 18,000
people lost coverage in seven months and **there was no significant change in employment** - almost
everyone who lost coverage was already working or already exempt and simply never completed the
paperwork (Sommers et al., *NEJM* 2019). During the 2023-24 unwinding, 69% of all disenrollments
were procedural: the state could not reach the person, not that the person did not qualify.

Silence is the failure mode. `still-covered` attacks the silence directly.

It takes the enrollee list a state already has, **clears everyone the state's own data can clear
without calling them at all**, and then places one short CALL-E call to each remaining person - in
their language - that does three things and stops:

1. confirms it is really them, before saying anything about coverage;
2. explains the new rule in plain words, because most people have never heard of it;
3. asks only the exemption questions that this person's record has not already answered.

Nothing the agent says changes anyone's coverage. Every call becomes a **worklist item for a human**:
an exemption packet a caseworker reviews, an hours-reporting reminder, a navigator callback, or a
mailed letter for anyone the phone could not reach. The agent proposes; the code decides; a person
signs off.

## Why this is not a reminder bot

Health plans are already buying AI voice agents to call Medicaid members about renewal paperwork.
Those agents say *"your renewal is due, call us back."* They do not screen. The distinction matters,
because the whole finding of the Arkansas literature is that **most of the people at risk are already
exempt** - they lose coverage because nobody ever asked them the question that would have cleared
them. This app asks the question.

Three consequences run through the design:

- **Ex parte first.** If the state's own file already shows SNAP/TANF enrolment, a pregnancy flag, a
  tribal designation or a disability rating, the person is cleared with zero calls. In the sample
  registry that is 2 of 13 people. A call nobody needed is a harm, not a feature.
- **Fail closed.** No answer, ambiguous answer, cut-off call, or a condition without a daily-activity
  limit produces `needs_review`, never an exemption. The classifier never upgrades a verdict on the
  strength of the model's own confidence.
- **The agent never grants anything.** The call task forbids the words *"you are exempt."* If the
  transcript shows the agent overclaimed anyway, the code detects it and schedules a `correction_call`
  from a human. That check runs *before* any confidence downgrade, so an overclaim can never be
  hidden behind a low-confidence result.

## What a run looks like

```
$ npm run demo

fake CALL-E server started at http://127.0.0.1:4848 (no real calls can be placed in dry-run mode)
registry: Row e014 skipped: no consent to be called about coverage.
registry: Row e015 skipped: phone +14*******01 already belongs to another row.
registry: Row e016 skipped: on the do-not-call list.
Campaign example-state-2026-09-14: 13 people on the list, 2 cleared by state data, 11 to call.

Wave 1 (attempt 1): CALL-E task call_6da2dd9f for Maria Gonzalez +14*******01 (es-US).
  Maria Gonzalez: LIKELY EXEMPT [Caregiver of a person with a disability] -> packet
  Luis Ramirez: AT RISK -> navigator
  Aisha Mohammed: LIKELY EXEMPT [Pregnant or gave birth in the last year] -> packet
  Kevin Nguyen: UNREACHABLE -> retry
  Sandra Martinez: OPTED OUT -> suppress
  Ahmed Hassan: NEEDS REVIEW -> navigator + CORRECTION CALL
  James Carter: LIKELY MEETS -> report-reminder
  Linda Brooks: NEEDS REVIEW -> navigator
  Robert Lee: LIKELY EXEMPT [Medically frail: a condition that limits daily activities] -> packet
  Thomas Brown: IDENTITY UNCONFIRMED -> retry
  Patricia Wilson: DECLINED -> follow-up
Redialling 2 people not screened on the first pass.
  Kevin Nguyen: UNREACHABLE -> mail
  Thomas Brown: IDENTITY UNCONFIRMED -> mail

Campaign complete: likely exempt 3, likely meets 1, at risk 1, needs review 2,
cleared by data 2, not reached 2. Had not heard of the rule: 5 of 8.
Calls: 13. Worklist: 13 (1 correction call).
```

The two people cleared by state data - Daniel Kim, whose SNAP enrolment is already on file, and
Grace Thompson, whose wage data already shows the hours - were never called at all.

The numbers that matter to a state are in the last three lines: three people who were on track to
be disenrolled look exempt and now have a packet in front of a caseworker, five of the eight people
who answered had never heard of the rule, and one call where the agent said more than the answers
supported was caught and turned into a correction call from a human.

## Run it

No credentials, no network, no phone call:

```bash
npm install
npm test        # 47 tests
npm run plan    # who gets cleared without a call, the wave order, the exact call task
npm run demo    # full campaign against the bundled fake CALL-E server
npm run serve   # dashboard on http://127.0.0.1:4800
```

`plan` places no call and needs nothing configured. `demo` starts a local fake CALL-E API on
port 4848 and runs the whole campaign against it - webhooks, retries, idempotency replay and all.
In dry-run mode the base URL points at `127.0.0.1`, so a real call is not reachable even by mistake.

### Going live

Live mode needs three independent signals and refuses without all three:

```bash
cp .env.example .env      # set CALLE_API_KEY, SC_MODE=live, SC_LIVE_ALLOWLIST
npm run sc -- run --registry data/enrollees.private.csv --confirm
```

`SC_LIVE_ALLOWLIST` restricts dialling to specific numbers so a rehearsal cannot reach a real
enrollee. Quiet hours (21:00-08:00 local by default) are enforced with no override: coverage
outreach is never urgent enough to call at night. A live campaign can only be started from the CLI -
`POST /api/run` returns 403 when the server is in live mode, so nobody starts a real campaign from a
browser tab.

## Commands

| Command | What it does |
| --- | --- |
| `plan` | Load the list, show who the state's data clears, plan the waves, print the rendered call task. No calls. |
| `run` | Run a campaign. Dry-run by default; live needs `--confirm`. |
| `resume` | Reattach to an interrupted campaign: settle pending calls, re-place refused tasks with their original keys, finish the worklist. |
| `follow-up` | Call back the people who asked for a better time and are now due. |
| `serve` | Dashboard, webhook receiver, and drill launcher (dry-run only). |
| `report` | Rebuild the Markdown report from a campaign ledger. |
| `fake-server` | Run the local fake CALL-E API in the foreground. |

Full flag list: `npm run sc -- --help`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SC_MODE` | `dry-run` | `live` is one of the three signals required to dial a real number. |
| `CALLE_API_KEY` | none | Required in live mode. Never committed; `.env` is git-ignored. |
| `SC_LIVE_ALLOWLIST` | none | Comma-separated E.164 numbers. In live mode, nobody else is dialled. |
| `SC_STATE` | `example-state` | Which file in `states/` to load. |
| `SC_TIMEZONE` | system | Used for quiet hours and deadline arithmetic. |
| `SC_QUIET_HOURS` | `21:00-08:00` | Enforced in live mode with no override. |
| `SC_MAX_ATTEMPTS` | `2` | Calls per person including the redial. Values above 3 are rejected at load. |
| `SC_WAVE_SIZE` | `4` | People per wave. |
| `SC_PORT` / `SC_FAKE_PORT` | `4800` / `4848` | Dashboard and fake-server ports. |
| `SC_PUBLIC_URL` | none | Tunnel URL for webhooks. Setting it auto-generates a dashboard token. |
| `SC_DASHBOARD_TOKEN` | auto | Required on every dashboard route except the webhook. |

## How it works

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

- **`rules/federal-2027.json`** is the rule as data: the hours threshold, the plain-language
  explanation, the awareness question, and all nine exemptions with their question text, their order,
  their age gates and their documentation checklists. Changing the rule is a JSON edit, not a code
  change - which is the point, because states are still writing their own variations.
- **`states/*.json`** carries everything that differs by state: the calling organisation, how to
  report hours, the navigator line, and a voicemail script that is validated at load time to **not**
  mention Medicaid (a message on a shared answering machine should not disclose someone's coverage).
  Two states ship. `second-state` is one that did not adopt self-attestation, so it asks for
  documents; run `npm run sc -- plan --state second-state` and the entire call re-renders from that
  one file. A test asserts the two produce different call text, that neither state's wording leaks
  into the other's call, and that the federal policy questions stay word-for-word identical in both.
- **`src/tasks.ts`** renders the call task: privacy-first opening, the identity check, the
  explanation, only the questions this person still needs, three permitted closings, and the
  boundaries the agent may not cross.
- **`src/classify.ts`** is the whole trust boundary. The model returns a structured result; this file
  decides what it means, in a documented ten-step order, with the overclaim check first.
- **`src/ledger.ts`** is an append-only JSONL log. Every projection - the dashboard, the report, the
  resume logic - is derived from it, so a campaign is reproducible from the ledger alone and a crash
  mid-campaign loses nothing.

## Using the CALL-E platform honestly

The app is built around what the platform actually guarantees, not what would be convenient:

- **No cancel.** There is no API to cancel an in-flight call, so the wave size is the commitment -
  the code never over-dials expecting to stop.
- **Queued calls can outlive the client.** A create that times out may still dial, so every attempt
  carries `sc:<campaign>:<person>:attempt<n>` as its `Idempotency-Key`, and `resume` re-places refused
  tasks with the *same* key. The end-to-end test replays a key and asserts the same call id comes
  back rather than a second dial.
- **Webhooks are unsigned.** `CALL-E-Event-Id` is treated as a consistency check, not authentication:
  a mismatched header is rejected, a duplicate is acknowledged once, and the payload is never
  trusted - the waiter re-fetches the call from the API before classifying anything.
- **Webhook first, polling always.** If the webhook never arrives, polling still settles the call.
  If neither settles it in time, the person stays `pending` - never guessed.
- **`completion_confidence` is per task, not per recipient**, so it is only attributed when the task
  has a single recipient.
- **A refused task is `not_attempted`, never `unreachable`.** Nobody gets a letter, a navigator call
  or a verdict they did not earn because our request failed. The robustness test drives a full
  platform outage and asserts that all 11 people land in `operator_review` and nothing else.
- **The result schema stays inside the documented JSON Schema subset** - no `$ref`, `oneOf`, `anyOf`,
  `allOf`, `format`, or open `additionalProperties`. `assertSupportedSchema` fails the build rather
  than the call if that ever drifts.

## Safety

- Nothing about coverage is said before the person confirms their birth year, and the agent never
  says the year first.
- The agent never asks for a Social Security number, bank details, immigration status or a diagnosis.
- Phone numbers are masked (`+14*******01`) in the ledger, the dashboard, the report and the logs.
- Real enrollee lists must be named `*.private.csv`, which is git-ignored.
- Rows without consent, with an invalid phone, with a do-not-call flag, or duplicating another
  person's phone are never loaded.
- Anyone who asks not to be called again is suppressed for the rest of the campaign and handled by
  mail only.
- At most three calls per person per campaign, enforced as a hard cap regardless of configuration.
- AI voices are "artificial" voices under the TCPA (FCC 24-17), and this is consented outreach to an
  existing enrollee list about their own coverage (FCC DA 23-62) - not marketing.

The full list is in the skill: `skills/medicaid-exemption-screener/references/safety.md`.

## Tests

```
npm run check          # tsc --noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm test               # 47 tests, no network
npm run test:failures  # just the failure semantics - every test name is a guarantee
```

```
✔ a transient 429 on create is retried and the campaign finishes normally
✔ an outage marks people not attempted: nobody gets a letter, a navigator call or a verdict they did not earn
✔ an invalid request is not retried
✔ resume re-places refused tasks with the same keys and reaches the same end state
✔ a call that has not finished is left awaiting, never guessed, and resume settles it
✔ resuming a finished campaign places no new call and creates no duplicate work
✔ follow-up calls back someone who asked for a better time, at most three calls in total, then a letter
✔ someone who asked not to be called again is never called again
```

The suite covers the classifier's fail-closed order, the rule and state validators, registry parsing
and masking, a full end-to-end campaign with webhook delivery and idempotency replay, and the failure
semantics: a retried 429, a total outage, an invalid request that is *not* retried, a resumed
campaign that reaches the identical end state, the three-call cap, and the opt-out.

## Sources

- Sommers BD et al. "Medicaid Work Requirements - Results from the First Year in Arkansas."
  *N Engl J Med* 2019;381:1073-1082.
- Congressional Budget Office, coverage estimates for P.L. 119-21.
- KFF, Medicaid Enrollment and Unwinding Tracker - 69% of disenrollments were procedural.
- CMS interim final rule CMS-2454-IFC (June 2026), community engagement requirement.
- GAO, reporting on Georgia Pathways administrative costs.
- FCC DA 23-62 (Medicaid outreach consent); FCC 24-17 (AI voices under the TCPA).

This is a demonstration built for a hackathon. It is not legal advice, it is not a benefits
determination, and the bundled rule file summarizes federal law as of the cited sources - check your
own state's rules before any real use.
