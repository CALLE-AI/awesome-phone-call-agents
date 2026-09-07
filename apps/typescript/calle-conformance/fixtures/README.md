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

Present in 7 of 10 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `failed-attempt-timestamp-lags-four-hours`

On a failed attempt, startedAt is about four hours behind createdAt.

**Consequence.** An attempt appears to have started before the call it belongs to was created, so ordering by startedAt scrambles the timeline.

Present in 7 of 10 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `raw-sip-code-as-failure-code`

attempt.failureCode carries a bare SIP status number, outside the documented enum.

**Consequence.** Code branching on the documented failure codes falls through to its default branch for every real failure.

Present in 7 of 10 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `structured-result-without-conversation`

structuredResult is populated on an attempt with zero transcript turns.

**Consequence.** A caller reading structuredResult first records an answer from a person who was never reached.

Present in 7 of 10 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `summary-suggests-retry-for-unreachable-destination`

The summary proposes a retry window for a destination that cannot be reached at all.

**Consequence.** An automated retry loop keeps dialling a number that will never connect, spending quota on every pass.

Present in 7 of 10 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `single-attempt-reported`

The recipient reports exactly one attempt for a call the carrier logged as many dials.

**Consequence.** Dial volume, and anything metered by it, cannot be derived from the API response.

Present in 7 of 10 fixtures: `failed-404-0turns-09c72b.json`, `failed-486-0turns-d09b8b.json`, `failed-486-0turns-c64ac1.json`, `failed-603-0turns-42b9b8.json`, `failed-486-0turns-ba0ca6.json`, `failed-603-0turns-14ab2d.json`, `failed-603-0turns-d4734e.json`

### `connected-call-timestamps-are-well-formed`

On a call that connected, startedAt carries Z and agrees with createdAt.

**Consequence.** This is the control. A fake that formats every timestamp the same way cannot reproduce the split between the success and failure paths.

Present in 2 of 10 fixtures: `completed-no-failure-2turns-d1d516.json`, `completed-no-failure-7turns-f62388.json`

## Fixtures

| File | Status | failureCode | Turns | Quirks |
| --- | --- | --- | --- | --- |
| `queued-no-failure-0turns-10f4ce.json` | queued | - | 0 | 0 |
| `completed-no-failure-2turns-d1d516.json` | completed | - | 2 | 1 |
| `completed-no-failure-7turns-f62388.json` | completed | - | 7 | 1 |
| `failed-404-0turns-09c72b.json` | failed | `404` | 0 | 6 |
| `failed-486-0turns-d09b8b.json` | failed | `486` | 0 | 6 |
| `failed-486-0turns-c64ac1.json` | failed | `486` | 0 | 6 |
| `failed-603-0turns-42b9b8.json` | failed | `603` | 0 | 6 |
| `failed-486-0turns-ba0ca6.json` | failed | `486` | 0 | 6 |
| `failed-603-0turns-14ab2d.json` | failed | `603` | 0 | 6 |
| `failed-603-0turns-d4734e.json` | failed | `603` | 0 | 6 |

## Regenerating

```bash
npm run mask   # rewrites fixtures/ from local captures
npm run docs   # regenerates this file
```

Both are deterministic: the same captures produce byte-identical output. Neither places a call
nor contacts the API.
