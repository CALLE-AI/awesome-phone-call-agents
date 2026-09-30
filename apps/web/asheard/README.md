# asheard

Read what actually happened to a CALL-E call, and see which field said so.

A finished call hands you a status word, a `task_completed` boolean and a
confidence score. That comes back saying the job is done for a voicemail box:
the recording picks up, the agent asks its question into the tone, and the call
ends `completed` with a schema-valid result and a high score.

Nothing in that payload is wrong. There is just no field in it that says a
person was ever on the line.

This app reads a call as three separate answers instead of one, and puts the
field it read next to every sentence.

## Try it without placing a call

No credentials, no phone, nothing stored.

```bash
npm install
npm run dev
```

Then:

- `/read` takes a payload you paste and reads it. Four synthetic sample payloads
  are loaded for you.
- `/briefing` shows a batch of calls in the order somebody should deal with
  them, from fixtures, with the boring ones collapsed into a line.
- `/matrix` prints which endings each surface can actually express, generated
  from the mappers rather than written by hand.

```bash
npm test
```

No network and no credentials. The suite runs against the package's own
synthetic fixtures and a stubbed `fetch`, so it exercises what the app actually
imports rather than a copy of it.

## The pages that need a key or a token

`/key` reads one call by id with your own key. The key travels in a header, gets
used for one request and is written nowhere. It lives in React state and dies
with the tab. What comes back is a masked projection of the call, never the raw
payload.

`/hook` is a webhook inbox. CALL-E deliveries are unsigned, so the inbox never
believes one. It takes the call id out of the delivery, fetches that call from
CALL-E with the server's key, and keeps only that. The posted body is never
stored or shown. The inbox address carries a post token only the operator can
mint, and reading the inbox back needs a second token.

`/live` places a real call, and it's the only thing here that can. It needs an
operator token minted for the exact number being dialled, so a browser can't
make one up and a token for one number won't dial another. The built-in
destinations are all in the 555-0100 range, held back for fiction and assigned
to nobody. Other test lines go in `ASHEARD_EXTRA_DESTINATIONS` on your own
deployment.

## Configuration

```bash
CALLE_API_KEY=...             # server only. Without it nothing reaches CALL-E
ASHEARD_OPERATOR_SECRET=...   # 32+ characters. Without it /live and /hook are off
KV_REST_API_URL=...           # Redis, for the budget, the intents and the inbox
KV_REST_API_TOKEN=...
```

Mint tokens on the machine that holds the secret:

```bash
npm run operator-token -- dial +13035550100
npm run operator-token -- inbox
```

Every response from a route that touches CALL-E goes through a deep mask on the
way out. A phone number that turns up anywhere in it, an error message or a
structured result quoting one back, gets masked. Timestamps, scores and ids are
left alone.

## Side effects

`/live` places real phone calls and spends credit on the configured account,
and only with an operator token. Everything else in this app is read-only.

Nothing here schedules anything or creates a recurring job, so there is nothing
to cancel. Close the tab.

Each press of the button gets an id from the page, and that id is for
idempotency, not permission. The server writes the intent down before dialling
and derives the idempotency key from it, so a retry after a lost response finds
the call that already exists. If a request goes out and the answer never comes
back, the record says the call may have gone out and stops there. Retrying a
submission you can't see the outcome of is how somebody gets rung twice.

## What it will not do

It does not interpret a transcript, score anything, or ask a model what it
thinks. Every line it produces traces to a field and says the same thing every
time.

It never resolves the business outcome for you. Where a reading rests on
inference it says so and routes to a person, and where no field carries the fact
it says that instead of filling the gap.

## The engine

The reading itself lives in [`asheard`](https://www.npmjs.com/package/asheard) on
npm, published from CI with provenance, and this app is a front end over it.

- `disposition/` maps a payload from any of the three surfaces onto three axes,
  each carrying whether it was quoted from a field, derived from other fields,
  or absent because nothing carries it.
- `reconciler/` builds one evidence document per call, runs four checks over it,
  ranks a batch by what costs you something if ignored, and writes the sentences.
- `ledger/` records what was authorized before a call goes out, with the
  idempotency key derived from the authorization rather than the attempt.

The paired skill is [`skills/call-state-reconciler`](../../../skills/call-state-reconciler/).
Its `references/observed-shapes.md` shows each platform behaviour the reading
relies on, with invented values, and how to check it yourself.
