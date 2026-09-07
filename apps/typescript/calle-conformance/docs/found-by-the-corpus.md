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

## How these were found

```bash
npm run replay -- <path to a checkout of this repository> corpus=fixtures
```

The report shows which behaviours a project's own fixtures never contain. That is
the shortlist, not the finding. Each entry above was then read in the source, and
is reported only where an absent behaviour reaches code that would treat it
differently from the values the project tested against.

Entries are removed from this file if the project changes, or if the claim turns
out to be wrong.
