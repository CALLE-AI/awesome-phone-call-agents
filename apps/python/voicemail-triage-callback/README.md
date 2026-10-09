# Voicemail Triage Callback

Places a real CALL-E callback for exactly the voicemails that are safe and simple enough to
automate -- never for one that hasn't already been screened as not-scam-and-not-complex by
something upstream.

Most people who block all unknown numbers to stop scam calls also silently lose the real
callers hidden in the same pile: a lead, a delivery driver, a dentist confirming an
appointment. This app is the last step of that recovery: given a task an upstream triage
step has already decided is safe to automate, it places the real call and returns CALL-E's
structured result. It does not do the triage itself, and it never decides on its own that a
call is safe -- that judgment must come from whatever hands it a task.

The full reference pipeline this app is extracted from -- AssemblyAI voicemail transcription,
then classification with the Strands Agents SDK on Amazon Bedrock, then this same callback
step -- is at [github.com/axxess-triaxis/callismatic](https://github.com/axxess-triaxis/callismatic).

## Setup

```bash
cd apps/python/voicemail-triage-callback
pip install -r requirements.txt
```

`calle-ai` is only needed for `--live`; `--demo` mode has no dependency at all.

## Try it without any credentials

```bash
python callback.py --demo delivery   # a missed-delivery voicemail -> callback confirming redelivery window
python callback.py --demo lead       # a new business lead -> callback offering a consultation
```

Both print a canned result in the same shape CALL-E's real API returns, with a `"note"` field
making clear no call was placed.

## Placing one real call

```bash
export CALLE_API_KEY="<your key from https://dashboard.heycall-e.com/account/api-keys>"
python callback.py --live --confirm --task "Call back and confirm the 2:30pm cleaning appointment." --to-phone "+15551234567"
```

- `--live` and `--confirm` are both required together; `--confirm` attests explicit intent
  for this call and the recipient's authorization, never implied by `--live` alone.
- `--to-phone` must be a real E.164 number you own or are authorized to call. This app never
  guesses, infers, or reformats a phone number -- the value you pass is exactly what gets
  dialed.
- `--task` is the exact natural-language instruction CALL-E's agent will act on. Write it the
  way you would brief a person: concrete and bounded, not open-ended.

## Side effects, credentials, data

- One real CALL-E call per `--live` invocation. No recurring schedule, no background job,
  nothing left running after the call completes.
- No API key is bundled, hardcoded, or read from anywhere but the `CALLE_API_KEY` environment
  variable -- the app fails with a clear `RuntimeError` rather than falling back to a shared
  default.
- The live CLI prints only a bounded status and a masked destination. Integrations calling
  `place_callback` receive the private provider result and must protect it before sharing.
  This app does not persist a log file or write anywhere else on disk.
- All example phone numbers in this README, in `--demo` mode, and in tests are fictional
  reserved numbers (`+1555...`) -- never a real, dialable number.

## Cancellation and rollback

`--demo` mode has no side effects -- nothing to cancel. Once a live call is placed via
`--live --confirm`, this app cannot cancel it mid-call; use the CALL-E dashboard if it exposes
a cancel action for in-progress calls. There is no recurring schedule anywhere in this app to
disable, and no local state file is written that would need cleaning up.

After a timeout or unclear provider outcome, reconcile the original call before trying
again; this primitive never automatically retries. Upstream classification is advisory.
Medical, legal, financial, employment, emergency, or otherwise consequential decisions
require human review and are outside this automatic callback's scope. Do not disclose
sensitive information merely because an upstream classifier marked the task safe.

## Validation

Tests run against a mocked CALL-E client and never place a real call:

```bash
pip install pytest
pytest -q
python3 ../../../scripts/validate_repository.py
```
