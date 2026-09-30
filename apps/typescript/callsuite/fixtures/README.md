# Fixtures

Only fictional, manually reviewed, fully sanitized replay fixtures belong here. Every fixture must declare that it was manually reviewed and contains no raw transcript, recording URL, or real phone number. The replay loader enforces those declarations and also rejects sensitive field names and likely sensitive values.

Raw runtime artifacts are written to the ignored `artifacts/` directory and must not be committed. There is intentionally no automatic fixture-promotion command: a human must sanitize and review every fixture before adding it here.

## Test cases and evidence

`*.test-case.json` files declare deterministic assertions against the sanitized `evaluation.evidence` of a result fixture. Test cases carry the same sanitization declaration; assertion paths resolve inside `evaluation.evidence` only. The `cancellation-fee` set below proves the full exit-code matrix when replayed with `--test-case fixtures/cancellation-fee.test-case.json`:

| Fixture | Expected result | Exit |
|---|---|---:|
| `fixed-disclosure.sanitized.json` | pass | `0` |
| `broken-omission.sanitized.json` | fail (workflow regression) | `1` |
| `low-confidence.sanitized.json` | needs-review (below confidence floor) | `2` |
| `platform-failure.sanitized.json` | error (terminal status overrides passing evidence) | `3` |
