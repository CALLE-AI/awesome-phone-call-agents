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
limbo by a reply nobody anticipated. Fifteen tests cover it and the pricing
model, and none of them need an API key or place a call.

## Side effects and safety

- **This software makes real phone calls to real people.** It does nothing
  of the sort without `--live`.
- Every destination is validated as ASCII E.164 and authorised before it is
  dialled, and `CALL_ALLOWLIST` restricts a run to numbers you name. A
  number never appears in full in a log, an error or a note.
- When a call times out or the connection drops, nobody knows whether the
  phone rang. The order is escalated to a human and **the sweep stops**,
  rather than leaving it pending for a later redial. Ringing a customer
  twice to ask the same question is the one failure this must not cause.
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
- The demo order book carries fictional numbers. `DEMO_PHONE` redirects a
  live run to one handset you control, so a demo never dials a stranger.

## Try it

```bash
pip install -r requirements.txt
cp .env.example .env      # add your CALL-E API key

python -m codconfirm.run              # dry run: full sweep, no calls, no credit
python -m codconfirm.run --live --limit 1   # place one real call
python -m codconfirm.run --reset      # restore the demo order book
```

```
Dry run. No calls are placed. Pass --live to use call credit.

4 of 5 pending order(s) justify a call.
Order 1044  Shahriar Kabir  9800 BDT  risk 95%  net +165
  -> pending-confirmation: No answer, attempt 1.
Order 1042  Tanvir Alam  6200 BDT  risk 25%  net +59
  -> confirmed: Confirmed, address corrected. Said "yes I still want it".

Order book
  confirmed                2
  pending-confirmation     3

  1 order(s) left uncalled on purpose:
    1043  Nusrat Jahan       net -0.5 per call
```

Tests: `python -m pytest tests -q`

## How it fits a real shop

[`orders.py`](codconfirm/orders.py) is the only file that knows where orders
live. It reads and writes JSON shaped like a WooCommerce order payload, so
pointing it at a live store means replacing `load` and `save` with two REST
calls. The pricing constants in `Economics` are the shop's own numbers and
are meant to be edited.

## Layout

```
codconfirm/
  config.py      settings from the environment
  orders.py      the order model and the store it reads and writes
  economics.py   which orders justify a call, and in what order
  schema.py      the call brief and the structured answer we ask for
  agent.py       places the call through CALL-E
  decide.py      one call result -> one order status
  run.py         the sweep and the command line
data/
  orders.seed.json   the demo order book
tests/
  test_decide.py     the decision table
  test_economics.py  the call-budget model
```

## Licence

MIT, under the [repository licence](../../../LICENSE).
