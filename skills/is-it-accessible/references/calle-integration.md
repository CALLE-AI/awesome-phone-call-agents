# CALL-E integration

Host-specific detail for this skill: which CALL-E surface it uses, why, and what
the results look like.

## Which surface, and why

CALL-E offers four ways in. This skill uses the **Developer API via the
TypeScript SDK** (`@call-e/calle`).

| Surface | Structured results? | Used here |
| --- | --- | --- |
| Developer API / SDK | `resultSchema` and `recipientResultSchema` | **Yes** |
| MCP (`plan_call`, `run_call`, `get_call_run`) | No schema parameter | No |
| `calle` CLI | No schema parameter | No |

The decision turns on one thing. This skill's whole output is a per-need verdict
plus the quote backing it, and only the API path can *ask* for that shape.
The MCP and CLI surfaces have no `result_schema` parameter, so the fields would
have to be named inside the goal text and then parsed back out of prose — which
is exactly the guesswork the quote rule exists to eliminate.

If you are adapting this skill to MCP, expect to lose the per-need mapping and
the automatic downgrade of unevidenced claims.

## Install

```bash
npm install @call-e/calle
export CALLE_API_KEY="…"          # from dashboard.heycall-e.com/account/api-keys
export CALLE_BASE_URL="https://api.heycall-e.com"   # optional
```

The key is read from the environment only — never a command-line argument,
where it would land in shell history.

## The request

One call task carries every venue as a recipient, so a shortlist is a single
batch rather than N tasks:

```js
const call = await client.calls.create(
  {
    task,                                    // the composed goal
    recipients: [{ phones: ["+15555550123"], region: "US", locale: "en-US" }],
    recipientResultSchema,                   // per-venue findings
    metadata: { app: "is-it-accessible", profileId, venues },
  },
  { idempotencyKey },
);
console.error(`Call ${call.id} accepted.`);   // before anything waits
const finished = await client.calls.waitForResult(call.id);
```

**`locale` is BCP 47, not a language name.** CALL-E's supported-languages table
names languages in prose — "English, Hindi, Tamil" — while `recipients[].locale`
is documented as `en-US`. The two vocabularies disagree, so the script
translates a profile's `"language": "English"` into `en`, adds the region when
the profile states one (`en-US`), and drops a language it cannot read rather
than sending it as free text. Nothing is guessed: no region is invented for a
language, and no language for a region.

**`venues` in metadata** is `[{ name, phone }]`. CALL-E knows the numbers it
rang and not what anyone calls the place, so the names travel with the call
and are matched back **by number** when a report is rebuilt with `--call`.

**`resultSchema` vs `recipientResultSchema`.** `resultSchema` describes the task
as a whole; `recipientResultSchema` describes each recipient. Per-venue answers
must go through the latter — putting them in `resultSchema` collapses a
comparison into one blended result.

**Idempotency.** The key hashes the profile id, the needs asked (id and
severity), the sorted venue numbers and the UTC day. Same key, same request:
CALL-E replays the original call and nobody is rung twice. The needs are in it
because the same key with a *different* body is not a replay but a
`409 idempotency_conflict`, which is what a profile edited between two runs
would produce — the script names that case rather than saying "try again". The
day is in it so a venue checked last month can be checked again; `--again`
adds a random token so it can be checked again today, and has to be asked for.

## The response

```ts
{
  id: "call_…",
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled",
  taskCompleted: boolean | null,
  completionConfidence: { score: number, label: string } | null,
  summary: string | null,
  structuredResult: object | null,      // task level
  recipients: [{
    phones: string[],
    status: "pending" | "in_progress" | "completed" | "failed" | "skipped",
    structuredResult: object | null,    // per venue — what this skill reads
    summary: string | null,
    attempts: [{ transcriptTurns: [{ speaker, text, offset_seconds }] }],
  }],
}
```

### Three things that will bite you

**`structuredResult` can be `null` on a completed call.** CALL-E returns `null`
when it cannot produce a schema-valid result from the call. That is a legitimate
outcome, not an error. Fall back to `summary`, mark the report `unverified`, and
never synthesise findings to fill the gap.

**Terminal is not the same as useful.** A call that went to voicemail or was cut
off short still reaches a terminal status and can carry a partially filled
summary. Check `status === "completed"` *and* whether any finding is non-unknown
before reporting anything as established.

**A failed call's reason lives on the attempt, not on the call.** This is the
one that costs a venue its reputation if you get it wrong.

`call.failure_code` reads `call_failed` on every failure, and
`call.failure_message` is *identical* on the two failures that matter most to
tell apart. Two real calls, one that rang for ninety seconds unanswered and one
that never reached a phone at all, both came back:

```json
{ "status": "failed",
  "failure_code": "call_failed",
  "failure_message": "calling task status=NO ANSWER (Hangup by: bot)" }
```

`recipients[].attempts[].failure_code` is the field that differs — a SIP code:

| Code | Meaning | What actually happened |
| --- | --- | --- |
| `408` | Request Timeout | The phone rang. Nobody picked up. |
| `480` `500` `503` `603` | Unavailable / server failure / decline | The call was never placed. No phone rang. |

Take the code from the *last* attempt that carries one, since a retry that
eventually connected is what the report is describing.

This has been checked against ground truth rather than inferred. Two calls to
the same number, on the same route, 27 minutes apart: the `408` rang the phone
and the `480` did not, confirmed by the person holding it. At the call level
the two were indistinguishable — same status, same failure code, same message.

Three cautions:

