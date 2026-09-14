# Rebuttal Dispute Call

One disclosed CALL-E call to a customer who disputed a card charge, cross-examined against its own
transcript before a merchant files it as chargeback evidence.

Built with [CALL-E](https://www.heycall-e.com/). Python, runnable, and it places no call unless you
ask for one with `live`.

---

## The problem

A chargeback response is a one-shot, deadline-bound filing. The merchant sends the processor its
evidence once, before the due date, and the bank decides on what was filed.

Customer communication is one of the evidence types processors ask for (Stripe's dispute evidence
has a `customer_communication` field), and it is the one a merchant usually lacks. Many disputes
arrive with no email thread at all, because the customer went straight to their bank. The receipt,
the tracking number and the IP address say an order shipped; nothing records what the customer
says about it.

A short phone call can fill that gap, but only if the call is handled like evidence. An AI caller's
structured result is a claim about a conversation, and filing an answer nobody actually gave is
worse than filing nothing.

## What it does

1. **One fixed script.** The call opens with the disclosure ("an automated assistant calling on
   behalf of the merchant about your order; this call may be recorded"), then asks two questions,
   one at a time: did you receive the order, and do you recognise the charge. It never asks for
   payment data, never mentions banks, chargebacks or disputes, and ends at once if the person does
   not want to talk. The model never writes what the phone says.
2. **Rules before the create.** Every calling rule runs before `calls.create`, and every blocking
   reason is reported at once (see [Live CALL-E test](#live-call-e-test)).
3. **Exactly one call.** `calls.create` with a strict `result_schema` (four enum fields, no
   additional properties) and the idempotency key `rebuttal-confirm-receipt-v2-<dispute id>`.
4. **Follow.** CALL-E events and transcript turns stream to the terminal until the call ends.
5. **Cross-examine.** CALL-E's structured result is checked against what was actually said:

   | Check | Passes when |
   | --- | --- |
   | `call_completed` | the status is `completed`, `task_completed` is not false, and following did not time out |
   | `confidence` | completion confidence is at least 0.8 |
   | `disclosure_spoken` | the caller's opening says the call is automated and names the merchant |
   | `no_payment_data_requested` | no caller turn asks for card numbers, security codes, PINs, passwords or bank details |
   | `customer_willing` | CALL-E did not report `declined_to_talk=yes` |
   | `received_grounded` | CALL-E's `received` matches the customer's own answer to that question |
   | `recognises_charge_grounded` | the same, for the charge |

6. **Decide.** A reported `no` to either question stops the filing, grounded or not: a yes needs the
   customer's words, a no only needs to be possible. A `yes` is used only when it is grounded and
   every call check passed. Anything else is not filed.
7. **Document.** The call becomes a customer-communication PDF: who was called (masked), what was
   said, and what survived cross-examination.

## Try it: no call

```bash
cd apps/python/rebuttal-dispute-call
pip install -r requirements.txt pytest

python -m rebuttal_dispute_call preview                          # script, schema, rules; no call
python -m rebuttal_dispute_call                                  # dry run, scenario "grounded"
python -m rebuttal_dispute_call dry-run --scenario ungrounded    # CALL-E says yes; the customer never did
python -m pytest tests -q
```

Neither `preview` nor `dry-run` opens a network connection or needs an API key. `dry-run` answers
from [`fake.py`](rebuttal_dispute_call/fake.py), a local stand-in for `calls.create`, `calls.get`
and `calls.list_events` that returns the payload shapes of the live API and honours the
idempotency key.

| `--scenario` | What happens on the call | Decision |
| --- | --- | --- |
| `grounded` | disclosed; the customer says yes to both questions | would be filed as customer communication |
| `ungrounded` | CALL-E reports yes twice; the customer never says yes | would not be filed |
| `no-disclosure` | the opening never says the call is automated | would not be filed |
| `denied` | the customer says nothing arrived and the charge is not theirs | stops the filing |
| `declined` | the customer does not want to talk | would not be filed |
| `no-answer` | nobody picks up | would not be filed |

```
$ python -m rebuttal_dispute_call dry-run --scenario ungrounded
dispute        du_demo_1042 (order 1042, Example Outfitters)
destination    +12*****0101
script         confirm-receipt-v2
result fields  received, recognises_charge, purchaser, declined_to_talk
idempotency    rebuttal-confirm-receipt-v2-du_demo_1042
rules          pass
mode           dry run: a local fake CALL-E answers (scenario ungrounded); nothing rings, no network
call           call_fake001 (queued)

  event     run_call started.
  event     calling task created.
  event     Call is ringing.
  event     Call answered.
  event     Call completed.
  00:00     caller    Hello, this is an automated assistant calling on behalf of Example Outfitters about your order 1042. This call may be recorded.
  00:10     customer  Okay.
  00:12     caller    Did you receive the order?
  00:15     customer  Sorry, who is this?
  00:18     caller    Do you recognise the charge for that order?
  00:22     customer  Can you call me later?
  00:25     caller    Thank you. Goodbye.

checks
  PASS  call_completed: status completed, task_completed True
  PASS  confidence: completion confidence 0.93 (minimum 0.8)
  PASS  disclosure_spoken: the caller said it was automated and named the merchant "Hello, this is ..."
  PASS  no_payment_data_requested: the caller never asked for payment data
  PASS  customer_willing: the customer answered
  FAIL  received_grounded: CALL-E reported yes; the customer said nothing clear
  FAIL  recognises_charge_grounded: CALL-E reported yes; the customer said nothing clear

CALL-E reported  received=yes  recognises_charge=yes
accepted         received=unknown  recognises_charge=unknown
document         out/dry-run/du_demo_1042-ungrounded.pdf
decision         would not be filed
```

Outside calling hours the `rules` line reads `a live call right now would be blocked:
CALL_OUTSIDE_LOCAL_HOURS`; a dry run still completes, because nothing rings.

## Live CALL-E test

Use only a phone you own, or one whose owner has agreed to take this call.

```bash
cp .env.example .env    # set CALLE_API_KEY, and REBUTTAL_CALL_ALLOWLIST=+12125550101
python -m rebuttal_dispute_call preview --to +12125550101
python -m rebuttal_dispute_call live --to +12125550101 --i-have-consent
```

`+12125550101` is a reserved fictional number: replace it, in both places, with the number you are
authorised to call. `live` refuses, and lists every reason, unless all of these hold:

- `CALLE_API_KEY` is set;
- `CALLE_BASE_URL` is unset, `https://api.heycall-e.com` or `https://test-api.heycall-e.com`;
- `--to` is an E.164 number and is the number on record (`--on-record`, which defaults to `--to`);
- `--i-have-consent` is passed on this run;
- the number is listed in `REBUTTAL_CALL_ALLOWLIST` (empty means no live call);
- it is between 08:00 and 21:00 at the destination (for +1 numbers, in both New York and Los Angeles);
- the task text is exactly the template;
- `out/live/<dispute id>.pdf` does not already exist.

```
$ python -m rebuttal_dispute_call live --to +12125550101
...
mode           LIVE: a real phone rings if every check passes. A submitted call cannot be cancelled through the public CALL-E API.

Not calling:
  - CALLE_API_KEY is not set
  - CALL_WITHOUT_OPERATOR_INTENT: a live call needs the operator's intent on this run: pass --i-have-consent
  - CALL_DESTINATION_NOT_AUTHORIZED: +12*****0101 is not listed in REBUTTAL_CALL_ALLOWLIST
```

A live run uses CALL-E credit and rings a real phone. **A submitted call cannot be cancelled through
the public CALL-E API.** Ctrl+C or closing the terminal only stops local following; the call carries
on. If the create request fails without a clear answer, the command exits with status 3 and does
not retry: check the CALL-E dashboard before running it again, and note that a re-run sends the same
idempotency key. There are no schedules or recurring jobs to disable.

Exit codes: `0` finished (whatever the decision), `2` refused before any request, `3` the create or
the follow failed and a call may exist, `130` stopped following.

## Output and evidence

- **Terminal:** events, transcript turns, every check, what CALL-E reported, what was accepted, and
  the decision. ASCII only. Destinations are masked (`+12*****0101`), and phone-shaped digit runs in
  transcript lines are masked too.
- **Evidence document:** `out/dry-run/<dispute>-<scenario>.pdf` or `out/live/<dispute>.pdf`, with the
  merchant, order, dispute, call id, masked recipient, times, completion confidence, the accepted
  answers, every check with its quote and offset, and a phone-masked rendering of the transcript.
- A live document contains the customer's words. Treat it as personal data: keep it
  access-controlled, apply a retention policy, and never commit it (`out/` is gitignored). The
  recipient and phone-shaped digit runs in all displayed text are masked. Other personal details
  may remain; masking is not full anonymization. Grounding uses the unchanged private transcript.
  The live document is also the only record that a dispute was called, which is how
  `live` refuses a second call.

## Side effects and safety

- **No call by default.** `preview` and `dry-run` place no call and make no network request. Only
  `live` can ring a phone.
- **Consent first.** `--i-have-consent` is the operator's attestation, made on each live run, that
  the person at the number agreed to be called. Nothing stores or remembers it.
- **Authorised destinations only.** E.164, the number on record, and listed in
  `REBUTTAL_CALL_ALLOWLIST`. There is no setting that means "call whatever the order says".
- **Local calling hours.** 08:00-21:00 at the destination; destinations without a calling-hours rule
  are refused.
- **Disclosure before any answer counts.** If the opening does not say the call is automated and name
  the merchant, no answer from the call is used.
- **Never asks for payment data.** The script forbids it, and a caller turn that asks for card or bank
  details makes the call unusable.
- **One call per dispute.** A stable idempotency key per dispute, a refusal while a live evidence
  document exists, no automatic retry, and no redial after no answer.
- **No cancellation.** A submitted call cannot be cancelled through the public API, and nothing here
  claims otherwise.
- **Credentials.** The API key comes from the environment or `.env`, is sent only to the two official
  HTTPS CALL-E URLs, and is never printed.
- **Masked numbers** in every line the command prints.
- **Nothing else is stored.** No database, ledger, upload or webhook; the local evidence document is
  the only artifact. Nothing is filed with a processor: that is the full Rebuttal agent's job, behind
  a human approval.

## Limitations

- **Experimental, English-only grounding.** Yes and no are read with regular expressions over English
  phrases, from the first clear customer answer within three turns of each question. Mixed answers
  ("yes and no") count as unclear, but sarcasm, idioms and other languages can be misread. A person
  should read the transcript before anything is filed.
- **Not legal advice.** Dispute rules differ by card network and processor, and calling, consent and
  call-recording rules differ by jurisdiction. Complying with them remains the operator's
  responsibility.
- **Calling-hours table.** Covers +1, +44, +49, +61, +65, +91 and +971. Without the system time-zone
  database (on Windows, `pip install tzdata`), fixed September offsets are used instead.
- **The fake is not CALL-E.** It mirrors the live payload shapes and idempotency behaviour. In the
  tests the live path runs against a stand-in client, never the live API; `call.py` is the module
  Rebuttal itself uses for its live calls (author-reported).
- **A document is not a verdict.** Filing customer communication does not decide a dispute.

## Layout

```
rebuttal_dispute_call/
  call.py    adapted from Rebuttal: script, schema, place, follow, ground, phone-masked evidence PDF
  rules.py   the calling rules as pure functions, and check_call()
  fake.py    local CALL-E stand-in with six scripted scenarios and idempotency
  cli.py     preview, dry-run and live
tests/
  test_call.py   grounding, polarity, local hours, masking, allowlist, idempotency, follow, PDF
  test_rules.py  every blocking reason, alone and together
  test_cli.py    each dry-run scenario, preview, live refusals with the network disabled
```

## Project links

- Full agent, with Stripe Visa Compelling Evidence 3.0 filing, a Slack approval gate and a GPT-6 Astra
  coordinator: <https://github.com/N-45div/Rebuttal>
- Site: <https://rebuttal-ten.vercel.app>
- CALL-E Developer API: <https://github.com/CALLE-AI/call-e-integrations>

## Licence

MIT, under the [repository licence](../../../LICENSE).
