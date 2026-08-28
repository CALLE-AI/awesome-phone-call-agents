# Config reference

`linecanary.config.json`, validated strictly at load — errors name the
offending entry. Fictional numbers throughout.

```jsonc
{
  "lines": [{
    "id": "main-office",                 // unique
    "phone": "+15550100",               // E.164 only
    "region": "US", "locale": "en-US",  // optional hints passed to CALL-E
    "ownership": {                       // REQUIRED — pick one method
      "method": "greeting_code", "code": "LC-7391"
      // or: "method": "attestation", "statement": "Authorized under MSA dated …"
    }
  }],
  "checks": [{
    "id": "reception-hours",            // unique
    "line": "main-office",              // must reference a declared line
    "task": "Ask what the Saturday opening hours are. Record the answer.",
    "resultSchema": {                    // strict JSON Schema; CALL-E validates on-call
      "type": "object",                  // must be object with additionalProperties:false
      "properties": {
        "answered": { "type": "boolean" },
        "hours_answer": { "type": "string" }
      },
      "required": ["answered"],
      "additionalProperties": false
    },
    "assert": [                          // each: path + exactly one operator
      { "path": "answered", "equals": true },
      { "path": "hours_answer", "contains": "saturday" },   // case-insensitive
      { "path": "hours_answer", "matches": "9|nine" },      // regex, compiled with /i
      { "path": "hours_answer", "oneOf": ["9-12", "9 to noon"] },
      { "path": "extra.field", "exists": false }            // dot-paths supported
    ],
    "timing": {                          // from transcript offsets
      "maxSecondsToAnswer": 20,          // first callee utterance
      "maxSecondsToFirstResponse": 15    // callee utterance after our first line
    },
    "minConfidence": 0.6                 // CALL-E completion confidence floor
  }],
  "alerts": { "slackWebhookUrl": "env:LINECANARY_SLACK_WEBHOOK" }, // env: indirection
  "baselineDir": "baselines"            // JSON history; commit, cache or mount it
}
```

Rules enforced at load: unique ids; every `check.line` resolves; E.164
phones; object schema with `additionalProperties: false`; valid regexes;
every check asserts something (assertions, timing or confidence); `env:`
variables must exist.

A check with no `timing` and no `minConfidence` still needs at least one
assertion. Timing bounds fail loudly when unmeasurable (no callee utterance
with a timestamp) rather than passing silently.

Regression semantics against the stored history (per check): `new_failure`,
`assertion_regressed` (named assertion, last-passed timestamp),
`timing_regressed` (max(2× median, median + 10 s) over last 10 pass runs),
`confidence_dropped` (0.2 under pass median), `still_failing`, `recovered`.
First run is the baseline — an empty history never alerts.