- **It is undocumented.** `failure_code` is typed `string | null` on the calls
  API with no enum behind it. The tidy `no_answer | declined | timed_out | …`
  enum in the generated types belongs to the **Goals** API, a different surface.
  So the table above is transcription from observed calls, not a contract.
- **Treat an unrecognised code as "cannot tell".** Not as the likelier of the
  two. The costs are not symmetric: an over-cautious sentence wastes a retry,
  while "nobody answered" said of a call that was never placed puts a
  provider's outage in a venue's mouth.
- **`Hangup by: …` names nobody.** It reads `user` on some failures and `bot`
  on others, including on calls where no phone was ever reached and there was
  no callee in the loop at all. It is boilerplate. Do not read it in either
  direction.

**A failed call's summary is not safe to repeat.** On a call that was never
placed, the provider's own generated summary is still written as though a
person had been rung — one real example read "the recipient may be busy or
unavailable" about a number that never rang, and the status word attached to it
was `NO ANSWER`. Both are already in English and already wrong, which makes
them more dangerous than a numeric code. `structuredResult` is treated as
untrusted; the status and the summary deserve the same suspicion on a `failed`
call. This tool drops the summary where it knows the call was never placed, and
keeps it everywhere else, where it may be the only record there is.

**Recipient order is not guaranteed.** Match recipients back to venues by phone
number, not array position. Matching positionally would silently attribute one
venue's answers to another — the worst failure available to a tool someone plans
a journey around. Normalise both sides to E.164 first, since the number that
comes back may be formatted differently from the one sent.

## Result schema shape

One property per need, named by need id:

```json
{
  "type": "object",
  "required": ["step-free-entry"],
  "properties": {
    "step-free-entry": {
      "type": "object",
      "required": ["verdict"],
      "properties": {
        "verdict": { "type": "string", "enum": ["yes", "no", "partial", "unknown"] },
        "quote":   { "type": "string" },
        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
        "note":    { "type": "string" }
      }
    }
  }
}
```

**Only `verdict` is required.** Requiring `quote` at schema level would pressure
CALL-E into inventing one to satisfy the schema — the opposite of what the quote
is for. Its absence is enforced *downstream* instead, where a missing quote
downgrades an affirmative verdict to `unknown` rather than corrupting it.

## Webhooks

The API accepts a `webhook_url` and posts the terminal result to it. Current
deliveries are **unsigned** — `client.webhooks.verify` is deprecated and applies
only to the legacy signed contract. Deduplicate on the event `id` (or the
`CALL-E-Event-Id` header) and reject any event whose header id does not match
the body id.

This skill polls via `waitForResult` instead and does not use webhooks; a
long-running host should prefer the webhook.

## Regions

CALL-E's supported regions and languages are listed at
<https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages>.
Some destinations are served by international lines intended primarily for
testing. Check the destination country before relying on a result, and pass
`region` and `locale` on the recipient when they are known — never guessed.

## How long a call takes, and what that costs you

Measured, not estimated. Two real calls from this project:

| Placed | Completed | Elapsed |
| --- | --- | --- |
| 16:44:31 | 18:43:50 | 119 minutes |
| 08:21:22 | ~09:35 | 74 minutes |

For nearly all of that the task sat at `status: "queued"` with the recipient
`pending` and **zero attempts recorded**, then flipped straight to `completed`.
The status does not creep forward, so a long queue is not evidence that anything
has gone wrong — it very likely rang. `create` itself is not instant either: one
took 21.3 seconds to return.

Four consequences for anyone building on this:

- **Print the call id before you wait.** The script calls `create`, prints
  `Call call_… accepted` to stderr, and only then calls `waitForResult`. A
  wait that is interrupted, or that gives up, must not take the id with it —
  the id is the only way back to a call that is still quietly succeeding.
- **The SDK's wait gives up after ten minutes** (`timeoutMs` defaults to
  600 000), which is shorter than two of the three calls measured. The script
  keeps that default and takes `--wait <minutes>` to change it. When the wait
  gives up it prints the `--call` command to run later and exits 2. The call
  is not cancelled; CALL-E finishes it. `createAndWait` is the same wait with
  the same limit and no id printed first, which is why it is not used.
- **Do not hold an HTTP request open for a call.** A terminal session can be
  left running; a web request cannot. The platform kills the request long
  before the venue answers, and the caller is told the call failed while it is
  quietly succeeding.
- **Nothing may assume a duration.** 74 and 119 minutes are two observations,
  not a range and not a worst case.

The hosted web app for this project therefore splits `create` from the wait: the
request returns the call id as soon as CALL-E accepts it, and the answers are
fetched later with `calls.get`. It also puts the caller's profile in `metadata`,
so a call can be read back from its id alone — `metadata` round-trips on every
`GET`, which makes it the simplest place to keep what a later reader needs.
Re-validate it on the way back in rather than trusting it: it is data you sent
once and are reading back from someone else's service.

## Recovering an interrupted call

If the process is interrupted while a real call is in flight, or the wait gives
up, the call is not cancelled — CALL-E finishes it. Do not start a new one.
Rebuild the report from the id that was printed when the call was accepted:

```bash
node scripts/check_access.mjs --call call_… --profile alex.json
```

One `GET`, no dial, no credit, no confirmation prompt. Pass the profile the
call was placed with: the report is built from the profile you hand it, so a
different one shows `unknown` for needs the venue was never asked about. Venue
names come back from the call's own metadata, matched by number; a call placed
by an older copy of this script carries none and is labelled with the masked
number instead. `--venue`/`--phone` pairs override that when given.
