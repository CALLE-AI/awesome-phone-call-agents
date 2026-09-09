# Muster

Proof-of-life attestation by phone, for pension and benefit schemes.

A phone call cannot prove that somebody is alive. It proves that a human
answered a line. Muster grades what one call did and did not establish, names
the reason, and says `UNPROVEN` far more often than it says alive.

**Hosted console:** https://muster-95953931159.us-central1.run.app
(scripted demo data, places no calls)

**No call is placed unless you ask for one.** Every command in this app
defaults to a preview or a scripted demo. The whole test suite runs with no
credentials.

## Why this exists

Schemes must know whether the person they are paying is alive. Both failure
directions are real.

**Paying the dead.** In *United States v. Suchowolski*, 838 F.3d 530 (5th Cir.
2016), the court records "almost a quarter-century's unlawful receipt of
social-security benefits in the guise of a person who died in 1990". In Japan,
the 2010 discovery of a man dead in his bedroom since 1978, whose family had
drawn his pension throughout, triggered a national audit that could not
confirm whether 234,354 people over 100 were alive.

**Cutting off the living.** To keep a pension, retirees abroad or in rural
areas must periodically produce a Certificate of Life in person. Miss it and
payment stops. Digital alternatives need a smartphone, a PC, or biometrics
that fail the very old.

Same root cause: nothing requires a live human to answer for themselves, and
nothing records why a conclusion was reached.

## What a call does

Four stages, one call.

1. **Reach** -- classify the endpoint: subject, third party, voicemail, IVR, no answer.
2. **Self-identification under disclosure** -- state who is calling, why, and that
   the call cannot stop a payment; then ask the person to confirm who they are.
3. **Freshness challenge** -- three words minted for this call, said back in order,
   plus today's weekday. A recording cannot pass this.
4. **Knowledge challenge** -- two prompts drawn from a set enrolled out of band.

## The model extracts. Code decides.

The CALL-E `result_schema` in `muster/schema.py` captures only observations:
who answered, which words came back, what the answers were, whether anyone
else was audible. There is deliberately no `alive` field and no `grade` field.

`muster/grading.py` computes the verdict from those observations and the
enrolment record. Whether the freshness words were correct is decided by
`muster/nonce.py`, in code, with normalisation so an ASR spelling difference
never fails a living person. The model is never asked to mark its own work.

## Grades

| Grade | Meaning | Closes automatically |
| --- | --- | --- |
| `CONFIRMED_LIVE` | self-identified, freshness passed, challenges passed, no interference | yes |
| `PRESUMED_LIVE_WEAK` | reached and answered, one leg short | no |
| `THIRD_PARTY_CLAIM` | somebody else vouched -- not evidence of life | no |
| `UNPROVEN` | not reached, voicemail, ambiguous, or freshness failed | no |
| `CONTRA` | evidence the subject has died, or the line is reassigned | no |
| `NEEDS_HUMAN` | accessibility, distress, confusion, or coaching detected | no |

## Two asymmetries

**Muster can confirm life. It can never confirm death.** No grade concludes a
death. `CONTRA` means a person must look at this. Concluding a death from a
phone call is how living people get wrongly cut off.

**Only a pass is automatic.** `CONFIRMED_LIVE` closes the attestation. Every
other grade opens a human case and **never stops a payment**;
`Attestation.stops_payment` is hard-wired to `False` and tested.

## Honest limits

| Attack or failure | Handled? |
| --- | --- |
| Relative vouches for the subject | Yes -- `THIRD_PARTY_CLAIM` is never a pass |
| Recording or voicemail in the subject's own voice | Yes -- per-call freshness challenge |
| Number reassigned to a stranger | Yes -- `CONTRA` |
| Somebody in the room feeding answers | Partly -- turn-timing heuristic, downgrade only |
| Impersonation by a relative who knows the prompts | **No** |
| Synthesised or replayed voice | **No** -- CALL-E returns transcripts, not audio, so no speaker verification is possible |
| Subject alive but deaf, aphasic, or living with dementia | Yes -- routed to a human, never failed |

Muster does not produce proof of life. It produces a dated, evidence-linked
record of what one call established, which is more than the paper process
records today.

**Why it still works.** Suchowolski ran for twenty-five years. A weak check run
monthly caps exposure at thirty days. Frequency beats strength when the strong
check requires a journey the subject cannot make.

That claim is not left in prose. `muster/backtest.py` runs both cited cases
through the real cadence and ladder:

| Case | Undetected | Under this cadence | |
| --- | ---: | ---: | ---: |
| *United States v. Suchowolski* | 9,125 days | 40 days | 228x |
| Sogen Kato, Adachi ward, Tokyo | 11,570 days | 40 days | 289x |

The model assumes only one thing, and it is deliberately weak: after a death no
call can return `CONFIRMED_LIVE`, because a challenge minted seconds ago cannot
be answered on somebody's behalf and a relative vouching is never a pass. Every
other grade climbs the ladder, and the ladder ends with a person.

## The escalation ladder

Not confirming is the common case. Giving up on the first miss would either
strand living people or teach a scheme to ignore the signal, so Muster climbs a
fixed ladder that ends with a human being.

