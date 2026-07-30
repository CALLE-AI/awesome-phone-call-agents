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

## Example 5 — low confidence surfaced, not smoothed over

```
Riverside Pharmacy (…0100)   yes   —   —   Rx: unknown   —   conf 0.41  ⚠ verify
    Call quality was poor; several answers were unclear.
```

**Agent:** Riverside said yes, but confidence is low — the line was bad and
several answers were unclear. I'd ring them yourself before travelling.

Confidence below about 0.6 gets flagged rather than reported as fact. Someone
may be about to travel while unwell on the strength of this.

---

## Example 6 — dry run before spending anything

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv

amoxicillin 500mg — 21 capsules · 3 pharmacies · dry run, no calls

  DRY RUN Riverside Pharmacy (…0100) — plan pX70PPR62, would spend 1 call
  DRY RUN Oakhill Chemist (…0101) — plan p8KM2QW41, would spend 1 call
  DRY RUN Station Road Pharmacy (…0102) — plan pT39LLV87, would spend 1 call
```

`plan_call` is free, so this validates the goal wording, the numbers and the
region without placing a call. Add `--live` when you're ready to dial.

---

## Example 7 — budget refuses before dialling

```bash
$ python3 scripts/pharmacy_search.py --pharmacies pharmacies.csv --live --max-calls 2

BudgetExceeded: 3 call(s) needed, 2 left of 2.
```

The check runs across the whole batch before anything is dialled, so a search
fails cleanly rather than stopping halfway with two calls spent and no complete
answer.
