# Corpus of real CALL-E responses

Captured from the CALL-E Developer API against a live account, then rewritten so it can be
published. Every fixture here is the shape of a response the platform actually returned.

It exists because a fake server written from the documentation reproduces the documentation,
not the platform. This corpus is the difference between the two, in a form that code can read.

## What was changed, and what was not

Changed: call, recipient and attempt identifiers, provider call identifiers, phone numbers, and
the absolute position of every timestamp. Machine speech that named a carrier was replaced with
a neutral equivalent. Phone numbers are drawn from `+1 202 555 01xx`, reserved for documentation,
and no other number appears anywhere in this directory.

Not changed: the structure, the status and failure vocabulary, transcript turn counts and
speakers, the presence or absence of a timezone designator on each timestamp, and the interval
between timestamps. Those carry the findings.

The generator compares the quirks present in the original capture against the quirks present in
the rewritten fixture and refuses to emit any fixture whose quirk set moved in either direction,
so the rewriting provably did not change the answer. Raw captures are never published.

## Quirks

A quirk is a behaviour a caller would not predict from the documented shape. Each one is a
predicate in `src/quirks.ts`, not a paragraph, so it can label a fixture, verify the rewriting,
and score a fake server against reality.

### `failed-attempt-timestamp-has-no-zone`

On a failed attempt, startedAt carries no timezone designator while createdAt does.

**Consequence.** A parser reads the string as local time. Every duration and retry decision derived from it is wrong by the reader's own offset plus the platform's.

Present in 7 of 15 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `failed-attempt-timestamp-lags-four-hours`

On a failed attempt, startedAt is about four hours behind createdAt.

**Consequence.** An attempt appears to have started before the call it belongs to was created, so ordering by startedAt scrambles the timeline.

Present in 7 of 15 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `raw-sip-code-as-failure-code`

attempt.failureCode carries a bare SIP status number, outside the documented enum.

**Consequence.** Code branching on the documented failure codes falls through to its default branch for every real failure.

Present in 7 of 15 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `structured-result-without-conversation`

structuredResult is populated on an attempt with zero transcript turns.

**Consequence.** A caller reading structuredResult first records an answer from a person who was never reached.

Present in 7 of 15 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `summary-suggests-retry-for-unreachable-destination`

The summary proposes a retry window for a destination that cannot be reached at all.

**Consequence.** An automated retry loop keeps dialling a number that will never connect, spending quota on every pass.

Present in 7 of 15 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `single-attempt-reported`

The recipient reports exactly one attempt for a call the carrier logged as many dials.

**Consequence.** Dial volume, and anything metered by it, cannot be derived from the API response.

Present in 7 of 15 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `connected-call-timestamps-are-well-formed`

On a call that connected, startedAt carries Z and agrees with createdAt.

**Consequence.** This is the control. A fake that formats every timestamp the same way cannot reproduce the split between the success and failure paths.

Present in 7 of 15 fixtures: `completed-no-failure-9turns-549d84.json`, `completed-no-failure-7turns-8a9aeb.json`, `completed-no-failure-8turns-0f3ac1.json`, `completed-no-failure-7turns-4260e0.json`, `completed-no-failure-2turns-d1d516.json`, `completed-no-failure-7turns-f62388.json`, `completed-no-failure-8turns-ff6b5c.json`

### `recipient-speaks-after-the-agent-stops`

The transcript continues after the agent's last turn.

**Consequence.** Reading the answer as the turn that follows the question can take a fragment the recipient was still speaking, while the real answer arrives after the agent has already said goodbye.

Present in 6 of 15 fixtures: `completed-no-failure-9turns-549d84.json`, `completed-no-failure-7turns-8a9aeb.json`, `completed-no-failure-8turns-0f3ac1.json`, `completed-no-failure-7turns-4260e0.json`, `completed-no-failure-2turns-d1d516.json`, `completed-no-failure-7turns-f62388.json`

## Fixtures

| File | Status | failureCode | Turns | Quirks |
| --- | --- | --- | --- | --- |
| `queued-no-failure-0turns-10f4ce.json` | queued | - | 0 | 0 |
| `completed-no-failure-9turns-549d84.json` | completed | - | 9 | 2 |
| `completed-no-failure-7turns-8a9aeb.json` | completed | - | 7 | 2 |
| `completed-no-failure-8turns-0f3ac1.json` | completed | - | 8 | 2 |
| `completed-no-failure-7turns-4260e0.json` | completed | - | 7 | 2 |
| `completed-no-failure-2turns-d1d516.json` | completed | - | 2 | 2 |
| `completed-no-failure-7turns-f62388.json` | completed | - | 7 | 2 |
| `failed-404-0turns-09c72b.json` | failed | `404` | 0 | 6 |
| `failed-486-0turns-d09b8b.json` | failed | `486` | 0 | 6 |
| `failed-486-0turns-c64ac1.json` | failed | `486` | 0 | 6 |
| `failed-603-0turns-42b9b8.json` | failed | `603` | 0 | 6 |
| `failed-486-0turns-ba0ca6.json` | failed | `486` | 0 | 6 |
| `completed-no-failure-8turns-ff6b5c.json` | completed | - | 8 | 1 |
| `failed-603-0turns-14ab2d.json` | failed | `603` | 0 | 6 |
| `failed-603-0turns-d4734e.json` | failed | `603` | 0 | 6 |

## Who was on the other end

A corpus of captured responses invites one question before any other: whose
conversation is this. The answer here is that there is not one. Every counterpart
in these transcripts is a machine, and each is identifiable from its own words in
the payload:

| what answered | how you can tell, from the fixture itself |
| --- | --- |
| the CALL-E English testing hotline, published by a maintainer on 7 September 2026 for exactly this | it introduces itself: `I'm an AI voice agent for this hotline` |
| a carrier test platform | every one of its turns is prefixed `This is an automated call generated on a carrier test platform` |
| a provider trial gate | its single turn is the verification notice it plays to unverified numbers |

No private individual is recorded here, no conversation between people, and
nothing anybody said in confidence. The task prompts are the author's own.

What was rewritten, and what was deliberately not:

- **Numbers** are replaced with ones from ranges reserved for documentation.
  `test/corpus.test.ts` fails if a number outside those ranges reaches this
  directory, verified by injecting a real one.
- **Identifiers** are replaced with deterministic synthetic values. Not one
  identifier from the private captures appears here, and a test compares the two
  sets to keep it that way.
- **Absolute times** are rebased onto a fixed synthetic instant, so no fixture
  says when any call happened.
- **Relative times are preserved on purpose.** The gap between `createdAt` and a
  failed attempt's `startedAt`, and the offsets between turns, are the evidence
  for three of the behaviours below. Normalising them would delete the finding
  rather than protect anybody, since an interval identifies nobody.

The private captures these were derived from are never published, and the two
tests that check the rewriting against them skip from a clean checkout and say so.

## Regenerating

```bash
npm run mask   # rewrites fixtures/ from local captures
npm run docs   # regenerates this file
```

Both are deterministic: the same captures produce byte-identical output. Neither places a call
nor contacts the API.
