# SpareScout

SpareScout is an approval-gated, multi-supplier vehicle-part sourcing app. It uses CALL-E to contact authorized parts businesses, verify fitment, and normalize price, availability, condition, delivery, confidence, and evidence into comparable quotes.

The default workflow is a deterministic fixture. It does not dial a number. Live calling remains unavailable until the trusted server is explicitly configured and a user approves the exact signed plan.

## Why phone calls

Independent parts businesses often hold current inventory that is absent or stale online. A buyer otherwise repeats the same vehicle, chassis, budget, and delivery details across several calls and must reconcile inconsistent answers manually.

## Workflow

1. Enter the vehicle, part, fitment reference, budget, delivery location, market, and call language.
2. Review the exact information-only call task and masked recipients.
3. For live mode, authenticate as the operator; the server checks every recipient against its private allowlist.
4. Attest direct recipient consent, record the authorized calling window, and explicitly approve the 15-minute sourcing plan.
5. Run the fixture or let the trusted server create one idempotent CALL-E batch.
6. Monitor only that existing run and persist every canonical status.
7. Compare structured supplier results with evidence and incomplete-data warnings.
8. Reopen the masked audit record from the browser-authorized History page.

Selecting an offer never purchases, pays for, or reserves a part.

## Safe local demo

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`, leave **Safe fixture** selected, review the call plan, and approve the demo calls. Fixture recipients and outcomes are fictional; no CALL-E credential is required.

Run the complete verification suite:

```bash
npm run check
```

## Live configuration

Live mode is opt-in and server-only. Copy `.env.example` into the trusted runtime configuration and set:

| Variable | Purpose |
| --- | --- |
| `CALLE_MODE=live` | Enables the live adapter. Fixture plans remain fixtures. |
| `CALLE_API_KEY` | CALL-E server API credential. Never expose it to browser code. |
| `SPARESCOUT_APPROVAL_SECRET` | HMAC secret for signed call-approval plans. |
| `SPARESCOUT_OPERATOR_TOKEN` | High-entropy bearer credential required by both live endpoints. |
| `SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST` | Comma-separated E.164 recipients verified and approved outside the public app. |
| `CALLE_WEBHOOK_URL` | Optional terminal webhook destination supplied to CALL-E. |

The live selector stays disabled unless every trusted binding is present. A live plan must still be valid, unexpired, submitted by the authenticated operator with `approved: true`, and contain only recipients on the server allowlist.

## Real-world side effects

- `POST /api/calls/plan` validates and saves a preview; it never starts a call.
- `POST /api/calls/execute` can place outbound calls only for an explicitly approved live plan.
- Both live endpoints require operator authentication and independently enforce the exact server-side recipient allowlist. A self-attested consent boolean is insufficient.
- Browser approval data contains no supplier phone values. Execution reloads the authoritative plan from private D1 storage.
- Live plans are rejected unless direct recipient consent and an authorized calling window are stored with the request; the server checks both again before SDK execution.
- Credential-bearing SDK traffic is pinned to the official HTTPS CALL-E origin; custom production origins are rejected.
- One approved plan targets its listed business numbers once using a stable provider idempotency key.
- `GET /api/calls/status/:requestId/:callId` requires the request history credential and retrieves only an existing run. It cannot dial again.
- The app creates no recurring jobs and has no payment, purchase, or reservation capability.
- Once CALL-E accepts a batch, this prototype has no cancellation control. Use live mode only with consenting businesses and an approved test window.
- Ambiguous network outcomes are reconciled through status retrieval; they are never retried as a new call.

## Credential, phone, and data handling

- CALL-E credentials and full supplier numbers stay in the trusted server runtime.
- Plans and history mask supplier numbers, while browser approval data removes phone values entirely.
- Each request receives a random history credential; D1 stores only its SHA-256 hash.
- The credential can permanently delete its matching request and related durable records; remaining sourcing data is pruned after 30 days.
- CALL-E summaries, evidence, and structured values are treated as untrusted external data.
- Do not enter payment data, medical information, unrelated personal data, or unauthorized contacts.

## Structured result

Every recipient is normalized against a strict schema covering:

- part found and compatibility status;
- brand, condition, price, currency, and quantity;
- delivery availability and ETA;
- whether a reservation could be requested later;
- evidence and notes.

Missing or contradictory values remain incomplete instead of being inferred. Fixture records are excluded from pilot metrics.

## Stack and compatibility

- TypeScript, React 19, vinext, Vite, and Cloudflare Workers-compatible ESM
- Official `@call-e/calle` TypeScript SDK
- Cloudflare D1 with generated Drizzle migrations
- CALL-E recipient-region and language matrix versioned in `lib/markets.ts`

See `docs/call-e-integration.md` for the provider boundary and `tests/` for the no-call fixture, authorization, idempotency, polling, localization, rendering, and pilot-metric checks.
