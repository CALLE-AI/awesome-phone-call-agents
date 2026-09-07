# What the corpus found

A conformance report that only says "these behaviours are absent from your
fixtures" is close to a tautology: of course a project tested the thing it built.
The report earns its place when an absence turns out to be a defect. This file
records the ones that did, with the lines, so the claim can be checked rather than
believed.

Each entry is written to be useful to the project it names. None of them is a
security issue and none of them is careless work; every project here is well above
the median of this repository. They are all the same shape of mistake, which is
the point: the platform emits a value the documentation does not describe, and
code written against the documentation cannot see it.

---

## 1. `apps/typescript/call-on-behalf` — failure branches that real values cannot reach

**Behaviour:** `raw-sip-code-as-failure-code`. `attempt.failureCode` carries a bare
SIP status number, outside the documented enum.

**Where:** `src/errand.ts:87-96`

```ts
function failureOutcome(failureCode: string | null): ErrandOutcome {
  const code = (failureCode ?? "").toLowerCase();
  if (code.includes("voicemail") || code.includes("machine")) {
    return "voicemail";
  }
  if (code.includes("answer") || code.includes("busy") || code.includes("unreachable")) {
    return "not_reached";
  }
  return "call_failed";
}
```

Called at `src/errand.ts:425` with `attempt?.failureCode ?? call.failureCode ?? call.status`.

**What happens.** The three failure codes in this corpus are `404`, `486` and
`603`. None of them contains `voicemail`, `machine`, `answer`, `busy` or
`unreachable`, so for every failure recorded here the function returns
`call_failed` from its final line. The attempt-level code takes priority over the
call-level one, and the attempt-level code is the numeric one.

**Why the tests do not catch it.** `test/errand.e2e.test.ts:503` exercises the
`not_reached` branch with `failureCode: "busy"`. That value is well chosen against
the documented vocabulary and it is not a value this API produces on an attempt.
The test proves the branch works; it cannot show that the branch is reachable.

**The consequence, stated narrowly.** `not_reached` and `call_failed` render the
same sentence to the user (`src/errand.ts:127`), so that half of the mapping costs
nothing. The `voicemail` branch does not: it renders "The line went to a machine,
so nothing was asked. Try again at a different time of day."
(`src/errand.ts:123-125`). For the codes observed here, a caller who reaches an
answering machine is told the call did not connect to a person, and loses the one
piece of advice the app has for that case, which is to try at another time.

**Scope of the claim.** This corpus contains three failure codes from one account.
It does not establish that the platform never emits a word-based code on an
attempt, so the branches may be reachable under conditions not sampled here. What
it does establish is that the codes actually observed do not reach them.

**Suggested direction, not a patch.** Match the numeric codes alongside the words:
`486` is Busy Here and `603` is Decline, both of which mean the line was reached
and refused, while `404` means the destination was not routable at all. That is
three distinguishable outcomes where the code currently sees one.

---

## 2. `apps/typescript/hirecall` — the guard against scoring an unanswered call reads the value it is guarding against

**Behaviour:** `structured-result-without-conversation`. On an attempt that never
connected, `recipients[].structuredResult` is populated anyway, with zero
transcript turns. Seven of seven failures in this corpus do this.

**Where:** `src/lib/place-call.ts:41-45` and `src/lib/place-call.ts:257-281`

```ts
function snapshotResult(snapshot: CalleSnapshot): ScreeningResult | null {
  return parseScreeningResult(
    snapshot.recipients?.[0]?.structuredResult ?? snapshot.structuredResult ?? null,
  );
}
```

`parseScreeningResult` (`src/lib/call-result-schema.ts:101-115`) returns a filled
object for any input that is an object at all. It coerces each field to a default
and never returns null except for a non-object. It does not look at the attempt,
the failure code, or the transcript.

**What happens.** This app screens job candidates by phone and writes a score and
a decision against a person's name. Its guard against scoring somebody who was
never reached is at `src/lib/place-call.ts:265`:

```ts
if (endReason === "no_answer" || candidate.callStatus === "no_answer") { ... }
```

`endReason` is read from `response.result?.end_reason` two lines earlier, which is
the structured result the platform populated on a call that did not connect. So
the check that decides whether the result can be trusted is derived from the
result itself. The second half of that condition cannot save it either:
`mapCalleSnapshotToStatus` maps a failed call to `failed`, never to `no_answer`,
so `candidate.callStatus` is `failed` on exactly the payloads at issue. The next
guard, `if (!response.result)`, is false because a filled object was returned.
What follows is a Gemini call that produces a score and a `decision` for a
candidate whose phone never rang.

**Scope of the claim, stated narrowly.** Whether this fires depends on which
member of that app's `end_reason` enum the platform selects on a failed call. If
it selects `no_answer`, the guard holds. This corpus cannot answer that, because
it was captured against a different schema: on ours the platform chose `unknown`,
the member that meant nobody answered. What the corpus does establish is that
`structuredResult` is populated on a call with no conversation, so the app's
safety rests entirely on a value it did not compute and does not check. Two
fields it already receives would settle it without guessing:
`attempt.failureCode` is non-null and `transcriptTurns` is empty.

**Why nothing catches it.** This project ships no tests and no fake server, so
there is no payload anywhere in it that could exercise the branch.

**Suggested direction, not a patch.** Refuse to score before consulting the
structured result at all: if the last attempt has a non-null `failureCode`, or no
transcript turns, treat the result as absent regardless of what it contains. The
app already has a branch for that case and a sentence to render.

---

## How these were found

```bash
npm run replay -- <path to a checkout of this repository> corpus=fixtures
```

The report shows which behaviours a project's own fixtures never contain. That is
the shortlist, not the finding.

The second entry came from the other half of the same report. `hirecall` has no
JSON payloads at all, so it cannot appear in the table; it appears instead in the
list of projects that call this API and ship nothing to test against, which the
checker prints below the matrix. Fifty-three of the fifty-nine projects that
consume this API are in that list. A project with no recorded payload is not
covered by six of the seven behaviours; it is uncovered by all of them. Each entry above was then read in the source, and
is reported only where an absent behaviour reaches code that would treat it
differently from the values the project tested against.

Entries are removed from this file if the project changes, or if the claim turns
out to be wrong.
