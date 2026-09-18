# Import Rescue

A focused CALL-E callback for the business question behind a blocked catalog upload.

A catalog file can be structurally valid but still impossible to import safely: two price columns, a missing tax convention, and duplicate product identifiers. Import Rescue prepares three bounded questions for the consenting uploader, captures CALL-E's structured answers and recipient quotes, and generates a review proposal. It never imports, publishes, merges identities, changes a catalog, or treats a completed call as permission to do so.

This is a new hackathon prototype, built September 8, 2026. Its intended user is a small commerce operations team whose uploader is away from a laptop but available for a short requested callback. This need is a product hypothesis, not a claim of customer adoption or measured time savings. The builder's product work with data platforms informed the problem choice; no employer data or proprietary code is used.

## Run without an account or a call

Python 3.12 or newer is recommended. From this directory:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest -v
.venv/bin/python rescue.py preview
.venv/bin/python rescue.py demo --scenario confirmed
.venv/bin/python rescue.py demo --scenario unknown
.venv/bin/python rescue.py serve --port 8766
```

Open `http://127.0.0.1:8766`. The browser server binds to loopback and exposes only a synthetic demo. It has no endpoint that can place a phone call. The four scenarios are explicit fixtures: clear answers, unknown tax basis, voicemail, and a fabricated extraction quote. Each runs the actual reconciliation and row-proposal code. No API key or paid model is used.

The sample catalog contains fictional products. Sample phone values in tests are transported only through `httpx.MockTransport`; they must never be dialled.

## What is implemented

- CSV parsing with size and schema bounds, numeric validation, preserved identifier strings and a version hash.
- A fixed, inspectable CALL-E task. Arbitrary cell text and product titles are never interpolated into agent instructions.
- An official `calle-ai==0.7.0` integration using `CalleClient.calls.create` and `calls.get`.
- Structured extraction with bounded answer enums including `unknown`.
- Single-recipient transcript checks, exact recipient-quote provenance, final recipient readback evidence, and catalog-version matching.
- A review-only row proposal with quarantined duplicate source rows and no source mutations.
- A SQLite call ledger reserved before network access, a stable idempotency key, and read-only resume after acceptance.
- Tests that execute the actual published SDK against a simulated HTTP transport. This verifies our request shape and response handling, not real network delivery or call quality.

## Optional live verification

Live telephone behavior has **not yet been verified**. Keep that statement until a real consenting test is completed and the result saved.

This build only permits a test call to the operator's explicitly configured own India mobile number. The test owner roleplays the fictional uploader. It is not configured for customers, suppliers, existing contacts, bulk calling, or unsolicited outreach.

Before running a live call:

1. Register for a free CALL-E account and obtain an API key through the official dashboard. Check that a free allocation is available and no paid funding is needed. Never purchase credits as part of this demo.
2. Obtain specific consent for the test, including CALL-E processing the conversation and local retention of its transcript. Agree on a time and make clear it is an AI call about fictional data.
3. Keep the API key and own number in environment variables in the local shell. Never commit credentials, real numbers, ledger files or raw transcripts.
4. Run the preview and review its exact questions. Use one stable consent reference for that authorized test.

```bash
# Set CALLE_API_KEY and IMPORT_RESCUE_OWN_NUMBER privately in the shell.
# The following command CAN place a real outbound call. Run only after the steps above.
.venv/bin/python rescue.py call --live --recipient-consented --free-credit-confirmed --consent-id my-consented-test-001
```

Save the printed `intent` and `call_id`. After about 60 seconds, retrieve the result without redialling:

```bash
.venv/bin/python rescue.py resume --intent import-rescue-REPLACE_WITH_SAVED_INTENT_SUFFIX
```

Use the original CSV when resuming. Changed files produce a version mismatch rather than applying an old conversation to new data. A terminal failure is not an answer. An API timeout after create is an unknown state: inspect the provider dashboard and the ledger, do not run create again under a new consent reference.

The free-credit flag is an operator assertion, not a balance API check. The SDK exposes no enforced duration or single-attempt parameter in the inspected create contract. The prompt asks for one attempt under two minutes; that is not a provider-level guarantee. Confirm account controls and destination support before testing. There are no purchase, recharge, retry scheduler, or recurring call paths here.

## Cancellation, privacy and limits

Before sending, stopping the command cancels the local preparation. After CALL-E accepts a task, closing this app does not cancel it. The inspected SDK does not expose a cancellation operation; use the provider's available dashboard/support controls and do not promise programmatic cancellation. The recipient can decline and the task instructs the agent to end the call. Actual compliance needs live verification.

The provider receives fixed questions, counts, a dataset hash and the test phone number. CSV cell contents stay local. The local ledger stores call results and transcripts, may contain personal data, and uses file mode 0600. Its directory is ignored by git. Delete `private/` after the agreed test retention period; provider-side retention is governed separately by CALL-E's terms. Do not publish unredacted transcripts, phone numbers, credentials, or another person's voice.

Quote matching checks provenance, not meaning. It cannot prove identity, consent, semantic correctness, absence of every contradiction, or whether the speaker owns the file. A human must read the full transcript and check each proposed setting. The app has no write-through operation. Tax basis is a factual label supplied by the uploader, not tax advice or a computed tax rate. No medical, emergency, legal, financial advisory, collections or payment-authority workflows are supported.

Only the documented four-column CSV format is supported. A two-minute call target, better completion rate, reduced handling time, multilingual quality, real extraction accuracy, provider cancellation, and end-to-end telephone operation have not been measured. The UI is a local fixture demo, not a deployed live calling service.

## Sources and license

- [Official Python SDK](https://github.com/CALLE-AI/server-sdk-python), inspected source and installed version 0.7.0.
- [CALL-E call contract](https://docs.heycall-e.com/api-reference/calls).
- [Integration guide and destination table](https://github.com/CALLE-AI/call-e-integrations).
- [Contribution destination](https://github.com/CALLE-AI/awesome-phone-call-agents), proposed area `apps/python/import-rescue/`.

Original application code is offered under the MIT license in `LICENSE`. Third-party packages retain their own licenses. No upstream application implementation was copied.
