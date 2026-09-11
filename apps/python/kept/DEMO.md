# Demo — two weeks of collections in four commands

Every command below runs with **no API key and no phone calls**. Copy and paste them in
order; the outputs shown are the real ones.

```bash
pip install -e ".[dev]"
rm -rf demo && cp -r examples demo
```

The dataset is eight overdue invoices for a fictional supplier, Northwind Supply Co. All
phone numbers are in the NANP fictional `555-01XX` block (`+1 202 555 01XX`).

---

## 1 — Who is worth a call, and who is not

```bash
kept plan --data demo --as-of 2026-08-24T17:00:00Z --budget 3
```

```
CALL PLAN
---------
  calls to place : 3
    dial ***02  INV-1002    Kestrel Logistics         first_contact    USD 4,800.00
    dial ***07  INV-1007    Marlow Ceramics           first_contact    USD 1,500.00
    dial ***01  INV-1001    Bellweather Foods         first_contact    USD 1,250.00
  calls avoided  : 5
    skip INV-1006    no_phone                    No callable number on file.
    skip INV-1004    do_not_call                 Customer is flagged do-not-call.
    skip INV-1005    already_settled             Invoice is paid in full.
    skip INV-1008    quiet_hours                 Local time is outside calling hours in Pacific/Honolulu.
    skip INV-1003    not_yet_due                 Chase opens 2026-08-25.
```

Eight overdue invoices; three calls. Five refusals, each naming itself. Kona Reef Supply is
in Hawaii, where it is 07:00 — the quiet-hours check runs in **their** timezone, not the
server's. Nothing has touched the network.

## 2 — Place the calls and capture what was said

```bash
kept run --data demo --scenario demo/scenarios/week1.json --as-of 2026-08-24T17:00:00Z --budget 3
```

```
RUN run_20260824T170000Z
------------------------
  calls placed     : 3
  promises recorded: 2
  disputes recorded: 1
  handed to human  : 0
  call failures    : 0
    promise INV-1002    4,800.00 by 2026-08-31  (bank_transfer, confidence 0.94)
    promise INV-1007    1,500.00 by 2026-08-29  (bank_transfer, confidence 0.91)
```

Two dated commitments are now financial records. Bellweather said *"you've billed us for it
twice"* — that is a dispute, so collection on INV-1001 stopped immediately and the account
belongs to a human from here on.

These calls went through the real `calle.CalleClient`, with an `Idempotency-Key` header and
a terminal-state poll. Only the transport was local.

## 3 — The bank feed arrives, and one promise breaks

```bash
cp demo/late-feed/2026-09-01-bank-feed.csv demo/payments/
kept run --data demo --scenario demo/scenarios/week2.json --as-of 2026-09-02T17:00:00Z --budget 1
```

```
CALL PLAN
---------
  calls to place : 1
    dial ***07  INV-1007    Marlow Ceramics           broken_promise   USD 1,500.00
  calls avoided  : 7
    skip INV-1006    no_phone                    No callable number on file.
    skip INV-1004    do_not_call                 Customer is flagged do-not-call.
    skip INV-1005    already_settled             Invoice is paid in full.
    skip INV-1002    already_settled             Invoice is paid in full.
    skip INV-1008    quiet_hours                 Local time is outside calling hours in Pacific/Honolulu.
    skip INV-1001    dispute_open                Dispute is open and owned by a human.
    skip INV-1003    call_budget_exhausted       Run budget of 1 call(s) was already spent.
```

This is the whole idea in one screen:

- **Kestrel paid.** USD 4,800 arrived on the 31st, the promise reconciled as `kept`, and the
  invoice fell out of the calling set on its own.
- **Marlow did not.** The promise passed its grace period with nothing against it, so the
  cycle escalated to `broken_promise` — and that account now **outranks a larger invoice
  nobody has ever called**, because a broken promise predicts non-payment better than age.
- **Bellweather is untouchable.** The dispute from week one still suppresses it.
- **The budget bites last**, after every other reason, so `call_budget_exhausted` always
  means real capacity ran out rather than a rule fired.

The re-call names the broken commitment out loud: *"On the twenty-fourth you agreed fifteen
hundred dollars by the twenty-ninth of August, and that has not arrived."*

## 4 — What the ledger is worth

```bash
kept report --data demo --as-of 2026-09-02T17:00:00Z --html demo/report.html
kept verify --data demo
```

```
  outstanding            : USD 11,540.00
  covered by open promise: USD 1,500.00
  arrived on promise     : USD 4,800.00
  promised but not paid  : USD 0.00
  promise keep rate      : 100%
  calls avoided to date  : 12
```
```
Ledger intact: 22 entries, chain verified.
```

Open `demo/report.html` — a self-contained page with no scripts, no external requests and
no phone numbers anywhere in it.

---

## Bonus — the answers that must not become debts

```bash
rm -rf demo-vague && cp -r examples demo-vague
kept run --data demo-vague --scenario demo-vague/scenarios/vague-answers.json --as-of 2026-08-24T17:00:00Z --budget 3
```

```
  calls placed     : 3
  promises recorded: 0
  disputes recorded: 0
  handed to human  : 3
  call failures    : 0
    no record INV-1002   no_commitment
    no record INV-1007   wrong_party
    no record INV-1001   unreadable_amount
```

Three calls that a naive integration would have booked as promises:

- *"Yeah, we'll get to it soon, don't worry about it."* — no amount, no date.
- *"I'm not accounts, but I'm sure they'll pay it next week."* — wrong party. Confident, and
  worthless.
- *"We'll clear most of it by the end of the week."* — an amount no parser
  should guess at.

Zero records. Three named reasons. That is the whole safety posture: the model's fluency is
never the thing that creates a debt.

---

## Live verification (optional, one call)

Check the credentials first. This spends nothing — it authenticates by asking for a call id
that cannot exist, so `not_found` is the success case:

```bash
export CALLE_API_KEY="calle_live_..."
kept doctor
```
```
https://api.heycall-e.com: not_found (key accepted)
KEPT_LIVE_CALLS_ENABLED: off (live calls refused)
```

Then point `customers.csv` at a number you own, put the same number in
`demo/live/authorized_recipients.txt`, and open both gates:

```bash
export KEPT_LIVE_CALLS_ENABLED=true
kept run --data demo/live --budget 1 --live --confirm PLACE-REAL-CALLS
```

`--as-of` is rejected in live mode; a real call is never placed against a pretend date.
Any number missing from `authorized_recipients.txt` is suppressed as
`recipient_not_authorized` — the confirmation authorises the run, the file authorises the
destination.

If the run is interrupted after the customer's phone rings, the call id is already on the
ledger as `call_dispatched`. Collect the outcome without dialling anyone again:

```bash
kept recover --data demo/live --live
```
