# Freshness, uncertainty, and what a call result is allowed to become

A safety pattern. A phone call produces a sentence spoken by one person on one day.
Turning that into something a stranger reads next month is where the honesty is won
or lost.

## Only a real answer earns a long life

```text
answer_status = answered     -> expires in CALLE_FAQ_TTL_DAYS   (default 90)
anything else                -> expires in 1 day
```

`unclear`, `refused`, `unreachable` and `unknown` are not answers, and caching them
for 90 days would turn "we called at a bad moment" into a durable claim about the
business. One day means the next visitor retries rather than inheriting a failure.

This asymmetry matters more than the specific numbers. A single TTL applied to every
outcome either caches failures too long or re-dials successes too often.

## Uncertainty survives storage

Each of the non-answer states is stored and displayed as itself:

| State | What it means | What the reader sees |
|---|---|---|
| `answered` | A staff member gave a clear factual answer | The answer, with the quote |
| `unclear` | Someone answered but did not know, or hedged | Shown as unclear, not as a "no" |
| `refused` | They declined to answer | Shown as refused — which is information |
| `unreachable` | Voicemail, menu, disconnected, no pickup | Shown as not reached |

`staff_confidence` (`certain` / `hedged` / `unknown`) is carried separately, because
"probably, I think" and "yes" are different facts and flattening them into a boolean
loses the part that mattered.

A hedge presented as a fact is worse than no fact, because it is the kind of error a
reader cannot detect.

## Evidence is what makes it checkable

Every stored answer carries `evidence_quote` — the words the staff member actually
used, capped at 200 characters — displayed next to the paraphrase. A reader who
distrusts the summary can read the sentence it came from.

What is *not* published is the raw transcript. It is kept server-side for the call log;
what a reader sees is a short written note about how the call went. A stranger's phone
conversation is not listing content, and a transcript published verbatim is a privacy
decision made on behalf of someone who was told this was one quick question.

## Simulated results are marked in storage, not in the view

The `simulated` flag is written into the record itself and travels with it, rather than
being inferred at render time from the current configuration. A record collected while
the server was in dry-run stays marked as simulated forever, including after real calls
are switched on. A simulated answer presented as a real one is the single thing this
feature must never do, so the marking lives where it cannot drift.

## A published fact and a private result are different objects

The publish step forks. A private result is written under the requesting account's own
key and never to the place's shared list, so there is no later step that could promote
it. "It is never added to the public listing" is a property of where the bytes go
rather than a rule someone has to keep following.

Private results also expire much sooner — 30 days against 90. A shared fact earns a
long life by being reused; a private answer about one visit is spent the moment that
visit happens, and keeping it longer is storing somebody's errand for no one's benefit.

## Rechecking has to defeat replay

The reader gets a Recheck button, because an answer can be wrong long before its TTL
expires — hours shift, policies change seasonally.

The trap: CALL-E replays a call for a repeated Idempotency-Key, so a recheck that
reuses the original key returns the very answer being rechecked, and the button appears
to work while changing nothing. Appending an hour bucket to the key makes a recheck a
genuinely new request once an hour, while a double-click inside that hour still dedupes
instead of dialling twice.

## Facts are keyed to survive a rename

The storage key prefers a provider place id and falls back to a name-plus-coordinate
hash. A business that changes its name keeps its collected facts; two businesses at the
same address do not share them.
