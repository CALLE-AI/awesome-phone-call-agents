# COD Confirm

A phone agent that confirms cash-on-delivery orders before they ship, and
knows which orders are not worth calling.

Built with [CALL-E](https://www.heycall-e.com/). Python, runnable, and it
places no calls unless you ask it to.

---

## The problem

Across South Asia most online orders are paid in cash when the courier
arrives. Nothing is charged up front, so placing an order costs the customer
nothing and abandoning it costs them nothing either. Shops routinely see a
large share of cash-on-delivery orders refused at the door: wrong address,
changed mind, or an order somebody never really meant to place.

The shop pays for that twice, once for the delivery out and once for the
return, and receives nothing.

So every small shop does the same thing. Somebody sits with a phone and
calls every order before dispatch. It takes an hour or more a day, it
happens late because nobody enjoys it, and on busy days orders ship
unconfirmed.

## Two decisions, not one

Most confirmation tools automate the call. This one automates the two
decisions around it.

### 1. Is this order worth a call?

Calls cost money, so calling the whole order book is the wrong default. A
call is an investment against one specific loss, and that loss is not the
order value: refused goods come back, the freight does not. What varies is
how likely the refusal is and how far the parcel travels.

[`economics.py`](codconfirm/economics.py) prices that per order, from
signals a shop already has:

| Signal | Effect on refusal risk |
| --- | --- |
| Customer has taken delivery before, never refused | falls to about a third |
| Customer has refused before | rises sharply, per refusal |
| Amount due at the door is large | rises, sticker shock at the handover |
| Outside the shop's own city | rises, longer routes miss more handovers |

The demo order book makes the point in five rows:

```
id      total  ship   risk  saving     net  call?
1044     9800   150    95%   171.0   165.0  yes    refused twice before, out of city
1042     6200   220    25%    65.0    59.0  yes    new customer, bulky parcel
1045     4750   190    28%    62.7    56.7  yes
1041     3450    80     8%     7.4     1.4  yes    loyal, but freight is real
1043     1150    60     8%     5.5    -0.5  NO     the call costs more than it saves
```

Order 1043 is a loyal customer, a light parcel and a small sum. Calling her
is a small, certain loss. The sweep leaves her alone and says so.

### 2. Did the customer actually agree?

The call returns an enum, never prose:

```python
"confirmed": {"type": "string", "enum": ["yes", "no", "unclear"]}
```

An agent that returns a paragraph puts you back where you started, with a
human reading it. An agent that returns `no` and a reason can cancel an
order on its own.

On top of that there is an evidence gate. A `yes` is only accepted with
`confirmation_quote`, the customer's own words, and the brief tells the
agent not to fill it in from a hum, a pause, or a yes it offered them
itself. A confirmation nobody actually spoke is routed to a person, because
dispatching on it is how a shop ends up arguing at somebody's door.

`unclear` is a first-class answer throughout, and it never retries: a second
call rarely produces a clearer one, so it goes to a human instead.

## Outcomes

| Status | Meaning |
| --- | --- |
| `confirmed` | Customer said yes in their own words. Address confirmed or corrected. Ship it. |
| `cancelled-by-customer` | Customer said no. Never leaves the warehouse. |
| `pending-confirmation` | Nobody answered. Try again on the next sweep. |
| `needs-human` | Ambiguous, unquoted, or out of attempts. A person decides. |

The decision table in [`decide.py`](codconfirm/decide.py) is total: every
combination of answers maps to exactly one status, so no order is left in
limbo by a reply nobody anticipated. Ninety five tests cover it, the pricing model,
the call-safety rules and the WooCommerce connector, and none of them need an
API key, a store or a phone line.

## Side effects and safety

- **This software makes real phone calls to real people.** It does nothing
  of the sort without `--live`.
- Every destination is validated as ASCII E.164 and **must appear on
  `CALL_ALLOWLIST`** before it is dialled. There is no unrestricted path: an
  empty allowlist dials nothing, and no setting exists that means "call
  whatever the order book says". An order book is data, and data can be
  wrong, stale, or somebody else's, so a live run names the telephones it
  may ring before it rings one.
- A number never appears in full in a log, an error or a note. Every piece
  of free text that comes back - transcript, summary, confirmation quote,
  corrected address, decline reason - is sanitised before it is logged or
  stored: terminal escapes and control characters removed, newlines
  flattened so one field cannot pose as several log lines, phone numbers,
  emails and long digit runs masked, and the length bounded. It is somebody's
  speech through a model, and it ends up in a note a person acts on.
- **Only a request the platform refused outright counts as a call that did
  not happen.** Anything else - a timeout, a dropped connection, a call that
  ended as anything but `completed`, a completed call that returned no
  result - is ambiguous: the phone may have rung and nothing here can tell.
  That order is escalated to a human, **the sweep stops**, and it is never
  picked up again by a later sweep until somebody reconciles it. Ringing a
  customer twice to ask the same question is the one failure this must not
  cause.
- **An answer only confirms or cancels an order when the platform reports
  the number it reached and that number is the order's own.** A call that
  reports no destination is readable and advisory; one that reports a
  different destination is ambiguous, because an idempotent replay can hand
  back an entirely different call.
- `DEMO_PHONE` redirects a live run to a handset you control. Whoever
  answers is not the customer the order belongs to, so the result is marked
  advisory: it can be read, and it confirms and cancels nothing.
- The sample order book is fictional throughout: `+999` numbers, which are
  not dialable, and Example addresses.
- The brief forbids asking for card, bank or payment details. Cash on
  delivery means nothing is owed now, and an agent asking for card numbers
  is a phishing call.
- No discounts, refunds or delivery dates the agent was not given.
- Wrong number: apologise, end the call, never argue.
- Ninety seconds, maximum.
- `MAX_CALL_ATTEMPTS` bounds retries per order. Nothing recurs on its own:
  each sweep is one command, and stopping is not running it again.
- **Against a live WooCommerce store**, a `--live` run writes to it: a
  private order note and two meta fields per order it acted on. It never
  changes an order's status or address. A dry run reads the store and writes
  nothing. See [Run it against a real WooCommerce store](#run-it-against-a-real-woocommerce-store).
- The demo order book carries fictional numbers. `DEMO_PHONE` redirects a
  live run to one handset you control, so a demo never dials a stranger.

## Try it

```bash
pip install -r requirements.txt
cp .env.example .env      # add your CALL-E API key

python -m codconfirm.run              # dry run: full sweep, no calls, no credit
python -m codconfirm.run --reset      # restore the demo order book
```

The dry run needs no API key and places no call:

```
Dry run. No calls are placed. Pass --live to use call credit.

4 of 5 pending order(s) justify a call.
Order 1044  Shahriar Example  9800 BDT  risk 95%  net +165
  -> pending-confirmation: No answer, attempt 1.
Order 1042  Tanvir Example  6200 BDT  risk 25%  net +59
  -> confirmed: Confirmed, address corrected. Said "yes I still want it". Prefers delivery after 6pm.
Order 1045  Farhana Example  4750 BDT  risk 28%  net +57
  -> pending-confirmation: No answer, attempt 1.
Order 1041  Rumana Example  3450 BDT  risk 8%  net +1
  -> confirmed: Confirmed, address corrected. Said "yes I still want it". Prefers delivery after 6pm.

Order book
  confirmed                2
  pending-confirmation     3

  1 order(s) left uncalled on purpose:
    1043  Nusrat Example     net -0.5 per call
```

### Placing a real call

A live run only dials numbers named on `CALL_ALLOWLIST`, and the demo order
book uses `+999` numbers, which cannot be dialled at all. So to hear the call
yourself, point the run at a handset you control and put that handset on the
allowlist:

```bash
export YOUR_NUMBER="+..."   # your own phone, in E.164 form
CALL_ALLOWLIST="$YOUR_NUMBER" DEMO_PHONE="$YOUR_NUMBER" \
  python -m codconfirm.run --live --limit 1
```

The call goes out through CALL-E and the transcript is kept on the order.
Because it was redirected away from the order's own number, the answer is
advisory: the order goes to `needs-human` instead of being confirmed, which
is the redirect rule doing its job. Without `CALL_ALLOWLIST` a live run stops
before the first ring and says why.

### Tests

```bash
pip install pytest
python -m pytest tests -q
```

95 tests, none of which need an API key, a store or a phone line.

## Run it against a real WooCommerce store

The demo book is a JSON file, but the sweep runs against a live WooCommerce
store with no code changes. Create a REST API key under *WooCommerce >
Settings > Advanced > REST API* with read/write access, then:

```bash
STORE_SOURCE=woocommerce
WOO_BASE_URL=https://your-shop.example      # must be https
WOO_KEY=ck_...
WOO_SECRET=cs_...
STORE_CITY=Dhaka                            # optional: marks out-of-city parcels
```

**What it reads.** Cash-on-delivery orders still waiting for dispatch
(`processing` and `on-hold` by default) that were placed in the last seven
days. Ringing somebody about an order from last month is not a confirmation,
so older ones are left alone. Prepaid orders are skipped: nothing is waiting
at the door.

**Where the risk comes from.** Each customer's history in the same store,
matched exactly on their phone number: completed orders count as deliveries
taken, and `failed`, `refused` or `returned` orders as refusals. WooCommerce
has no built-in "refused at the door" status, so set
`WOO_REFUSED_STATUSES` to whatever your shop calls it. A free-shipping order
is priced at `WOO_DEFAULT_FREIGHT` rather than zero, because free shipping to
the customer is not free to the shop.

**What it writes, and only on `--live`.** A private order note with the
decision, and the transcript when a person has to finish the order, plus two
meta fields, `cod_confirm_status` and `cod_confirm_attempts`. Each order is
written the moment its call ends, not at the end of the sweep, so a store that
stops answering halfway cannot leave called customers looking uncalled. If a
write fails, the sweep stops and names the order that needs recording by hand.

**What it never does.** It never changes an order's WooCommerce status and
never edits the order's address. Whether a confirmed order moves to packing
or a refused one is cancelled stays the shop's decision. A corrected address
from the call arrives as a note for a person to apply, because a misheard
street is a parcel sent somewhere else.

**The safety rules still hold across runs.** An order the sweep marked
`needs-human` is not picked up again until somebody clears its
`cod_confirm_status`, so an ambiguous call is never redialled by a later
sweep. A phone number stored without a country code is not guessed at: the
order goes to a person, unless you set `WOO_DEFAULT_CALLING_CODE` (for example
`880`) to say every local number is in one country.

A dry run against a live store reads it and writes nothing, so it is safe to
point at a real shop first. The pricing constants in `Economics` are the
shop's own numbers and are meant to be edited.

## Layout

```
codconfirm/
  config.py      settings from the environment
  orders.py      the order model and the demo order book
  woo.py         reading a live WooCommerce store, and writing results back
  economics.py   which orders justify a call, and in what order
  schema.py      the call brief and the structured answer we ask for
  phones.py      which numbers may be dialled, and cleaning what comes back
  agent.py       places the call through CALL-E
  decide.py      one call result -> one order status
  run.py         the sweep and the command line
data/
  orders.seed.json   the demo order book
tests/
  test_decide.py       the decision table
  test_economics.py    the call-budget model
  test_phones.py       destination validation, masking and the allowlist
  test_sweep.py        the sweep loop end to end, with the phone line replaced
  test_call_safety.py  what a call may and may not be taken to mean
  test_woo.py          a live store, played by a fake one, with every write recorded
```

## Licence

MIT, under the [repository licence](../../../LICENSE).
