# MedRoute — CALL-E Hackathon Entry

MedRoute turns a time-sensitive, phone-bound task into a safe, structured workflow: with an operator's authorization, it calls selected pharmacies to check a medicine's availability, approximate price, same-day pickup readiness, and closing time—then ranks the responses into a clear shortlist for a caregiver or care coordinator.

It deliberately does **not** provide medical advice, share patient details, place orders, or reserve medication. A licensed clinician or pharmacist remains responsible for medicine suitability.

## Why this matters

After a discharge, an unexpected stockout, or a search for a less commonly stocked strength or formulation, a caregiver may need an answer promptly. Pharmacy inventory may be unavailable online or may still require physical confirmation. MedRoute gives care coordinators, family caregivers, and community-health organizations a consent-first way to gather the same factual answers in parallel instead of repeating the same call.

The focused use case is availability coordination—not ordinary price shopping. The included scenario uses an illustrative medicine and fictional contacts to show how a coordinator can create a comparable pickup shortlist without disclosing who needs the medicine.

## CALL-E integration

The live path imports `@call-e/calle`, creates a call with an explicit recipient and schema, then observes CALL-E until its structured result is available. This avoids saving an early provider status before the actual outbound attempt, transcript, and result arrive. The exact task prompt constrains the agent to factual availability checks and requires it to identify itself.

## Run locally

```bash
npm install
python -m pip install -r requirements.txt
npm start
```

Open `http://localhost:3000`. `npm start` loads `.env` and `.env.local`. With a `CALLE_API_KEY` configured, a judge can enter a medicine and an authorized E.164 number, enable live calling, and test the call directly—there is no operator-token screen in local mode. Without a CALL-E key, the same command safely falls back to animated mock results. Use `npm run demo` to force this safe no-call mode even when local credential files exist.

Use **Workspace** to prepare a check, **Results** to compare the latest or saved checks, and **Analytics** to review aggregate activity. Completed checks open Results automatically. The calling-status banner identifies demo previews and live calling. A live request without credentials returns an explicit error and never substitutes simulated results. To place a real call, run the normal server, enable **Live pharmacy calls**, and choose **Start pharmacy calls**.

The call animation follows read-only provider progress and closes when all phone attempts finish, while result extraction can continue in the background. **Continue in background** dismisses the overlay without canceling or resubmitting the request. Once a live request has been dispatched, MedRoute deliberately offers no cancellation or automatic retry: the operator must wait for the recorded provider outcome and begin a new, separately authorized check only when appropriate. A history refresh runs after the call UI is released. After a confirmed hangup, result extraction has a separate 15-second grace period (`MEDROUTE_CALL_FINALIZATION_GRACE_MS`); the transcript and an incomplete-result status are retained if extraction never arrives. Each provider status read times out after 20 seconds. Progress polling uses the original idempotency key and operator ownership; deployments with multiple instances need routing to the instance handling the request for progress updates.

Keep `CALLE_API_KEY` server-side in `.env` or `.env.local`; never expose it in the browser. Local mode uses the visible consent controls and rate limits as the live-test gate. Public deployments must use `MEDROUTE_ENV=production` and OIDC authentication before accepting live-call requests.

Recipients may be in any CALL-E-supported country and must use international E.164 format, such as `+12025550123` or `+254700000001`. By default CALL-E infers routing from the number; deployments may set `MEDROUTE_CALL_LOCALE` and `MEDROUTE_CALL_REGION` when explicit hints are required. The server requires both consent acknowledgements and a stable `Idempotency-Key` header before it will place a live call. The browser creates this key for each deliberate live submission; integrations must retain it when retrying the same request.

