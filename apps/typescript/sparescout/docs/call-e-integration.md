# CALL-E integration contract

This is the authoritative boundary between SpareScout and CALL-E. It keeps phone activity explicit, idempotent, durable, and separable from later commercial decisions.

## Runtime surface

SpareScout uses `@call-e/calle` from a trusted Cloudflare Worker-compatible server. The authenticated local CALL-E CLI also confirms `plan_call`, `run_call`, and `get_call_run` are available, but application requests use the server SDK rather than exposing agent credentials to the browser.

## Sourcing lifecycle

### 1. Validate the complete request

`parseSourcingRequest` requires vehicle, part, fitment reference, positive budget, currency, delivery location, deadline, a documented CALL-E region/language pair, and one to ten unique E.164 suppliers. A live request additionally requires a direct-recipient-consent attestation and an authorized calling window. Missing values are rejected rather than guessed.

### 2. Construct a bounded task

The task must:

- disclose that the caller is an AI assistant gathering a quote for a buyer;
- ask for fitment, brand, condition, price, quantity, and delivery;
- keep unknown information unknown;
- reject substitute-part acceptance; and
- prohibit reservation, ordering, purchase, payment, or any commitment.

Strict JSON schemas define the aggregate counts and every supplier result.

### 3. Authenticate, authorize, save, and sign the plan

For live mode, `POST /api/calls/plan` first requires a high-entropy operator bearer credential and checks every submitted phone against the exact server-side recipient allowlist. A consent checkbox alone grants no authority. The route then stores the authoritative request and supplier targets in D1.

The signed browser approval expires after 15 minutes and replaces every supplier phone with `[server-held]` before encoding. The browser therefore cannot recover full numbers from the approval data. Editing any signed field invalidates the signature.

No external call starts in this step.

### 4. Record approval before execution

`POST /api/calls/execute` requires `approved: true` and a valid approval. For live mode it independently authenticates the operator, reloads the authoritative plan from D1, and repeats the server allowlist check before recording approval. The approval record is written before the provider request so an uncertain network outcome still has an audit trail.

### 5. Execute exactly once

Fixture plans always use the local fixture adapter, even if the server later switches to live mode. Live plans require `CALLE_MODE=live`, `CALLE_API_KEY`, a production approval secret, operator authentication, an exact recipient allowlist, direct-recipient consent, and an authorized calling window. Consent is persisted with the server-held request and checked again immediately before SDK execution.

The browser reads `GET /api/calls/capabilities` before enabling its live-pilot selector. That endpoint requires every trusted live binding, including the operator token and a non-empty valid recipient allowlist; partial configuration remains fixture-only. This presentation gate supplements the endpoint authentication and authorization checks rather than replacing them.

The plan route applies the same capability check before signing or saving a live request. An unauthenticated or unauthorized direct API request therefore cannot persist real supplier targets, even though fixture planning remains available.

The server does not accept a production `CALLE_BASE_URL` override. Credential-bearing SDK traffic is pinned to the official HTTPS CALL-E origin; only loopback hosts are accepted by the adapter for isolated fake-server tests.

The CALL-E idempotency key is derived from the approval fingerprint. Retrying the same authorized plan therefore targets the same provider task instead of creating another batch.

### 6. Monitor without dialing again

Queued or in-progress runs use `GET /api/calls/status/:requestId/:callId`. The route requires the same request-specific history credential, verifies its hash and that the call belongs to a saved live request, then invokes only `client.calls.get`. It persists each canonical status update and cannot create a call. Reopening Request History repeats this GET-only refresh for a non-terminal live run, so closing the original browser flow does not strand the durable record.

Terminal statuses are `completed`, `failed`, or `canceled`. Failures remain visible and never become quotes.

### 7. Preserve comparable evidence

Each supplier result stores:

```json
{
  "part_found": true,
  "compatibility": "confirmed",
  "brand": "SKF",
  "condition": "new",
  "price_amount": 6500,
  "currency": "KES",
  "available_quantity": 2,
  "delivery_available": "yes",
  "delivery_eta": "today before 5pm",
  "reservation_possible": "yes",
  "evidence": ["Seller confirmed the requested fitment reference."],
  "notes": "Quote valid while stock lasts."
}
```

Unknown or missing values remain incomplete. The comparison view marks anything without confirmed compatibility for manual review.

## Reservation boundary

A sourcing approval never authorizes a reservation. The current product stops at a separate reservation preview. A future reservation implementation must create and sign a second plan limited to the selected supplier, exact part, displayed price, and permitted hold window.

That call must not authorize payment, accept a substitute, accept a changed price, or agree to a new fee. Any changed term returns control to the user.

## Persistence

D1 stores sourcing requests, supplier targets, call approvals, call runs, supplier quotes, and idempotent webhook-event slots. History returns masked numbers and requires a random, request-specific bearer credential; D1 stores only its SHA-256 hash. The originating browser remembers that credential locally so it can reopen the authoritative server record. Pilot metrics include only `mode = 'live'` runs and explicitly report the fixture count they excluded.

## Verification boundary

The automated suite proves validation, operator authentication, exact-recipient authorization, phone-free browser approvals, signature tamper/expiry rejection, official-origin pinning, safe fixture behavior, real SDK request construction, idempotency headers, read-only polling, supported-market configuration, page rendering, and denominator-honest pilot calculations.

It does not prove live call audio, supplier consent, real-world fitment accuracy, or pilot impact. Those require the separately approved consenting pilot.
