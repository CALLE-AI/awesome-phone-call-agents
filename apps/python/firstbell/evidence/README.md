# Evidence

Six receipts from real calls placed against `api.heycall-e.com` on 2026-09-04. Every one
carries `"reached_production_api": true`, a real `call_id` you can look up, and CALL-E's
own returned transcript.

The number called belongs to the author of this app, who placed the calls, answered them,
and agreed that these specific conversations would be published. It is masked in every
file. `--include-transcript` is off by default for exactly that reason, and
`tests/test_cli.py` asserts that a receipt written without it contains no spoken words.

| File | What it shows |
|---|---|
| `01-two-languages-one-command.json` | One command, two calls, `en-IN` then `ta-IN`. The three schema fields come back **identical** across the two languages. The free-text notes differ, because the two conversations did. |
| `02-idempotent-replay-no-calls.json` | The same command run again. `calls placed 0, calls replayed 2`. No phone rang and the account was not charged, which the vendor's own usage page confirms independently. |
| `03-unanswered-call.json` | A call nobody answered. See below: the platform's account of it and the operator's do not agree. |
| `04-defect-a-refusal-scored-resolved.json` | **A receipt of this app getting it wrong.** Kept on purpose. |
| `05-locale-pilot.json` | The pilot call of the locale experiment, run alone so a structural mistake would cost one call and not eight. |
| `06-locale-matched-pairs.json` | Seven calls completing four matched pairs, the same scenario in `en-IN` and `ta-IN`. |
| `07-locale-experiment.md` | The pre-registration, the twelve comparisons, the result, and every call mapped to CALL-E's own usage page by `provider_call_id`. |
| `provider-ids.json` | Every API call id mapped to the id CALL-E's own dashboard and usage page are keyed on, so any call here can be checked against the vendor's billing. Rebuild with `tools/recover_provider_ids.py`, which only reads. |

## What each one is actually worth

**01.** The claim this app makes is that language is a property of the family rather than
of the deployment. The two rows in that run differ in one column, `locale`. The task text
sent to CALL-E is byte-identical apart from the student's name. So the Tamil is not
prompted, it is routed, and the extraction still produced English enum values from a
conversation held in Tamil with code-mixed speech.

**02.** Cancellation and duplicate-call protection are things every entry in this
repository is asked to describe. This is the receipt for it rather than the description.
The count is honest in both directions: a replayed call is reported as replayed, not as
placed, because it cost nothing and disturbed nobody.

**03.** The platform returned SIP `603 Decline`, a `failure_message` naming the user as
having hung up, and `started_at` equal to `completed_at`, which says the call never rang.
The operator was holding the phone, watched it ring in full and touched nothing. Three
accounts, one of them checkable. The dispatcher reports only what all three agree on, that
nobody answered, and `dispatch/scheduler.py` says why.

**04.** This is the receipt that matters most.

The person answered and said they were at work and could not talk. CALL-E returned a
schema-valid result with every required field set to `"unknown"`, and its own note saying
that no reason and no return date were collected. This app read the schema, found it
valid, wrote `resolved`, and closed a record about a child nobody had heard anything
about.

That is the exact failure this project was built to prevent, arriving by a route the
design had not considered: not a null result, but a result full of nothing. It was found
by making a real call rather than by reasoning about the API.

The fix, and the reason this receipt is still here rather than quietly regenerated: a
result whose required fields are all uninformative is now `undetermined`.
`tests/test_dispatch.py::test_a_row_of_unknowns_is_not_an_answer` runs against the
captured production response in `tests/data/live-call-learned-nothing.json`, and removing
the check fails it. The receipt is left in its original state because a corrected copy
would be a record of a run that never happened.
