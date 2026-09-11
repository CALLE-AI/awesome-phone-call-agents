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

Re-reading the record is necessary but not sufficient, because the record the API
returns is a document *about* a call, not proof that it was **our** call. An id we hold
no stored request for is dropped before step 2, and what comes back from step 2 still has
to bind — see [Binding a result to its request](#binding-a-result-to-its-request).

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
- **Anything the key stamps into metadata must be derived from the same inputs.** A
  round carries a `round_id` in its metadata and checks it on the way back. When that id
  was random, a replayed call returned stamped with the *previous* round's id, failed to
  bind, and recorded an empty round for a request that was perfectly legitimate. The id
  is now derived from owner, question, place set and hour — the same inputs as the key —
  so the two can never disagree.

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

## Binding a result to its request

A published entry says *confirmed by phone*, so that claim is checked rather than
assumed. `bindResult()` and `publish()` require all seven of these before anything is
published, and any failure is a refusal:

| Binding | What must hold |
|---|---|
| **call** | we hold a stored request for this exact call id |
| **terminal** | the call has finished; queued and in-progress records are left to settle |
| **completed** | it finished by *completing*, and CALL-E affirms `taskCompleted` — `failed`, `canceled`, a `false` verdict and no verdict at all are each a refusal |
| **task** | `sha256(call.task)` matches the script we sent — same disclosure, same single question |
| **recipient** | the transcript is read from an attempt on the number *we* dialled, not `recipients[0]` |
| **metadata** | `app`, `place_key`, `q_hash`, `question` and `visibility` all match our record |
| **evidence** | an `answered` fact quotes something a staff member actually said |

The evidence test compares `evidence_quote` to the `user` turns of the transcript,
case- and punctuation-insensitively; a quote binds if it is exactly one whole turn, or a
substring of at least 12 characters. Failures downgrade rather than invent: no staff turn
makes it `unknown`, an ungrounded quote makes it `unclear` with the answer dropped, an
answer from a call that did not complete makes it `unknown`, and any other binding failure
publishes nothing and logs the reason. `publish()` is the one gate — it will not write to a
place's shared list unless the result is marked bound and the call it came from completed,
which is why the webhook, the poll and the simulator cannot diverge on this.

Losing an answer costs the asker a retry. Publishing an unbound one costs the claim every
other entry on the page depends on.

## One task, several recipients

A comparison — "which of these three has the shortest wait?" — is one question whose
answer only exists once all three have been asked. CALL-E models that directly, so it is
one call task rather than a loop:

```js
await calle.calls.create({
  task,                                   // names no business: it is read to all of them
  recipients: targets.map(t => ({ phone: t.phone, region: 'US', locale: 'en-US' })),
  recipientResultSchema: RESULT_SCHEMA,   // each business answers for itself
  resultSchema: ROUND_SCHEMA,             // the call-level result compares them
  metadata: { app: 'local-atlas', kind: 'round', round_id: roundId, /* … */
    // the number-to-name mapping, on the provider's side of the call
    recipients: targets.map(t => ({ phone: t.phone, name: t.name })) }
}, { idempotencyKey: 'local-atlas:' + roundId });
```

**One script, several businesses, so the question must suit all of them.** Screening it
against the place whose panel happened to be open would clear "is the rooftop terrace open
tonight?" on the strength of the one business with a rooftop, then read it down the phone
to two that have none. Two rules, cheap first: a question that **names** a recipient is
refused structurally, because naming a business makes the question about that business;
then the model screens it **once per recipient**, failing closed on the first refusal and
saying which business refused it. The opener's noun is the one they share, falling back to
the generic `place` when they share none.

**A recipient has to be identifiable in the result, or the comparison cannot bind.** The
task names nobody and the request carries phone, region and locale — so asking the schema
for "the exact business name, copied from the recipient list" asks for something the model
was never shown, and a guessed name binds to nothing. The winner is identified by phone
number instead, the one identifier the request and the record share; `metadata.recipients`
carries the number-to-name mapping so it exists provider-side too, and is checked field
for field on the way back, making it a binding as well as a mapping. A name is still
accepted where a provider surfaces one. Numbers appearing in the model's sentence are
rendered back as business names, and a number belonging to nobody in the round is removed
rather than shown.

If the call-level result identifies nobody at all, the answers are compared on this side
instead, from the per-place results already checked — a comparison that silently never
appears is, for the feature it headlines, the same as not having built it. It is the same
class of claim either way, derived rather than quoted, and the stored record notes which
side produced it.

The binding table above still applies, one level down. **A per-place answer is bound to
that recipient**: the transcript is read from an attempt on the number we meant to dial,
the recipient's own `status` must be `completed` — the recipient-level twin of the
call-level completion rule — and the quote must appear in that recipient's own transcript.
Each surviving answer then goes through the same `publish()` as everything else, so a
round opens no new door into storage.

**The call-level result is treated as a different kind of claim,** because it is one. No
staff member said it. So it is bound to the recipients we actually dialled — a
`best_place` naming a business outside the round, or one that never answered, is dropped —
it rides on the call-level completion gate rather than any recipient's, and the UI labels
it derived rather than quoting it.

Two rules that are about the people answering rather than the data. The task carries an
extra instruction — never mention, compare, name or hint that anyone else is being
called — because the businesses did not agree to be ranked against each other, and the
person picking up is entitled to a straight question. And rounds share the per-place
in-flight lock with single asks, so no number is dialled twice for the same question by
the same person.

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

## Why there is no Goals path

An earlier version could route calls through a published Goal (`CALLE_GOAL_ID`) for the
sake of voice: region, callee locale and runtime profile come from the Goal, and there is
no voice field on `CreateCallRequest`.

It was removed rather than exempted. `GoalRun` is `additionalProperties: false` over a
fixed shape — no transcript, no summary, no attempts — so a Goal result can never satisfy
the evidence binding above: there is nothing to check the answer against. A code path
whose only possible output is an unbound fact is not worth keeping for an accent, and a
Goal also moves the call script into a dashboard where it is neither reviewed nor
version-controlled.

## Lazy client, and the one chokepoint

`@call-e/calle` is ESM-only and this server is CommonJS, so the SDK is reached through
a dynamic `import()` rather than a top-level require. It is also lazy on purpose: a
deploy without `CALLE_API_KEY` must still boot and serve the map.

Being the *only* way to an authenticated request — create, get, poll, webhook re-read —
is what lets one function decide whether any credentialed traffic leaves the process at
all. `client()` refuses outright under `CALLE_DRY_RUN=1`, and refuses when
`CALLE_BASE_URL` is not an official CALL-E origin, so neither of those is a branch a
caller can miss.
