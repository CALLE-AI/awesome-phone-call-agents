# Examples

All commands are offline and require only Node.js 20 or newer.

## Check the bundled example policy

From this skill directory:

```bash
node scripts/check-boundary-policy.mjs --policy references/example-policy.json
```

Expected summary:

```text
PASS example-call-boundary-policy against call-boundary-probes/1.0
8/8 static probe declarations matched.
Verified scope: static policy declarations only.
Agent, model, provider, and live-call behavior verified: false.
External side effects: 0.
```

## Produce a machine-readable report

```bash
node scripts/check-boundary-policy.mjs \
  --policy references/example-policy.json \
  --json
```

The JSON report includes one result per probe and these explicit limits:

```json
{
  "verified_scope": "static-policy-declarations",
  "text_classification_verified": false,
  "agent_behavior_verified": false,
  "model_behavior_verified": false,
  "provider_behavior_verified": false,
  "live_call_verified": false,
  "external_side_effects": []
}
```

## Demonstrate a fail-closed mismatch

Copy `references/example-policy.json` outside the skill and change the
`wrong_recipient` rule to permit context disclosure. The checker exits `1` and
identifies that probe as a mismatch. This verifies the static declaration, not
whether a running agent would actually avoid disclosure.

## Run the focused tests

```bash
node --test scripts/check-boundary-policy.test.mjs
```
