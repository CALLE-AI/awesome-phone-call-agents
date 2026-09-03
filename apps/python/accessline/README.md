# AccessLine

Consent-first venue accessibility verification using the CALL-E Developer REST API.

## What it does

Places one bounded outbound call (when explicitly authorized) to ask:

1. Is there a step-free public entrance?
2. Is an accessible restroom available?
3. Are there access limitations or arrival instructions?

Returns schema-valid JSON and preserves uncertainty instead of inventing certainty.

## No-call default

```bash
python3 -m accessline.cli --fixture examples/demo_fictional_venue.json --mode mock
```

Preview documented create-call request without placing a call:

```bash
python3 -m accessline.cli --fixture examples/demo_fictional_venue.json --mode preview-live
```

## Live path (opt-in)

Requires all of:

- `CALLE_API_KEY`
- `consent_confirmed=true`
- strict E.164 destination
- exact authorized destination match
- fresh per-run `LiveCallIntent` bound to run id, destination, and `live_call` action

Stored consent alone is never enough. Official CALL-E HTTPS origin is pinned;
arbitrary `CALLE_BASE_URL` overrides that are not the approved origin are rejected
before any bearer credential is attached.

## Synthetic / functional fixtures

Demo and schema examples under `examples/` are **fictional test data**
(`fixture_kind: FICTIONAL_TEST_DATA`, `synthetic: true`, `live_call: false`).

They prove local functional wiring only. They do **not** prove real-world
telephony reliability.

Example complete structured result:
`examples/fictional_complete_structured_result.json`

## Tests

```bash
python3 -m unittest discover -s tests -q
```

## Safety

- automation disclosure in script
- consent gate plus fresh per-run live intent
- live-call ledger ceiling
- pinned official CALL-E HTTPS origin
- phone numbers masked in normal output/artifacts
- transcript body omitted from normal persistence by default
