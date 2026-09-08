# Surplus Switchboard

A recipient-capacity inquiry and exact allocation demo for CALL-E phone-call workflows. A human reviews the returned statement, identity and timestamp before the planner uses a recipient's capacity. The planner maximizes proposed portions, then minimizes portion-minutes under the supplied category, shared-capacity, freshness and arrival constraints.

**Live CALL-E create/read validation is pending.** The working local tests use fake providers. The local browser demo is a simulation and has no live-call endpoint. This is a focused reference app, not a CALL-E SDK or production dispatch service.

## Try without an account

Python 3.10 or later; no packages are required for this app.

```sh
cd apps/python/surplus-switchboard
python -m unittest discover -s tests -v
python app.py
# Open http://127.0.0.1:8791
```

The default sample is fictional. Its exact allocation proposes twelve portions where its nearest-first baseline proposes six. This constructed example is not a measured field improvement. `index.html` also displays the bundled result when opened directly; recomputation needs the local server.

```sh
python optimizer.py sample.json --output result.json
python workflow.py demo --approve-fixture --output fictional-handoff.json
```

The second command explicitly approves an invented fixture for a no-call demonstration; it is separate from the actual provider-result import path. Output commands require a new destination where documented. None of these commands sends a phone call or reserves food.

Optional UI regression checks use an existing Playwright installation and browser; neither is required by the Python app. With `app.py` running, run `node tests/browser_regression.cjs http://127.0.0.1:8791 evidence/browser`. `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` can select already-installed runtimes. The script accepts only a loopback address and writes fictional screenshots, a downloaded result and a test receipt to the chosen output directory.

## Preview and opt-in provider verification

Only use an operator-owned test number or a recipient who explicitly approved this exact automated capacity inquiry. First confirm the account's authorized test allowance and cost limits. The app's live path currently uses the REST API and `CALLE_API_KEY`; CALL-E CLI/MCP login alone does not configure this transport. [CALL_E_CONTRACT.md](CALL_E_CONTRACT.md) records the checked API contract and remaining live validation.

Create a private context from the fixture with a real permission reference, an authorized E.164 destination, an approved time window and matching partner/batch/category. The checked-in timestamps and reserved fictional number are deliberately unsuitable for a real call.

```sh
python calls.py real-context.json --output private-preview.json
```

Inspect the complete private destination, disclosure/task, permission, UTC window and preview digest. The console masks the destination; the private preview intentionally contains it. Set credentials privately in `CALLE_API_KEY`; never add them to source control.

The following separate, explicit command can create a real outbound call and must only be used after specific approval:

```sh
python calls.py real-context.json --allow-live-call \
  --acknowledge-authorization --approve-sha <EXACT_PREVIEW_SHA>
```

Creation is recorded before the side effect. A timeout or ambiguous outcome remains on hold; inspect the provider dashboard and do not redial, change the window to evade protection, or delete the ledger. Read the existing request without another create:

```sh
python calls.py --db calls.sqlite3 --read-request-sha <REQUEST_SHA> \
  --max-reads 6 --interval 5 --output provider-result.json
```

Reads are bounded to 1–12 requests separated by 5–10 seconds; a read limit is not a call deadline or cancellation. Queued/in-progress null completion values remain pending. Completed, failed and canceled evidence is retained with its original retrieval time; failed/canceled outcomes stop polling and remain on hold. Unknown future statuses cannot confirm capacity.

## Human review and planning

Inspect the actual provider evidence for identity, affirmative quantity, exact supporting quote and the real confirmation time. A transcript substring cannot establish semantic truth, recipient identity, food safety or a reservation.

```sh
python workflow.py review planning.json provider-result.json --db calls.sqlite3 \
  --confirmed-at <ACTUAL_CONFIRMATION_UTC_EPOCH> --output private-review.json
python workflow.py reconcile planning.json provider-result.json --db calls.sqlite3 \
  --confirmed-at <ACTUAL_CONFIRMATION_UTC_EPOCH> \
  --approve-review-sha <EXACT_REVIEW_SHA> --acknowledge-evidence-review \
  --output private-handoff.json
```

The original call request, saved result, exact snapshot and actual confirmation time are bound to the review. Reconciliation checks current system time again, including after a review delay. A single-category inquiry only enables that category. Changed evidence, stale confirmations, unclear outcomes and multiple call attempts cannot silently authorize capacity. Unknown transcript speakers remain in the evidence but cannot supply the recipient's confirming quote. Extraction uses integer capacity with zero for unknown/refusal; local validation requires an affirmed positive quantity within the offered amount.

## Side effects, cancellation and boundaries

- Local tests, previews and the browser demo place no calls. Live creation is opt-in and discloses the caller as an AI assistant.
- No recurrence, background scheduler or automatic redial is created. The app has no provider cancellation endpoint. Use official dashboard/support controls if available; stopping this process does not cancel a call already accepted by the provider.
- Calls ask only about capacity. They make no purchase, pickup, delivery, donation, reservation, refund or safety promise. Refusal, voicemail and uncertain identity remain unresolved; a human decides what to do next.
- Do not use this workflow for emergency requests or medical, legal or financial advice. Refer questions about food safety, allergens, handling or suitability to the responsible human operator.
- The allocator does not model vehicle routes, cold chains or legal compliance. Every proposal requires practical review; no actual food or environmental savings are measured.

## Privacy and source

Do not commit real numbers, consent records, credentials, provider transcripts, SQLite files or private outputs. The local ledger is unencrypted and is bookkeeping, not a signed provider attestation. The HTTP server is a single-operator loopback demo; do not expose it publicly.

The source project is [Bembaby/surplus-switchboard](https://github.com/Bembaby/surplus-switchboard), under the included MIT license. Its tests cover local allocation, HTTP handling, fake-provider orchestration and synthetic API contract cases. These are not live provider evidence. Development used substantial AI assistance.
