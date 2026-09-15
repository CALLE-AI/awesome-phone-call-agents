# ClaimCall

**Turn a warranty claim into one consented, evidence-checked phone call — and refuse to believe the result until the transcript backs it up.**

ClaimCall is not "an AI that calls support for you". It is the part that comes
*before* the call: a compiler that turns purchase evidence and warranty terms
into an inspectable call plan, a deterministic safety gate that decides whether
that plan may be dialled at all, and a reconciler that checks the structured
result against what was actually said on the call.

Built for the [CALL-E](https://call-e.devpost.com/) hackathon. This monorepo
also ships an optional demo UI over the same engine. Public repo:
[github.com/Subramanyarao11/claimcall](https://github.com/Subramanyarao11/claimcall).
Devpost story: [`docs/calle-devpost-story.md`](https://github.com/Subramanyarao11/claimcall/blob/main/docs/calle-devpost-story.md).

---

## The problem it solves

A warranty call fails in boring, specific ways:

- you call before you have the serial number, and have to call again;
- the agent agrees to something you did not authorise;
- you hang up with a case number you misheard;
- your script times out, you retry, and now there are two cases open;
- the call ends and you have a JSON blob asserting a reference number that
  nobody ever said out loud.

ClaimCall addresses each one as a mechanism, not as a prompt instruction.

| Failure | What ClaimCall does |
|---|---|
| Calling with incomplete evidence | Required fields gate plan compilation |
| Agreeing to something unauthorised | Deterministic safety gate, plus an explicit fee/appointment envelope in the plan |
| Misheard reference number | The reference must appear in the transcript or it is not accepted |
| Duplicate calls after a timeout | Stable idempotency key, reservation written before submission |
| Fabricated structured result | Verification against transcript evidence; unknown stays unknown |

---

## Quickstart — no CALL-E account needed

```bash
pip install -e .

# Compile and safety-lint a plan. Contacts nobody.
claimcall preview --claim claimcall/fixtures/eligible-claim.json

# Run the full pipeline against a fixture. Still contacts nobody.
claimcall run --claim claimcall/fixtures/eligible-claim.json
```

`run` without `--live` is not a stub. It executes the identical dispatcher,
reservation, idempotency and verification code that a live call goes through —
only the transport is a fixture. That is what makes it safe to paste into a
README, and it is also why a green dry run tells you something real.

### See what the phone agent is actually told

```bash
claimcall show-task --claim claimcall/fixtures/eligible-claim.json
```

### Watch it refuse things

```bash
# A claim file carrying injected instructions aimed at the agent
claimcall preview --claim claimcall/fixtures/unsafe-claim.json          # exit 2, REJECT

# A result asserting a reference number nobody said on the call
claimcall verify --claim claimcall/fixtures/eligible-claim.json \
                 --result claimcall/fixtures/fabricated-reference.json  # exit 2, NEEDS_HUMAN

# A ₹500 inspection fee offered mid-call
claimcall verify --claim claimcall/fixtures/eligible-claim.json \
                 --result claimcall/fixtures/needs-human-result.json    # exit 2, NEEDS_HUMAN

# Nobody picked up
claimcall verify --claim claimcall/fixtures/eligible-claim.json \
                 --result claimcall/fixtures/no-answer-result.json      # exit 2, INCONCLUSIVE
```

Exit codes: `0` verified, `2` held for a human, `1` error.

---

## How CALL-E is used

CALL-E places the call. ClaimCall decides whether there should be one, what may
be said, and whether to believe the answer.

At runtime, `claimcall run --live`:

1. compiles a `CallManifest` and seals it with a content hash;
2. runs the deterministic safety gate over it;
3. checks `--confirm <hash>` against that plan, so consent names a specific call;
4. writes an idempotency reservation **before** any network call;
5. submits one call to `POST /v1/calls` with an `Idempotency-Key` header, the
   generated task text, and a strict JSON result schema
   (`claimcall.result.v1`);
6. reads authoritative state back with `GET /v1/calls/{id}`;
7. verifies the structured result against the transcript before reporting it.

The result schema asks CALL-E for exactly nine fields, including
`uncertainty_reasons` and a `fee.accepted` that is pinned to `false` — the
phone agent is structurally unable to report having accepted a charge.

---

## Placing a real call

A live call is irreversible and consumes one call from your CALL-E allocation.
Four independent things must line up:

```bash
pip install -e '.[live]'

export CALLE_API_KEY=...                 # 1. credentials
export CLAIMCALL_ALLOW_LIVE=true         # 2. explicit opt-in

# 3. allowlist the destination (store the hash, not the number)
claimcall hash-number +15005550006
export CLAIMCALL_ALLOWED_PHONE_HASHES=<the hash it printed>

# 4. confirm the exact plan you just read
claimcall preview --claim my-claim.json
claimcall run --claim my-claim.json --live --confirm <hash from preview>
```

Edit the claim file and the hash changes, so a stale `--confirm` is refused.
That is deliberate: consent binds to a plan, not to a command.

### External side effects, stated plainly

| Command | Side effect |
|---|---|
| `preview`, `show-task`, `verify` | None. No network at all. |
| `run` (default) | None. Fixture transport. |
| `reconcile` (default) | None. Fixture transport. |
| `run --live` | **Places one outbound phone call. Consumes one CALL-E call. No rollback.** |
| `reconcile --live` | One authenticated read from the CALL-E API. No call placed. |

There is no cancellation path for a call already in progress, and no scheduled
or recurring calling in this tool — one command, one call, by design.

### If a live call times out

Do not re-run it. The reservation was written before submission, so:

```bash
claimcall reconcile --call-id <id> --claim my-claim.json --live
```

If CALL-E has never heard of the idempotency key, the call is held for a human
rather than retried. "We cannot prove a phone did not ring" is not the same as
"no phone rang".

---

## The claim file

```json
{
  "owner_display_name": "Ravi",
  "issue": "The right earbud no longer charges after normal use.",
  "product": {
    "brand": "Auralite",
    "name": "Auralite Buds S2",
    "model": "AB-S2-BLK",
    "serial_number": "AURS2-3391-77TQ",
    "purchase_date": "2026-01-20",
    "invoice_number": "DM/2026/0142",
    "seller": "DemoMart Electronics Pvt Ltd"
  },
  "recipient": {
    "organization": "Auralite Demo Service Desk",
    "phone_e164": "+15005550006"
  },
  "approved_windows": [
    { "start": "2026-09-09T10:00:00+05:30", "end": "2026-09-09T18:00:00+05:30", "timezone": "Asia/Kolkata" }
  ],
  "max_fee": 0.0,
  "questions": ["Is a service visit or a depot drop-off required for this fault?"]
}
```

Only seven product fields can ever become spoken disclosures. Anything else you
add is ignored by the compiler rather than quietly read out — the allowlist is
on the *path*, so there is no field name that smuggles a government ID onto a
call.

---

## What the safety gate refuses

Ordinary Python with tests, never a prompt. No model output and no provider
fallback can widen it.

**Rejected outright**

- emergency services and the National Consumer Helpline, checked before format
  validation, because "fix the formatting and retry" is the wrong lesson to
  draw from dialling 112;
- OTPs, passwords, card numbers, Aadhaar, PAN or passport patterns anywhere in
  the spoken text;
- instruction-injection text — `ignore all previous instructions`, `you are now`
  — because an uploaded invoice is data, never instructions;
- a disclosure statement that hides the automation;
- a plan with no result schema, an expired plan, or one edited after sealing;
- a destination that is not allowlisted, in live mode.

**Held for a human**

- any non-zero pre-authorised fee;
- goals that read like commitments the owner did not grant.

---

## Verification: the part that says no

A structured result is a claim *about* a conversation, not the conversation.

- A `claim_reference` must appear in the transcript. Matching ignores
  punctuation and spacing, so a representative spelling out
  `W R 2026 0455` still counts — but a number nobody said does not.
- A firm `coverage_status` without call evidence is a contradiction.
- An `appointment_option` with `explicitly_offered: false` is not an offer.
- A slot outside your `approved_windows` is an authority violation, not a booking.
- `no_answer` and `voicemail` stay unsuccessful. There is no partial credit.
- A result that fails schema validation is not salvaged into a partial success.

`VERIFIED` means the transcript backs every asserted field and the call stayed
inside the envelope you granted. Everything else is `NEEDS_HUMAN` or
`INCONCLUSIVE`.

---

## Tests

```bash
pip install -e '.[dev]'
pytest
```

36 tests, no network. They cover hash stability across processes, five
consecutive dispatches producing exactly one call, every safety-gate refusal
above, and each adversarial result fixture.

---

## Privacy and data

- All bundled fixtures are synthetic. `Auralite` and `DemoMart Electronics` are
  invented brands; `+15005550006` is a reserved test number.
- Phone numbers are hashed for the allowlist, so a real number never has to sit
  in an environment variable or a shell history.
- Rendered output masks numbers (`+15*****0006`); the raw number appears only
  in the request to CALL-E.
- The tool stores nothing on disk. Reservations live for one process.
- Data reaching CALL-E on a live call: the generated task text (your disclosed
  product facts and issue description), the destination number, and the result
  schema.

## Limitations

- One recipient per call.
- No scheduling, retrying or campaign behaviour, on purpose.
- The eligibility reasoning lives in ClaimPilot, not here; this tool trusts the
  claim file you hand it.
- Field names in the CALL-E request mapping follow the published API at time of
  writing and are isolated in one function, `CalleClient._to_payload`.

## License

MIT. See the repository root.
