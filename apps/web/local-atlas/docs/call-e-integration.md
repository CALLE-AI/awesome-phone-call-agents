# CALL-E integration

How Local Atlas wires CALL-E, and the constraints that decided the shape.
Implementation is a single file, `calle.js`.

## Asynchronous by necessity

A call takes 30–90 seconds. Holding an HTTP request open that long dies to the
hosting proxy's timeout, so `/api/ask-place` returns immediately with a call id and
the result arrives later:

```text
POST /api/ask-place        -> 202 { callId, state }
POST /api/calle/webhook/:token   (CALL-E -> us, unsigned)
GET  /api/ask-place/:id    -> polling fallback for a lost webhook
```

Both paths converge on the same handler, so a duplicate delivery and a poll that wins
the race produce one stored fact rather than two.

## Webhook deliveries are untrusted input

CALL-E webhook deliveries are not signed — the SDK's `webhooks.verify()` is deprecated
and documented as legacy-only. A POST to the callback URL is therefore treated as a
hint, not as data:

1. Read **only the call id** from the body.
2. Re-read the authoritative record from the API using that id.
3. Store what the API returned.

Nothing from the request body is persisted. `CALLE_WEBHOOK_TOKEN` — a long random
string in the path — is what makes the endpoint unguessable, which is the only
protection available when payloads cannot be verified.

## Idempotency keys are derived from the authorization

The key is `local-atlas:<account?>:<placeKey>:<questionHash>` — properties of *what was
authorized*, not of the attempt. Two clicks on the same question inside the lock window
are one call.

Two details that were not obvious:

- **A forced recheck must not reuse the key.** CALL-E replays a call for a repeated
  Idempotency-Key, so a recheck on the original key returns the very answer being
  rechecked. Appending an hour bucket makes a recheck a new request once an hour, while
  a double-click inside that hour still dedupes.
- **The account belongs in the key on the private path.** Otherwise two people asking
  the same place the same question privately share one call, and one of them reads a
  result collected for somebody else.

## The question never reaches the script unsanitised

The question is interpolated into the agent's task string, so it is an injection
surface. Three layers, in order:

1. **Structural.** Control characters and newlines stripped, zero-width characters
   removed, quote characters normalised (the task string quotes the question),
   collapsed to one line, characters allow-listed. This runs *before* the pattern tests
   so they see one flat line rather than something split across newlines to evade them.
2. **Deny-list.** Abuse, threats, sexual content, slurs, and injection shapes
   ("ignore the above", "you are now", "don't mention you're an AI").
3. **Model allow-list.** Gemini is asked the inverse question — "is this a civil,
   factual, answerable question about this business?" — because a deny-list leaks and an
   allow-list judgement fails safe on phrasings nobody enumerated.

Layer 3 **fails closed**: with no model available, custom free text is refused and the
fixed templates remain usable. A degraded safety check must not quietly become no
safety check on the one path that dials a stranger.

Fixed templates skip layer 3 because they skip the problem: the text is selected
server-side from a table by id, so no user input reaches the script at all.

## Structured results, not transcript scraping

The call returns a structured result:

```js
{ answer_status, answer, evidence_quote, staff_confidence }
```

`answer_status` is one of `answered | unclear | refused | unreachable | unknown`, and
each is treated differently downstream — see
[`fact-freshness.md`](fact-freshness.md). `evidence_quote` is what makes the stored
answer checkable by a reader: the words the staff member actually used, capped at 200
characters.

The raw transcript is kept server-side for the call log and is deliberately **not**
sent to the browser. What a reader sees is a short written note about how the call
went, grounded in the transcript. Publishing a stranger's phone conversation as
listing content is not something a directory entry should do.

## The two-turn opening

The agent's first line, the disclosure, and the confirmation preview are all built from
one source. If the preview showed a different opening line from the one the agent
reads out, the confirmation would be a lie.

```text
turn 1  "Hi — is now a good moment for one quick question about your playground?"
        (if it is a bad moment: thank them, end the call, do not push)
turn 2  "Thanks — I'm an AI assistant, calling for someone who's planning a visit
         and couldn't ring you themselves."
turn 3  the question
```

The disclosure originally led the call. Everything about it was true and it landed
badly: it announced what the caller was before establishing that the person had a
second to spare, and ran about sixteen seconds — straight over the greeting, because
the agent starts talking the moment the line connects. Moving it after the
"is now a good moment" line changed the order, not the content. It remains
unconditional, always precedes the question, and the agent may never deny being an AI.

The noun in the opening ("your playground", "your museum") is mapped from the
provider's category, first match wins, falling through to "your place". Provider
category strings are not usable raw — live values include "arts and entertainment" and
"psychic and astrologer", and "your psychic and astrologer" is worse than saying
nothing specific at all.

## The optional Goals path

`CALLE_GOAL_ID` routes calls through a published Goal instead of the one-off Calls API.
The only reason to want it is voice: region, callee locale and runtime profile come
from the Goal, and there is no voice field on `CreateCallRequest`.

It is a switch rather than a migration because the trade is real. `GoalRun` is
`additionalProperties: false` over a fixed shape — no transcript, no summary, no
attempts. A Goal buys a fixed accent and costs the call log, and it moves the script
into a dashboard where it is neither reviewed nor version-controlled. The injection
defence stays in this repository either way: the question is sanitised, validated and
moderated before anything is sent.

## Lazy client

`@call-e/calle` is ESM-only and this server is CommonJS, so the SDK is reached through
a dynamic `import()` rather than a top-level require. It is also lazy on purpose: a
deploy without `CALLE_API_KEY` must still boot and serve the map.
