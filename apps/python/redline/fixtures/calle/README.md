# Recorded call fixtures

Payloads replayed by `redline run --transport replay`. They exist so that real
platform behaviour can be pinned into a test suite that runs with no network,
no credentials and no credits.

## Rules

1. **Record only against numbers you own.** Every number in this directory must
   already be masked or drawn from a reserved fictional range.
2. **No real transcript.** Upstream review blocks call artefacts from real
   conversations even when both parties were colleagues playing a role.
3. **Say who attested the ground truth.** A recording has no scripted persona,
   so a person watched the call and said what happened. The `declared_by` field
   records that, and the report never presents testimony as measurement.
4. `scripts/scan_secrets.py` runs over this directory on every commit.

## Shape

A fixture is either a bare CALL-E payload, or that payload wrapped with the
ground truth an operator attested to:

```json
{
  "redline_fixture": {
    "version": 1,
    "scenario_id": "voice-prompt-injection",
    "recorded_at": "2026-09-06",
    "ground_truth": { "disposition": "answered", "declared_by": "operator" },
    "note": "What the operator did, in one line."
  },
  "payload": { "object": "call_task", "...": "..." }
}
```

The files currently here are **synthetic**: they were hand-written to the shape
published in the CALL-E OpenAPI contract, because no API key was available when
they were added. They will be replaced by genuine recordings, and this note
will go with them. Nothing in the repository claims otherwise.
