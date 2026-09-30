# Safety

## This reads calls. It doesn't place them.

The skill dials nothing. It takes payloads you already fetched and arranges
them, so it runs against fixtures with no credentials and no network. The paired
app has one route that can place a call, covered below.

## It never resolves the business outcome

The reading answers three questions and refuses to collapse them: how the call
ended, whether the job was reported done, and whether the answer came from
anybody speaking. It does not decide whether to ship the order.

Where a conclusion rests on inference it is marked as inference and routed to a
person. Where no field carries the fact, it says so rather than filling the gap.
That third state is the one that matters. A reading that can't say "nothing
here carries that" will invent it.

## Undocumented fields are never quoted

The attempt-level `failure_code` is not documented and the errors guide says not
to branch on it. Endings read from it are always marked as inference, never as
stated, and only codes seen alongside a known ending are decoded at all.
Anything else stays unknown.

Nothing here retries a call, and nothing here decides a business outcome from an
undocumented string.

## Phone numbers

Destinations are masked before they enter any record the skill produces.

In the app, every response from a route that touches the API goes through a
deep mask on the way out. So a number that turns up somewhere nobody expected,
an error message or a structured result quoting it back, still gets masked.
Timestamps, scores and ids are left alone.

Every number in this skill and its app is masked or sits in the 555-0100 to
555-0199 range, which is held back for fiction and assigned to nobody. An
operator who wants other test lines adds them through the environment on their
own deployment. None ship in the tree.

## Operator authorization

Nothing that spends money or reads account state runs on a browser's say-so.

`/live` dials only with an operator token minted for that exact number:

```bash
ASHEARD_OPERATOR_SECRET=... npm run operator-token -- dial +13035550100
```

The token is an HMAC over the number, so only the server secret can make one
and a token for one number won't dial another. The check runs on the resolved
number, after the destination list has already been checked. With no secret
set, dialling is off.

The id the browser sends with each press is for idempotency only. It lets a
retry find the call that already exists. It authorizes nothing.

The rest of the dial path: the destination list is fixed in code, the API key
comes from the server environment and is never accepted from a browser, and a
daily and per-visitor budget is spent before the call goes out. If the counter
can't be read, no call goes out. The budget is not refunded when a call fails,
because a limiter that refunds errors can be beaten by causing them.

Reading a placed call back needs the read token that the authorized POST
issued. A call id on its own reads nothing.

## The webhook inbox never trusts a delivery

CALL-E deliveries are unsigned, which the changelog documents. So a delivery is
treated as a hint and nothing else. The inbox takes the call id out of it,
fetches that call from CALL-E with the server's key, and keeps only what CALL-E
returns, projected and masked. The posted body is never stored or shown. An id
that isn't on the account is refused, and a delivery with no call id is dropped.

Each inbox address carries a post token only the operator secret can mint, so a
made-up inbox is refused. Reading the inbox back needs a separate read token in
a header, so the address you hand a sender can't be used to read anything.

## No schedules

Nothing here creates a recurring job, a queue worker or a background schedule,
so there is nothing to cancel or roll back. Stop using it and it stops.
