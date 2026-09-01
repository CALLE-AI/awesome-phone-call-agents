# warrantyops

**The portal said no, or has no record. Somebody now has to phone the
distributor. `warrantyops` makes that call and comes back with something an
operator can act on — or with an honest blank.**

A warranty exception is the claim that self-service could not settle. The
information needed to settle it exists, but it is inside somebody's head at the
other end of a phone line, and the cost of getting it is a person on hold. That
is the work this application packages.

The interesting part is not the call. It is the set of refusals in front of it,
and the one gate behind it that decides whether a number said out loud becomes
an authorization.

---

## The failure this is built around

An extraction model hears *"RMA four eight one seven one"* and returns
`RMA-48171` with high confidence. It heard `48178`. The result is
schema-valid, confidently scored, and false, and the first time anyone finds
out is when a replacement unit ships against somebody else's authorization.

Confidence cannot catch that, because confidence measures how sure the model is
about what it heard, not whether what it heard is what was meant. The only
thing that catches it is asking:

```text
Representative  "RMA four eight one seven one."
Agent           "Just to confirm, that is RMA four-eight-one-seven-one, correct?"
Representative  "No, that last digit is an eight. Four eight one seven eight, that is correct."
```

So `authorization_reference` is not populated by extraction. It is populated by
a state machine that requires a read-back, an affirmative answer, and that
answer to be present in the counterparty's own transcript turns. Anything short
of that leaves the identifier at `UNCONFIRMED_IDENTIFIER`, and the resolution
is downgraded to `HUMAN_ACTION_REQUIRED` rather than the reference being
reported.

## What it does

```text
authorization record ─► idempotency key ─► task ─► CALL-E call ─► extraction
        │                     │                         │             │
   no basis, no call    derived from what        one call per    validated here
                        was authorized          authorized case   as well as there
                                                                       │
                              transport state ◄────────────────────────┤
                                     │                                 │
                          failed ⇒ no business outcome        business state
                                                                       │
                                              identifier confirmed? ⇒ reference
                                              identifier unconfirmed ⇒ downgrade
```

Each stage can refuse, and nothing later rescues an earlier refusal.

## Install and run

No dependencies are needed for the default path.

```bash
cd apps/python/warrantyops
python3 -m warrantyops --list
python3 -m warrantyops --scenario case_d_identifier_readback
```

That replays a synthetic call from `fixtures/` and places none. `--list` shows
the five scenarios: a clean success, a documentation request, a hedged answer,
a misheard reference caught by the read-back, and a call that never completed.

Run the tests:

```bash
python3 -m pip install pytest
python3 -m pytest
```

## Dry run is the default, and live is not a flag

There is no `--live` switch, because a flag is the wrong place for a decision
that dials a stranger. The command line can only construct the fake provider.
A live run is assembled in code and every one of these must hold:

| Gate | Refusal |
| --- | --- |
| `CALLE_LIVE_CALLS_ENABLED=1` | `LIVE_NOT_ENABLED` |
| `CALLE_API_KEY` present | `MISSING_API_KEY` |
| `CALLE_BASE_URL` is the official CALL-E origin | `UNOFFICIAL_ORIGIN` |
| `WARRANTYOPS_ARTIFACT_DIR` set, and outside this repository | `ARTIFACT_DIR_MISSING`, `ARTIFACT_DIR_INSIDE_REPOSITORY` |
| A live authorization record for that number and purpose | the named authorization refusal |

The last two are not decoration. Real transcripts and real call identifiers are
not repository content, and a `.gitignore` entry cannot guarantee that, so the
directory they are written to has to be somewhere the repository does not
reach. The application refuses to start a live run that would write inside it.

Live calling needs the CALL-E SDK, which is an optional extra:

```bash
python3 -m pip install ".[live]"
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CALLE_API_KEY` | unset | Server-side only. Never written to a repository file. |
| `CALLE_BASE_URL` | `https://api.heycall-e.com` | Refused unless it is an official CALL-E origin. |
| `CALLE_LIVE_CALLS_ENABLED` | unset | `1` opts in to live calling. Anything else is a dry run. |
| `CALLE_IDEMPOTENCY_NAMESPACE` | `warrantyops` | Prefix on derived keys. |
| `WARRANTYOPS_ARTIFACT_DIR` | unset | Where a live run may write. Must be outside this repository. |

## Side effects, duplicates and cancellation

One call per authorized case. No recurring schedule, no second leg, no
discovery of numbers the workflow was not given.

The CALL-E documentation states the Calls API exposes no operation to cancel a
call once created, so the cancellation story is entirely in front of it: the
authorization gate refuses before anything is sent. Afterwards there is nothing
to withdraw.

Duplicates are prevented by deriving the idempotency key from the authorization
record and the case rather than from the attempt, so a retried request returns
the original call instead of dialling again. A deliberate re-check has to pass
an explicit token, because reusing the original key would return the very
answer being re-checked.

## Phone numbers

Every number in this directory comes from the reserved fictional 555-0100 to
555-0199 block. Every number in output is masked. `tests/test_repo_hygiene.py`
fails the suite if either stops being true.

## Layout

```text
warrantyops/
├── contract.py       the extraction schema, and the result the app will assert
├── identifiers.py    UNCONFIRMED ─► CONFIRMED, and why confidence is not an input
├── outcome.py        transport state and business state, kept apart
├── validation.py     the documented JSON Schema subset, re-checked on this side
├── authorization.py  who may be called, for what, until when
├── idempotency.py    keys derived from the authorization, not the attempt
├── config.py         dry run by default; the gates a live call must pass
├── workflow.py       the order the stages run in
└── providers/        fake (default) and CALL-E
```

Only `contract.py` knows what a warranty is. The rest is domain-independent on
purpose, so the same machinery survives a change of workflow.

The portable skill is `skills/warranty-recovery/`. Longer background is in
`docs/warranty-recovery/README.md`.