| Rung | Dials | May attest | Purpose |
| --- | --- | --- | --- |
| `primary_number` | yes | yes | The enrolled number, four-stage protocol |
| `retry_primary` | yes | yes | Same number, different hour of the day |
| `alternate_number` | yes | yes | The second enrolled number, if registered |
| `nominated_contact` | yes | **no** | Ask them to pass on a message. Nothing more |
| `human_visit` | no | **no** | A person takes the case. Muster stops |

**The nominated contact may only be asked to pass on a message.** A call to
anybody other than the subject can never produce a life attestation, however
convincing what they say. That is the Kato failure, closed by construction in
`ladder.NEVER_ATTESTS` and asserted in the tests.

## Adaptive cadence

The interval responds to the evidence, which is what makes frequency worth
anything.

| Last grade | Next attempt |
| --- | --- |
| `CONFIRMED_LIVE` | 30 days |
| `PRESUMED_LIVE_WEAK` | 7 days |
| `UNPROVEN` | 3 days |
| `THIRD_PARTY_CLAIM` | 2 days |
| `CONTRA` | 1 day |
| `NEEDS_HUMAN` | schedule stops; a person owns it |

An interval is never a deadline for the subject. Nothing expires, and missing a
cycle changes no payment.

## The register, read in both directions

Death data is used aggressively to stop paying people and lazily to start
paying them. A register entry can stop a pension in days. A person the register
has wrongly recorded as dead has, in practice, no channel to argue.

Muster treats a register entry as a claim, exactly like a relative's claim, and
reconciles it against what the call established:

| Reconciliation | When |
| --- | --- |
| `AGREED_ALIVE` | register silent or alive, call confirmed |
| `REGISTER_CONTRADICTED` | **register records a death and the subject just passed a live challenge** |
| `CALL_SUPPORTS_REGISTER` | register records a death, call did not contradict it |
| `REGISTER_UNCORROBORATED` | register records a death, call established neither way |
| `NO_SIGNAL` | nothing was established |

`REGISTER_CONTRADICTED` opens a correction case **against the register, not
against the person**, and like everything else here it stops no payment. One
subject in the demo roster exists only to produce it.

## Adversary scoreboard

`muster/adversary.py` runs six named attacks through the real grading engine.
Four are caught. Two are not, they are listed anyway, and a test asserts they
are *still* not caught -- so if that ever changes, somebody has to come here and
say so deliberately.

```bash
python3 -m muster.cli adversary
```

## Tamper-evident ledger

Each attestation carries the hash of the one before it, so editing or removing
one breaks the chain at that point and every point after it. `Ledger.verify()`
returns the index of the first broken entry. This proves the record was not
edited in place; it does not prove who wrote it.

## Install and run

Python 3.10 or newer. No runtime dependencies.

```bash
cd apps/python/muster
python3 -m muster.cli roster
```

### Preview a call without placing it

```bash
python3 -m muster.cli plan s-1041 --show-payload
```

Prints the exact words the agent would say and the body that would be sent to
`POST /v1/calls`. The recipient number is masked in all output.

### Run the scripted demo (no credentials, no calls)

```bash
python3 -m muster.cli demo
python3 -m muster.cli demo s-1041 --scenario coached
```

Five enrolled subjects, five outcomes, one pass. Scenarios are built from the
live plan, so the freshness words echoed back are the ones actually issued -- a
scenario cannot pass by hard-coding the answer.

### Console

```bash
python3 -m muster.api        # http://localhost:8080
```

### Check credentials without spending a call

```bash
export CALLE_API_KEY=...
python3 -m muster.cli verify
```

Read-only: lists published Goals. Places no call.

### Place a real call

```bash
export CALLE_API_KEY=...
python3 -m muster.cli run s-1041 --i-have-authorisation
```

Refuses without the flag. Only call numbers you are authorised to call.

## Side effects, credentials, cancellation

- **Side effects.** `run` places a real outbound call and spends CALL-E credit.
  Nothing else in this app dials.
- **Credentials.** Read from `CALLE_API_KEY` in the environment only. Never
  written to disk, never logged, never sent anywhere but CALL-E.
- **Idempotency.** The key is derived from the authorisation -- subject plus
  cycle -- not from the attempt, so a retried run reuses it instead of dialling
  the same person twice.
- **Cancellation.** The Calls API exposes no client cancellation, so a call
  already in flight runs to completion. Cancel a cycle *before* it dispatches;
  after dispatch, the only control is to ignore the result. This app schedules
  nothing on its own and creates no recurring job.
- **Unresolved outcomes.** A polling timeout is not a decline and not a failed
  call. It grades as `UNPROVEN` and stays open.
- **Retention.** Only the quoted spans that justify a grade are kept.
- **Phone numbers.** Every number in this repository is fictional, drawn from
  the Ofcom `+44 7700 900xxx` drama range and the North American `555-01xx`
  block. Numbers are masked in previews, logs and the console.

## Tests

```bash
python3 -m pytest tests/ -q
```

No network, no credentials, no calls.

## Licence

MIT. See `LICENSE`.
