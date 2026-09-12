# Evaluation

Two kinds of error, counted separately, because they are not the same mistake.

A **missed update** is a change the call did establish and the policy would not
apply. It costs a curator thirty seconds.

A **false automatic mutation** is a change the policy applied that the call did
not establish. It publishes a wrong address for a food bank, and somebody
travels to it.

Every threshold in `evidence/` and `policy/` is set for that asymmetry. A rising
miss rate is a tuning question. One false mutation is a defect.

## The harness

```bash
python evals/run_evaluation.py
```

Twenty-one conversations, each with the verdict a careful person would reach
reading it, run through the production transcript reader and the production
policy. As of the current tree:

| | |
| --- | --- |
| cases | 21 |
| agreement with the label | 100.0% |
| missed updates | 0 |
| false automatic mutations | 0 |
| caller's unsupported claim blocked | yes |

The last row is the one to read first. It is the case where CALL-E reports a
confirmed change and the transcript contains no such exchange. The claim reaches
a curator with the reason it was not trusted, and the record does not move.

**What this number is for.** The set is chosen adversarially rather than
representatively: a value the agent introduced and the provider merely agreed
to, a readback with one part wrong, a readback that adds a day the value does
not hold, two sessions in one sentence, a hedge, an agreement carrying a
correction inside it, a closure mentioned on a call about something else, and a
caller reporting a change the transcript does not contain. Each one is a way the
architecture could publish something nobody said, and each is scored against the
verdict it has to reach. What the figure buys is a bound: no threshold, rule or
parser can be changed without one of these moving, and the two error columns say
which direction it moved in.

## The test suite

```bash
pytest -q          # 133 tests
ruff check .
```

Grouped by what they defend:

| File | Tests | What breaks if it fails |
| --- | --- | --- |
| `test_evidence_rules.py` | 35 | A conversation is read as establishing something it did not |
| `test_policy.py` | 22 | Evidence buys more authority than it should |
| `test_call_eligibility.py` | 15 | A call is placed that was not permitted |
| `test_calle_adapter.py` | 19 | The CALL-E integration mishandles a run |
| `test_workflow.py` | 13 | A failed call leaves the record or the queue half changed |
| `test_api_and_ledger.py` | 22 | The console leaks, a visitor sees a call they did not ask for, or the ledger can be edited |
| `test_contract_library.py` | 7 | The primitive turns out to be HSDS-shaped after all |

Three of them are worth naming.

`test_a_caller_that_asserts_an_unsupported_change_cannot_publish_it` is the
single most important test in the repository.

`test_a_call_that_fails_leaves_the_record_and_the_queue_untouched` is the
transactional claim: after an exception anywhere in the loop, the record is
unchanged, the task is back in the queue, no decision was created for a curator,
and the ledger still verifies.

`test_a_live_call_to_a_number_off_the_allowlist_never_reaches_calle` is the
first gate: no plan is created, no token is used, no telephone rings, and the
refusal is in the ledger.

## Call quality, counted from rows

`GET /api/metrics` and `callibrate metrics` report:

| Measure | How it is counted |
| --- | --- |
| `contact_rate` | runs that reached a person / runs |
| `unsupported_claim_rate` | claims with zero corroboration / claims |
| `auto_apply_rate` | claims applied automatically / claims |
| `calls_refused` | `call.refused` events in the ledger |
| `false_automatic_mutations` | `change.corrected` events in the ledger |

None of these is an estimate. Each is a `COUNT(*)` over rows that exist, so a
figure on the console can be traced to the events behind it. A deployment that
never corrects an automatic change reports zero because nothing happened, and a
deployment that corrects one reports one, in public, on the front page.

## Driving the real interface

```bash
python tools/ui_smoke.py          # sign in, run a call, resolve a decision, report a failure
python tools/ui_smoke.py --demo   # play the guided walkthrough to the end
```

Both fail on any console error, any failed request, and any API response of 400
or worse. Two defects in this repository were found only this way: the content
security policy blocking every inline style the console set from script, and a
progress stepper that never left its final step, so a finished call still looked
like it was ringing.
