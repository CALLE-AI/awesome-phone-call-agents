# Examples

All numbers below are from the reserved fictional range +1 555 0100–0199.
Replace them with real E.164 numbers you have permission to call.

---

## Example 1 — a straightforward search

**User:** I need amoxicillin 500mg, 21 capsules. Can you check these three
pharmacies? +1 555 0100, +1 555 0101, +1 555 0102.

**Agent:** Before I call, let me confirm:

- Medication: amoxicillin 500mg, 21 capsules
- Pharmacies: 3 numbers in the US
- This will place 3 real phone calls now

I'll ask each pharmacy about stock, price, whether a prescription is required,
and whether they can hold it. I won't place an order or reserve anything.

Shall I go ahead?

**User:** Yes.

**Agent:** *(one run per pharmacy, concurrently)*

```
Riverside Pharmacy (…0100)      partial   10 units   $5.00   Rx: yes   hold 48h   conf 0.82
    They have only 10 units available, less than the requested 21 capsules.
Oakhill Chemist (…0101)         yes       40 units   $6.20   Rx: yes   hold 24h   conf 0.91
Station Road Pharmacy (…0102)   no        —          —       —         —          conf 0.88
    Suggested trying their branch on Mill Lane.
```

Oakhill has the full quantity and will hold it for 24 hours. Riverside is
cheaper but only has 10 of the 21 you need.

All three need a prescription. I haven't reserved anything — you'd need to call
and ask them to hold it yourself.

Want the transcript for any of these?

---

## Example 2 — a local number, so the agent asks rather than guesses

**User:** Check if the chemist on 07700 900123 has ibuprofen 400mg.

**Agent:** I need that number in full international format before I can dial —
I won't guess a country code. If that's a UK mobile it would be
+44 7700 900123, but please confirm.

Also, how many do you need? The pharmacist will ask, and "partial stock" only
means something if I know the target quantity.

---

## Example 3 — urgency, so the agent does not call

**User:** I've run out of my heart medication and I feel awful. Call every
pharmacy near me right now.

**Agent:** I'm not going to start calling for this — it's the wrong tool for
what you're describing.

Each call takes a few minutes and I'd be working through a list while you're
unwell. If you've missed doses of a heart medication and you're feeling bad,
please contact your doctor, an urgent care service, or emergency services now.
A pharmacist reached directly can also advise on an emergency supply.

If it turns out you just need to locate stock and there's no urgency, I'm happy
to ring round then.

---

## Example 4 — the pharmacist suggests something else

**Result:** `alternative_suggested = "pharmacist mentioned co-amoxiclav"`

**Agent reports:**

> Station Road doesn't have it. The pharmacist mentioned they stock
> co-amoxiclav.

**Not:**

> ~~Station Road doesn't have it, but co-amoxiclav would work instead.~~

The agent relays what a pharmacist said. It does not endorse a substitute or
imply equivalence — that's a clinical judgement, and nobody qualified reviewed
this exchange.

---

## Example 5 — a confident "no" outranks an unreliable "yes"

```
Pharmacy                Stock    Qty  Price  Conf
Oakhill Chemist (…0101) no        —      —   0.95
Riverside (…0100)       yes       —      —   0.31  ⚠ unverified
    Call quality was poor; several answers were unclear.
```

**Agent:** Oakhill definitely doesn't have it — that's a clear answer.
Riverside said yes, but confidence is low: the line was bad and several answers
were unclear. I've ranked it below because an unreliable yes is worse than a
reliable no when you'd be travelling on it. Ring Riverside yourself before you
set off.

Verification is the **primary** sort key, ahead of stock status. A
low-confidence "yes" appearing at the top of the list is the specific failure
that sends a sick person on a pointless journey.

---

## Example 6 — a call that didn't complete reports nothing

```
Station Road Pharmacy (…0102)   unknown   —   —   —   ⚠ unverified
    Call did not complete (no answer). No stock information obtained.
```

The run ended `NO ANSWER` with `task_completed: false`. Even if a partial
summary came back, no stock fields are reported — "could not be reached" is a
distinct outcome from "not in stock", and scraping a half-finished call for a
stock answer is how a patient gets sent somewhere on a sentence nobody finished.

---

## Example 7 — a number that isn't E.164

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv
Invalid phone number: '07700900123' is not E.164. Expected + followed by
country code and number, 8-15 digits total, e.g. +15550100. Do not guess a
country code — ask the user.
```

Validation runs before anything else, in both dry run and live mode. Nothing is
dialled and no plan is created.

---

## Example 8 — dry run, fully offline

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv

DRY RUN — offline. No credentials read, nothing sent.

  Riverside Pharmacy (…0100) — would send:
  {
    "tool": "plan_call",
    "goal": "You are calling a pharmacy on behalf of a patient…",
    "to_phones": ["+15550100"],
    "region": "US"
  }
  …

  3 call(s) would be placed. Add --live to dial.
```

No token is read and no socket is opened. The numbers are validated and the
payload is printed locally.

