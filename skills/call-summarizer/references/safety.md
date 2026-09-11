# Safety Reference — call-summarizer

`call-summarizer` is a post-call analysis skill. It never places, schedules,
cancels, or modifies a phone call. The safety surface is about the transcript
and the brief, not about the call itself.

## No calls, no network

- The skill reads a transcript that was already produced by an authorized
  CALL-E call. It does not trigger any new call.
- `scripts/summarize_call.py` makes no network requests. It uses only the
  Python standard library and runs entirely locally.
- There is no third-party summarization API, no cloud call, and no telemetry.

## Masking and PII

The brief uses a **partial masking** contract. The `masked` field is set to
`"partial"` (not `true`) and a `masking_scope` field documents exactly which
PII classes are tokenized:

- Phone numbers are replaced with `[phone:••••]` tokens.
- Email addresses are replaced with `[email:••••]` tokens.
- Account or reference identifiers are replaced with `[id:••••]` tokens.
- Personal names introduced by a title (`Dr.`, `Mr.`, `Ms.`, `Mrs.`, `Prof.`)
  or an introduction cue (`this is`, `I'm`, `my name is`, `with me is`,
  `speaking, this is`) are replaced with `[name:••••]` tokens.

**What is NOT masked:** ordinary personal names that appear in transcript text
without a title prefix or introduction cue (e.g. "Alice will call Bob
tomorrow") are NOT redacted. The skill is deterministic and stdlib-only (no
NER model), so it cannot reliably detect every personal name. The contract
is honest about this boundary: `masked: "partial"` with a `masking_scope`
field listing the PII classes that ARE tokenized. A `masking_note` field in
the brief warns downstream consumers not to store or log the brief if the
transcript may contain uncued personal names.

The validator checks that the specific PII classes listed in `masking_scope`
do not survive in `summary`, `actions[].verb`, or `actions[].source_span`.
A brief with `masked: true` (legacy form) is still accepted but is held to
the stricter standard of zero residual PII of any kind.

The `caller_fingerprint` field is a one-way SHA-256 hash of the redacted caller
identity fields. The raw identity is never stored or emitted. The fingerprint
exists only to de-duplicate repeat callers across calls without retaining PII.

## Abstention over invention

- If the transcript is empty, garbled, or does not support an outcome, the
  brief reports `outcome: unknown` with an empty `actions` list.
- The skill never generates a plausible-sounding outcome that the transcript
  does not support.
- Hedged language ("I think so", "probably") is preserved in the outcome and
  the sentiment justification rather than flattened to a confident statement.
- Outcome detection never asserts an outcome from agent-only text. If the
  callee's intent is contradictory — whether across separate utterances or
  within a single one (e.g. "Yes, I can't make it") — the outcome fails
  closed to `unknown` rather than picking the first cue that matched.

## Sensitive categories

Action items that touch medical, legal, financial, or emergency commitments are
tagged `category: sensitive`. The skill reports them but does not auto-dispatch
them. The operator or host agent decides whether to escalate, and the brief
includes a `sensitive: true` flag on those items to make downstream routing
explicit.

## Transcript handling

- The skill does not persist the transcript. It reads it, produces the brief,
  and the transcript remains the operator's responsibility to retain or discard.
- The bundled `references/example-transcript.json` is a fictional fixture, not
  a real call recording, and contains no real phone numbers or personal data.
