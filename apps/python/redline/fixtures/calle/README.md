# Replay fixtures

Synthetic payloads replayed by `redline run --transport replay`. They exist so
the public CALL-E response shape can be exercised with no network, credentials,
credits, transcript, or data copied from a real call.

## Rules

1. **Committed fixtures remain synthetic.** Never replace or supplement them
   with a provider response, transcript, recording, identifier, or metadata
   obtained from a real call, even when every participant consented.
2. **Use reserved fiction.** Every phone-shaped value must be masked or drawn
   from a standards-reserved fictional range.
3. **Mark the provenance.** Every bundled fixture uses
   `recorded_at: "synthetic"` and says explicitly that no real conversation is
   represented.
4. A locally recorded payload may be replayed from a private, ignored fixture
   directory for development, but it must never be committed or copied into
   this directory.

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

The files here are and will remain **synthetic**. They were hand-written to the
shape published in the CALL-E OpenAPI contract. They are schema fixtures, not
evidence of provider behaviour or a successful real call.