The default production safeguards allow 30 checks per minute per operator/IP and enforce a 15-minute per-pharmacy live-call cooldown. A pending live idempotency reservation is never automatically recycled: an administrator must reconcile it before retrying, which prevents a slow worker from placing a duplicate call. The app observes CALL-E completion every 750 ms by default. It does not persist a task-level terminal status with no completed outbound attempt immediately, because CALL-E can attach the attempt, transcript, and structured result shortly afterward. Set `MEDROUTE_CALL_RESULT_POLL_MS` to tune result-detection latency, `MEDROUTE_CALL_RESULT_TIMEOUT_MS` to control the maximum wait, and `MEDROUTE_CALL_INCOMPLETE_RESULT_GRACE_MS` (default: 120000) to control that late-result grace period. These settings do not change the provider's outbound-dial queue. Configure `MEDROUTE_MAX_CHECKS_PER_MINUTE`, `MEDROUTE_LIVE_COOLDOWN_SECONDS`, `MEDROUTE_MAX_TRANSCRIPT_TURNS`, `MEDROUTE_MAX_CONCURRENT_PDF_JOBS`, `MEDROUTE_PDF_TIMEOUT_MS`, `MEDROUTE_MAX_PDF_OUTPUT_BYTES`, and a private, random `MEDROUTE_RECIPIENT_HASH_KEY` of at least 32 characters for the deployment. Idempotency records are persisted with local history, but a multi-instance deployment should use the PostgreSQL/OIDC production mode for transactional cooldown reservations, managed identity, and audit logging. History and analytics return the most recent 100 checks per operator.

## Comparing pharmacy offers

Supply the medicine, strength, dosage form and release type, plus an optional preferred brand. CALL-E asks for up to three explicitly confirmed offers per pharmacy, including pack price, currency, quantity and pricing unit. A brand preference is not a quality rating. Different or unconfirmed product specifications appear under other results for pharmacist review.

Each pharmacy request sends only `recipientResultSchema`. The schema uses CALL-E's documented subset: singular types, object properties and simple arrays. Unknown numeric fields are optional and omitted by the provider, then normalized to `null` locally; the three-offer cap is enforced by local sanitization rather than an unsupported schema keyword. SDK contract tests check the serialized request without dialing. A rejected call shows one failure card, and comparative summaries appear only when at least two pharmacies have eligible offers. The live-mode label alone is never proof a recipient was reached.

The results screen offers **Lowest unit price** and **Nearest available**, brand filtering and a pickup-today filter. Sorting and filtering operate on saved evidence and never place additional calls. Exact prices are divided by confirmed quantities and compared only within the same currency and compatible unit; approximate or ranged quotes, missing quantities and unknown currencies remain visible without a price recommendation. Unknown distance is not treated as zero. The confirmation timestamp describes when the check was saved, not a guarantee that stock or prices remain current.

Records use `schemaVersion: 2` and optional `productRequest`/`result.offers` fields in the existing JSON payload storage. Older records retain their original display; free-text historical prices are not inferred into numeric offers. The API still accepts legacy requests without product details. New product specifications participate in live-call idempotency fingerprints. Transcript downloads remain tied to their original pharmacy even when offers are reordered.

**Best balance** is the default view. Choose equal priorities, 75% price / 25% distance, or 25% price / 75% distance. Within each currency/unit group, exact unit price and distance are each scaled from the lowest to highest among currently eligible offers with both values confirmed. Their weighted sum is displayed as a cost from 0 to 100 (lower is better). Equal values contribute zero, ties are labelled jointly, and an isolated offer is not presented as beating competitors. Filters change the comparison set and may change the score. This expresses price/distance preference, not clinical quality or travel cost. Missing price or distance excludes an offer from balance ranking while retaining it for review. Liquid and cream quotes require confirmed mL/g quantities; unsupported pricing units remain unranked by price.

The caregiver decision summary highlights best balance and lowest confirmed unit price within each currency/unit group, plus the nearest eligible offers across groups. It applies the current brand and pickup filters, preserves ties, and links directly to each offer in the comparison table. A brand-match card appears when a brand is selected. Missing evidence produces an explicit empty state rather than an invented winner. These are purchasing-convenience comparisons; a pharmacist confirms medicine suitability.

Enter an optional **Requested purchase quantity** before checking: whole tablets/capsules, mL of syrup/suspension, or grams of cream. This is a purchase quantity, not a dosage recommendation. CALL-E then asks for explicitly confirmed purchase terms (`purchaseMode`) and units available (`availableQuantity`). Whole packs use `ceil(requestedQuantity / quantity) × price`, showing packs to buy and extra units. Individual sales use proportional pricing only when explicitly confirmed. Unknown terms, approximate prices and unusable quantities produce no estimated total. Confirmed stock must cover the actual purchase, including extra units from whole packs; insufficient or unconfirmed quantities remain in the review section and receive no recommendation.

