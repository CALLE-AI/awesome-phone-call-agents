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

**Correction, 8 September 2026.** An earlier version of this entry claimed that a
caller who reaches an answering machine is told the call did not connect to a
person. That is wrong, and this file said it would be removed if it turned out to
be. A maintainer reproduced the workflow in
[issue #375](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/375) and
did not reproduce the misclassification. Checking their reading against the source:
`src/errand.ts:420` tests `reading.machineAnswered` **before** `failureOutcome` is
called at line 425, so when the transcript carries a machine greeting the outcome
is `voicemail` whatever the failure code says. The word branches are not the only
route to that message, and the entry should never have said they were.

**The consequence that survives, stated narrowly.** Two of the three outcomes cost
nothing either: `not_reached` and `call_failed` render the same sentence
(`src/errand.ts:127`). What is left is real but small. Every failed call in this
corpus carries `transcriptTurns: []`, and with no transcript there is no
`machineAnswered` evidence, so the failure code is the only signal the app has. For
`404`, `486` and `603` it always resolves to `call_failed`, which means three
distinguishable situations collapse into one: `404` is a destination that was not
routable at all, `486` is Busy Here and `603` is Decline, and the last two mean the
line was reached and refused. The app cannot tell them apart, and the codes are the
only place that information exists.

**What the corpus did establish.** That the five word branches cannot be reached by
the values this API puts on an attempt. The maintainer's own reproduction table in
#375 shows the same thing from the other direction: `404`, `486` and `603` with an
empty transcript all produce `call_failed`. The absence was real; the harm was
overstated, and the overstatement was mine.

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

**Correction, 8 September 2026.** An earlier version of this entry said the check
is derived from the result it is checking, and described that circularity as the
defect. That framing was wrong in the same way the entry above it was wrong: it
asserted a runtime path without following it. Following it changes the finding and
makes it sharper, so the wording is replaced rather than trimmed.

**What actually happens, line by line.** `end_reason` does not appear anywhere in
the fifteen responses in this corpus. On the failed calls the platform sends
`recipients[].structuredResult` as `{"heard_clearly": "unknown"}`, which is this
task's own question, not an end reason.

The app manufactures one anyway. `parseScreeningResult`
(`src/lib/call-result-schema.ts:111`) coerces the missing field through
`asEnum(row.end_reason, END_REASON, "failed")`, so `result.end_reason` comes back
as `"failed"`. That value did not come from the platform. It is this app's own
default wearing the shape of platform data.

Then at `place-call.ts:257`:

```ts
const endReason =
  response.result?.end_reason ||
  (candidate.callStatus === "no_answer" || ... ? candidate.callStatus : "failed");
```

`"failed"` is truthy, so the fallback on the right never runs, and `endReason` is
`"failed"`. The guard on line 265 asks whether it is `"no_answer"`. It is not. The
second half cannot save it either: `mapCalleSnapshotToStatus` (`place-call.ts:90`)
returns `"failed"` for a snapshot whose status is `failed`, never `"no_answer"`,
which is exactly the payload at issue. The next guard, `if (!response.result)`, is
false because `parseScreeningResult` returns a filled object for any object at
all, including `{"heard_clearly": "unknown"}`. Past that point the guard has missed, on
exactly the payloads it exists for.

So the defect is not that the check reads what it is checking. It is that the
value the check reads is invented by the app's own parser, from a field the API
did not send, and the invented default is the one value that makes the guard miss.

**Correction, 9 September 2026.** An earlier version of this entry ended the
paragraph above by saying that what follows is a model call producing a score and
a decision for a candidate whose phone never rang. A maintainer replayed the seven
failed samples in this corpus through the current `hirecall` workflow and reported
that its existing checks filter failed results out before model scoring: none of
the seven reached scoring, and none produced a rejection. That consequence is
withdrawn. What the replay did not contradict, and what this entry still claims,
is the guard itself: `end_reason` is absent from all fifteen responses, the app's
own parser manufactures it as `"failed"`, and `"failed"` is not `"no_answer"`, so
the guard misses on the payloads it exists for. The entry now stops where the
evidence stops.

**Scope of the claim, stated narrowly.** Fifteen responses from one account cannot
establish that the platform never sends `end_reason`; it may appear under
conditions this corpus did not reach, and if it ever arrives as `no_answer` the
guard holds. What the corpus does establish is that on every failed call it
contains, the field is absent and `structuredResult` is populated anyway. Two
fields the app already receives would settle it without guessing:
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