Note this deliberately does **not** call `plan_call` to check the goal wording,
even though `plan_call` is free of charge. Free of charge isn't free of
consequence: it would transmit the recipient's number and the medication being
sought to a third party, from a mode the user was told places no calls.

---

## Example 9 — an interrupted call is not redialled

The process was killed while a call was in progress. Rerunning:

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live
  …0100: resuming run 4BJPgjIFv3gZ
```

It polls the existing run rather than planning a new one. The pharmacist is not
called twice.

If the crash happened in the narrower window *after* the call was submitted but
*before* a run id came back:

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live
  …0100: a call was submitted but no run id was recorded, so whether the
  phone rang is unknown. Not retrying automatically. Check the CALL-E
  dashboard for plan pX70PPR62, then either record the run id or remove
  this entry to allow a redial.
```

Ambiguity is not resolved by guessing. A duplicate call to a pharmacist costs
money and looks like a malfunctioning system contacting a business repeatedly
about a patient.

---

## Example 10 — two processes, one recipient

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live &
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live
  …0100: held by live process 48213. Not dialling concurrently.
```

Claims are taken under an exclusive lock, so two processes can't both conclude
the recipient is free and both dial.

---

## Example 11 — verifying against CALL-E's testing hotline

CALL-E publishes an inbound hotline at **+1 276-322-9632** for testing. It
answers with a general-purpose prompt rather than role-playing a pharmacist, so
this is a pipeline check, not a source of stock data.

```bash
$ printf 'name,phone,address\nCALL-E Hotline,+12763229632,Testing hotline\n' \
    > pharmacies.hotline.csv
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.hotline.csv --live

Pharmacy          Stock     Qty  Price  Rx       Hold  Conf
CALL-E Hotline    unknown     —      —  unknown     —  0.34  ⚠ unverified
    The recipient did not provide stock information.
```

The right outcome. The hotline can't answer a stock question, confidence is
low, and the row is marked unverified rather than filled with plausible
guesses. It exercises plan, run, poll, the completion gate and the ledger
without calling a business.

Interrupt it mid-poll and run it again to check the durable path:

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.hotline.csv --live
  …9632: resuming run 4BJPgjIFv3gZ
```

---

## Example 12 — a duplicated row is not dialled twice

`pharmacies.csv` lists the same number under two names — easily done when a
chain has branches:

```csv
name,phone,address
Oakhill Chemist,+15550101,High Street
Oakhill (High St),+15550101,duplicate of the above
```

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live
Skipping 1 duplicate row(s) for recipients already in this batch:
  Oakhill (High St) (…0101)
```

Rows are dispatched concurrently, so without this both would ring the same
pharmacist within a second of each other. A file lock doesn't catch it — both
coroutines share a pid — so duplicates are collapsed before dispatch and the
in-flight set is tracked in-process as well.

---

## Example 13 — a credential that can't be bound is refused

Even with a single cached credential, if nothing ties it to the endpoint being
called:

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live
Found 1 cached CALL-E credential(s), none of which can be bound to
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth.

`calle auth status` did not report a matching endpoint, and no cache records
one. A bearer token is issued for a single origin, so sending one that might
belong to a different provider is a credential disclosure, not a routing
mistake — refusing rather than assuming.

Either run `calle auth login` against
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth, or set
CALLE_TOKEN_CACHE explicitly:
  /Users/you/.calle-mcp/cli/4811f3e.../token.json
```

"Only one exists" is not evidence that it belongs to this provider.

And if the CLI is authenticated somewhere else entirely:

```bash
The CALL-E CLI is authenticated against https://other.example/mcp, but this
skill is configured to call https://seleven-mcp-sg.airudder.com/mcp/...
Refusing to send that credential to a different origin.
```

---

## Example 14 — changing region does not reuse a plan

A call to the same pharmacy about the same medication, routed through a
different region, is a different call:

```bash
$ python3 scripts/pharmacy_search.py --pharmacies p.csv --region GB --live
  …0100: resuming run 4BJPgjIFv3gZ

$ python3 scripts/pharmacy_search.py --pharmacies p.csv --region US --live
  …0100: planning              # different identity, not the GB run
```

Run identity is `sha256(endpoint | account | region | phone | goal)`. Reusing a
plan across a routing or credential change would either resurrect a stale plan
or, worse, treat a live call as absent and dial the pharmacist twice.

Changing the identity scheme bumps `LEDGER_SCHEMA`. An older ledger holding
unfinished entries is refused rather than read as empty:

```
Run ledger .pharmacy_runs.json uses an older identity scheme (schema None,
now 2) and still holds 1 unfinished entry. Keys are now namespaced by
endpoint, account and region, so those entries would not be found and their
recipients would be dialled again.
```

---

## Example 14 — budget refuses before dialling

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live --max-calls 2

BudgetExceeded: 3 call(s) needed, 2 left of 2.
```

The check runs across the whole batch before anything is dialled, so a search
fails cleanly rather than stopping halfway with two calls spent and no complete
answer.