With a requested quantity, **Best balance** uses estimated purchase totals instead of unit prices, and the decision summary highlights **Lowest estimated total**. Unit prices remain visible and independently sortable. An optional maximum budget filters total estimates in one explicitly selected currency without conversion. The filter includes its exact boundary; other currencies, over-budget quotes and uncertain evidence stay visible for review. Totals exclude travel and unquoted fees. Budget changes are local to the results view and place no calls. The requested quantity is saved with the product request and included in live-call idempotency; older records without it retain unit-price comparison.

## Production deployment

Set `MEDROUTE_ENV=production` to require PostgreSQL and OpenID Connect. In this mode the service will refuse to start unless `DATABASE_URL`, `MEDROUTE_OIDC_ISSUER`, `MEDROUTE_OIDC_AUDIENCE`, `MEDROUTE_OIDC_JWKS_URL`, and a private `MEDROUTE_RECIPIENT_HASH_KEY` of at least 32 characters are configured. PostgreSQL stores completed runs, idempotency reservations, pharmacy cooldowns, and an audit trail. OIDC access tokens replace the development-only shared operator token; use a provider-managed identity and restrict its audience to this service. Tokens also need `medroute.read` in `scope`, `scp`, or `roles` to read history, analytics, or transcripts, and `medroute.live` to place live calls; the permission names can be changed with `MEDROUTE_OIDC_READ_PERMISSION` and `MEDROUTE_OIDC_LIVE_PERMISSION`. Saved records are private to the token's stable `sub` claim. Existing database rows created before ownership support have no owner and are intentionally excluded until an administrator explicitly migrates them.

If a call starts but its result cannot be persisted, its idempotency reservation is retained with an `unknown` status. Do not release or reuse that key, and do not retry the calls under a new key. An administrator must reconcile the provider's call record with the database and then mark the reservation complete or explicitly release it.

## Judge-accessible demo deployment

The included `Dockerfile` runs MedRoute with all transcript-PDF dependencies. For a public, no-secret safe-demo build, do not set `CALLE_API_KEY`; the app will visibly label itself as safe demo mode and cannot place a phone call.

```bash
docker build -t medroute .
docker run --rm -p 3000:3000 medroute
```

For an authorized live-call environment, store `CALLE_API_KEY` as a server-side secret in the hosting provider. Never put the key in the browser, a command recorded in the demo video, a public repository, or Devpost testing instructions. Use a safe-demo deployment for unrestricted judge exploration and show the authorized live-call path in the public demo video.

Completed live calls preserve CALL-E's returned transcript turns alongside the results. Each live pharmacy result with a transcript has a **Download call transcript PDF** button; the same download remains available when opening the saved result later. The authorized pharmacy list is stored locally in the browser, while completed check history is saved server-side in the local `data/` directory. In development, **Reset demo history** removes only demo records and preserves every live-call record; this control is unavailable in production.

## Safety and privacy

- Use only authorized pharmacy phone numbers in international E.164 format.
- Do not enter patient names, diagnoses, prescription identifiers, payment data, or other personal health information.
- No ordering, holding, payment, or clinical recommendation is permitted.
- Demo numbers are fictional international examples formatted only to exercise the validation path.
- Keep credentials server-side; `.env` is ignored by Git. Phone numbers are masked in responses, saved history, and transcript PDFs.

## Demo script (under 3 minutes)

1. Introduce the specific bottleneck: after a discharge or unexpected stockout, a caregiver or coordinator needs to locate a particular medicine promptly.
2. Show the illustrative medicine, fictional pharmacy shortlist, and explicit authorization gate.
3. Run the safe demo and compare the ranked, schema-shaped results.
4. Show or describe an authorized CALL-E call and its structured result schema.
5. Close on boundaries: no medical advice, no PHI, no purchase, always transparent and consent-based.

## Future extension

The same “call a shortlist, verify facts, return structured evidence” pattern could support inventory exception workflows for hospital networks and public-health supply chains—for example, confirming near-expiry stock before a human-approved redistribution. That is a future application, not a claim of the current pharmacy-availability MVP.

## Submission checklist

- [ ] Replace demo pharmacies with authorized test recipients for the recorded live-call segment.
- [ ] Deploy the Docker image in safe-demo mode and add its public URL to the Devpost testing instructions.
- [ ] Record and publish a demo video shorter than three minutes; target 2:40–2:50.
- [ ] Add this app under `apps/typescript/medroute/` in a fork of `CALLE-AI/awesome-phone-call-agents` and open a PR.
- [ ] Add the PR URL, video, and CALL-E account email to Devpost.
