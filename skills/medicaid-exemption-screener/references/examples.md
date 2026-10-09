# Worked examples

Every example below runs against the bundled fake CALL-E server: no network, no credentials, no
phone call. The sample registry (`data/enrollees.sample.csv`) has 16 rows, a `scenario` column that
tells the fake server how each person behaves, and 13 people who actually load.

## 1. Plan before you call

```bash
npm run plan
```

```
registry: Row e014 skipped: no consent to be called about coverage.
registry: Row e015 skipped: phone +14*******01 already belongs to another row.
registry: Row e016 skipped: on the do-not-call list.

Cleared by state data, no call: Daniel Kim (state records already show: Gets SNAP or TANF and meets their work rules)
Cleared by state data, no call: Grace Thompson (state wage or income data already shows the requirement is met)

Wave 1 (priority 1)
  Maria Gonzalez     +14*******01     es-US  6 questions  139 days until the coverage check, prefers a
                                                          language other than English, no online account,
                                                          lost coverage over paperwork before
  Luis Ramirez       +14*******05     es-US  6 questions  ...
  Aisha Mohammed     +14*******03     en-US  7 questions  ...
  Kevin Nguyen       +14*******07     en-US  7 questions  ...
Wave 2 (priority 1)
  Sandra Martinez    +14*******12     es-US  7 questions  ...
```

Three things to notice, because they are the argument for the whole design:

- **Two people are never called.** Their own state record already settles it. Clearing by data first
  is not an optimisation; a call nobody needed is an intrusion.
- **Maria gets 6 questions, Aisha gets 7.** Maria's record already answers one of them, so the agent
  does not ask it. Every question skipped is thirty seconds of someone's life back.
- **The wave order is the risk order.** Days until the coverage check, plus the paperwork-risk
  signals that predict a procedural loss: a language other than English, no online account, returned
  mail, a prior procedural disenrollment.

`plan` also prints the fully rendered call task. Read it aloud before a live campaign. If it sounds
wrong, fix the rule or state JSON - not the code.

## 2. A full dry-run campaign

```bash
npm run demo
```

```
Campaign example-state-2026-09-14: 13 people on the list, 2 cleared by state data, 11 to call.

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

Read the result as a worklist, not a verdict: 3 exemption packets waiting on a caseworker, 1 hours
reminder, 3 navigator callbacks, 2 letters, 1 suppression, 1 correction call.

**"Had not heard of the rule: 5 of 8."** Five of the eight people who answered the phone had never
heard of a rule that will end their coverage in January. No dashboard, portal, or mailing produces
that number. Only a conversation does.

## 3. Spanish, end to end

Maria Gonzalez has `locale=es-US`. The whole task renders in Spanish - opening, questions, closings -
and her answers come back in Spanish. The end-to-end test asserts that the evidence quoted in the
ledger is her own words:

```
assert.ok(s.get("e001")?.evidence.some((q) => q.includes("mi mama")), "a Spanish speaker is quoted in Spanish");
```

Language is not a cosmetic feature here. Preferring a language other than English is one of the
paperwork-risk signals that moves someone up the call order, because it is one of the strongest
predictors of a procedural loss.

## 4. A condition is not automatically frailty

Linda Brooks (`scenario=frail-review`) says yes to the health question, then says it does **not**
make daily life hard. The CMS rule requires both a qualifying condition **and** a limitation on daily
activities. So:

```
Linda Brooks: NEEDS REVIEW -> navigator
```

Not `likely_exempt`. A navigator follows up with a person who can ask properly. This is the single
most important line in the classifier: the easy, wrong implementation grants the exemption here.

## 5. The agent overclaims, and gets caught

Ahmed Hassan (`scenario=overclaim`) answers in a way that supports nothing, but the returned result
has `agent_told_them: "may_qualify_exemption"`. The classifier compares what the agent said to what
the answers support:

```
Ahmed Hassan: NEEDS REVIEW -> navigator + CORRECTION CALL
```

A human now calls Ahmed back to correct what he was told. The check runs **before** the
low-confidence downgrade, so an overclaim can never be swallowed by a confidence adjustment. This is
the difference between a system that is careful and a system that merely looks careful.

## 6. The platform falls over

```ts
const h = await harness({ createFailures: { count: 10_000, status: 503, code: "provider_unavailable" } });
const s = await h.make().run();
assert.equal(s.outcomes.not_attempted, 11);
assert.equal(s.calls, 0);
assert.deepEqual([...kinds], ["operator_review"]);
```

Eleven people, zero calls, eleven `operator_review` items and nothing else. No letters, no navigator
calls, no "unreachable." When our infrastructure fails, the enrollee's record does not change.

A transient 429 behaves differently: it is retried with backoff and the campaign finishes normally.
A 422 `invalid_phone` is **not** retried, because retrying an invalid request just wastes the window.

## 7. Resume, don't re-run

```bash
npm run sc -- resume --campaign-id example-state-2026-09-14
```

`resume` settles calls that were still in flight, re-places the tasks CALL-E refused **with their
original idempotency keys**, and finishes the worklist. Two properties are tested:

- A resumed campaign reaches the byte-identical end state of one that never failed.
- `resume` on an already-finished campaign places **zero** new calls and creates no duplicate work.

Never recover by running `run` again.

## 8. Idempotency is real, not aspirational

The end-to-end test replays a used key against the fake server and asserts the same call id comes
back rather than a second dial:

```ts
const replay = await client.calls.create({ task: "replay", recipients: [...] }, { idempotencyKey: firstKey });
assert.equal(replay.id, <the original call id>);
assert.equal(fake.requests().length, 13);
```

This matters because a CALL-E create that times out on the client may still dial. Without the key,
a timeout plus a retry is a second phone call to a real person.

## 9. Following up, and stopping

```bash
npm run sc -- follow-up --campaign-id example-state-2026-09-14 --now
```

Patricia Wilson asked for a better time, so she is called back once. The tests walk her to the cap:

- attempt 2 - next action is still `follow-up`
- attempt 3 - next action becomes `mail`, and a `mail_letter` item appears
- a fourth `follow-up` places **no call at all**

Sandra Martinez opted out; calling `follow-up` on her places no call, ever.

## 10. The report

Every campaign writes `data/runs/<campaign>/outreach-report.md`, rebuilt from the ledger alone:

```
| Called | 11 |
| Screened by phone | 7 |
| Had not heard of the rule before the call | 5 of 8 who answered (63%) |
| May qualify for an exemption | 3 |
```

The test asserts the report regenerated from a freshly loaded ledger is identical to the one written
during the run, and that no unmasked phone number survives anywhere in it.
