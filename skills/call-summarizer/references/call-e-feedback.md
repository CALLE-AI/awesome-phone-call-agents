# CALL-E Feedback — call-summarizer build notes

Feedback collected while building the `call-summarizer` skill for the CALL-E
hackathon. This documents friction, gaps, and suggestions encountered when
consuming a CALL-E call result and turning it into a post-call brief.

Submitted for the "Most Valuable Feedback" prize track.

## What worked well

- **MCP result shape is usable.** A completed CALL-E call returns a structured
  result with a `summary` and, when available, a `transcript` field. The
  transcript-as-list-of-turns shape is easy to consume downstream.
- **`result.summary` honours goal-named fields.** When the call `goal` names the
  fields you want, CALL-E emits them in `result.summary` reliably. This makes
  structured extraction from the call itself tractable.
- **Dry-run / fake-server path exists.** The reference apps ship a local fake
  MCP broker server, which let this skill be built and tested with zero live
  calls and zero credentials. This is the right default for a hackathon.
- **Skill folder convention is clean.** The `SKILL.md` + `references/` +
  `scripts/` pattern made it straightforward to ship a self-contained,
  standard-library-only skill that installs with no `pip install`.

## Friction and gaps

### 1. Transcript schema is not documented as a stable contract

The call result includes a `transcript`, but the exact schema (string vs list
of turns, turn field names, speaker labels) is not documented as a versioned
contract. This skill had to defensively handle both a plain-string transcript
and a list-of-turns transcript because both showed up in different examples.

**Suggestion:** Publish a versioned `Transcript` schema in the CALL-E
integrations repo (e.g. `packages/types`) with the turn shape, speaker enum,
and a stable `schema_version` field. Downstream skills like this one could then
parse once instead of guessing.

### 2. No `result_schema` on the MCP call tool

CALL-E's MCP surface has no `result_schema` parameter, so the fields you want
must be embedded in the `goal` text. This works but is fragile: a slightly
different phrasing can change which fields come back. It also means there is
no machine-readable contract for what a given call will return.

**Suggestion:** Add an optional `result_schema` (JSON Schema) parameter to the
MCP call tool. CALL-E could validate the returned summary against it and the
calling agent could parse the result without string-matching. This would make
structured post-call analysis (the whole point of this skill) far more
reliable.

### 3. Sentiment / outcome not surfaced in the result

The call result returns a `summary` and `status`, but not a sentiment or an
outcome classification. Every post-call analysis skill has to re-derive these
from the transcript. For a platform whose value is "real-world tasks done over
the phone," the outcome label is the single most useful field and it is
absent.

**Suggestion:** Surface `outcome` (confirmed / declined / rescheduled /
no-answer / voicemail / unknown) and `sentiment` as first-class fields in the
call result, grounded in transcript spans. Even a coarse, span-cited label
would save downstream skills from rebuilding this.

### 4. No redacted / masked transcript mode

The transcript contains raw phone numbers, and in some cases names. Any skill
that logs, stores, or forwards a post-call brief has to mask these itself.
This skill ships its own masker, but a platform-side redacted-transcript mode
would reduce the chance of a PII leak across the ecosystem.

**Suggestion:** Offer a `redact_pii: true` option on the call result, or a
separate `transcript_redacted` field, so downstream skills get a safe-to-log
transcript without each implementing their own masker.

### 5. Caller identity for dedup is implicit

There is no stable, redacted caller identifier in the result. De-duplicating
repeat callers (so a follow-up skill knows "this is the same person we called
Tuesday") requires hashing identity fields yourself, with no platform guidance
on which fields are stable.

**Suggestion:** Provide a one-way `caller_fingerprint` in the result, derived
from stable caller identity fields, so dedup is consistent across skills and
no skill has to store raw identity.

### 6. `status` enum is not documented

The call `status` field uses values like `completed`, but the full enum and
their meanings (does `completed` mean the call connected, or that the task
finished?) is not documented. This skill had to treat `completed` as
"call finished" and infer connection from the transcript.

**Suggestion:** Document the `status` enum and its semantics, including the
difference between call-connection states and task-completion states.

## Summary

CALL-E's core primitive (place a call, get a structured result) is solid and
the MCP surface is workable. The biggest wins for the post-call-analysis
ecosystem would be: (1) a versioned transcript schema, (2) a `result_schema`
parameter on the call tool, and (3) first-class `outcome` and `sentiment`
fields in the result. Each of those removes a re-implementation that every
post-call skill currently has to carry.
