# CALL-E Consent Gate and Outcome Auditor

**Prototype test build - not a compliance guarantee.** Local tests cover the bundled synthetic examples; end-to-end SDK execution is unverified. Audits compare supplied transcript text and metadata, not independently verified audio or provider attempt history. Hashes identify content but do not authenticate consent. The included authorization is demo-only and cannot place calls.

A two-sided safety wrapper for CALL-E phone tasks. The preflight validates recipient authorization before execution; the post-call auditor checks the actual transcript, attempt count, voicemail path, and hang-up against the approved plan. Both tools avoid printing phone numbers, and the auditor stores a transcript hash rather than echoing recipient speech.

```powershell
python consent_gate.py examples/authorization.json --task "Call about pharmacy hours" --phone "+15555550123"
python outcome_audit.py path/to/your/private_runtime_result.json
python -m unittest discover -s tests -v
```

Live execution additionally requires `--execute`, `--confirm-call`, and `CALLE_API_KEY`. Automated tests never execute a call.

The bundled examples are synthetic and exercise disclosure-budget failures without claiming to reproduce a provider call.

## Compatibility

- Python 3.11+
- Official `calle-ai==0.2.0` SDK for opt-in live execution
- Fixture replay and all automated tests require no CALL-E account, API key, or network call

## Side effects and cancellation

- Dry run is the default and cannot dial.
- Live execution requires both `--execute` and `--confirm-call` plus `CALLE_API_KEY`.
- The app creates at most one CALL-E task per invocation and contains no recurring scheduler or retry loop.
- Before dispatch, cancel by declining either live flag. After dispatch, use CALL-E's provider controls; this app does not claim it can recall a call already accepted by the service.

## Safety boundaries

- Examples contain fictional or redacted numbers only.
- API keys must remain in `CALLE_API_KEY`; they are never accepted as command-line arguments or written by this project.
- Live execution prints only the call id, status, and task-completion flag; provider transcripts, summaries, and destination fields are not echoed.
- A valid authorization record is necessary but not sufficient for live execution: the operator must also supply `--execute` and `--confirm-call` at action time.
- The post-call report excludes recipient speech and emits separate policy and transcript fingerprints, binding the approved speech budget to the evidence being evaluated without copying the conversation into the report.
- The one-shot and voicemail findings are post-call checks; provider-side cancellation and suppression controls should still be used where available.
