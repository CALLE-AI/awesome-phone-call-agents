# CALL-E — Developer Feedback (from building ClaimLine)

This is real, hands-on feedback gathered while building **ClaimLine**, a multi-party
insurance-claims workbench, on the CALL-E TypeScript SDK (`@call-e/calle`), MCP, and webhooks.
It is written to be directly useful to the CALL-E team — every point below is something we hit
in practice, with the workaround we used and a concrete suggestion.

## TL;DR
CALL-E made it genuinely easy to place a real, structured phone call from an app — the
idempotency support, the `result_schema` contract, and the snapshot model are the right
primitives. The issues below are mostly about **schema validation error messaging** and
**docs sharp edges**, not core capability.

---

## 1. `result_schema` rejects nullable/union JSON-Schema types (highest impact)

**What happened.** We sent a perfectly valid JSON Schema where optional fields were nullable
using the standard union form:

```json
{ "type": "object", "properties": { "contact_name": { "type": ["string", "null"] } } }
```

The call **failed at submission** with:

```
result_schema is not supported.
```

The error did not say *which* field or *why*. It took a live-call debugging session to trace it
to the array-valued `type`. Single-value types (`"type": "string"`) work fine.

**Impact.** The call got stuck in a `submission_unknown` state, and because the message was
generic, it was hard to diagnose. Nullable fields are extremely common in real extraction
schemas.

**Suggestions.**
- Accept standard JSON-Schema nullability — either `"type": ["string","null"]` or
  `"nullable": true`.
- If a construct is unsupported, return a **field-level, actionable** error, e.g.
  `result_schema.properties.contact_name.type: array-valued "type" is not supported; use a single type`.
- Document the exact supported subset of JSON Schema for `result_schema` in one place.

**Our workaround.** We use single-type transmit schemas for CALL-E and enforce nullability
locally with a stricter validator after the call.

---

## 2. Idempotency conflict is easy to trigger and hard to recover from

**What happened.** After the failed submit above, retrying the same logical call (same
idempotency key) but with a **corrected** `result_schema` returned HTTP 409:

```
Idempotency key was reused with a different request.
```

This is correct behavior in principle, but the failure mode is painful: a first attempt that
errored *before creating a call* still "burns" the key, so the fixed retry can never succeed
with that key.

**Suggestions.**
- Document that the idempotency key is bound to a **request hash**, and that a changed body
  requires a new key.
- Consider **not** binding the key when the request is rejected at validation time (no call was
  created), so a corrected retry can reuse it.
- Include the conflicting request's id in the 409 body to aid debugging.

**Our workaround.** Our idempotency key is derived from the authorized intent; an explicit
"retry" now derives a fresh key from a monotonic attempt counter, so a corrected re-dial is a
new key while accidental double-clicks still collapse to one call.

---

## 3. Webhooks are unsigned

**What happened.** Terminal webhooks arrive without a signature, so a receiver cannot verify
they genuinely came from CALL-E.

**Suggestion.** Add an HMAC signature header (like Stripe's `Stripe-Signature`) computed over
the raw body with a per-account secret, plus a documented verification recipe.

**Our workaround.** We treat the webhook purely as a **wake signal** and always re-fetch the
authoritative call state from the API before acting on it — never trusting the webhook body.
An optional shared-secret check on our endpoint is the best we can do without signatures.

---

## 4. Docs / naming sharp edges (minor)

- **`result_schema` vs `recipient_result_schema`.** Both exist; it wasn't obvious when to use
  which. A short "single recipient vs. per-recipient result" note would help.
- **camelCase SDK vs snake_case API.** The SDK accepts `resultSchema`/`webhookUrl` but the wire
  format is `result_schema`/`webhook_url`, and responses are snake_case. This is fine once you
  know, but a one-liner in the README would save a round of confusion.
- **Region/locale support.** We wanted an authoritative list of supported `region`/`locale`
  values (we used `en-US`, `hi-IN`, `es-MX`). Publishing the supported matrix would help
  multi-language apps.

---

## 5. What worked really well 👏

- **Idempotency-Key on create** — made a crash-safe dispatcher trivial to build.
- **`result_schema` + structured result** — returning typed, validated data (not just a
  transcript) is exactly what makes "the agent actually did the task" real.
- **The snapshot/get model** — polling `calls.get` for authoritative state was clean and let us
  build a reconciler that never trusts a webhook body.
- **Fixture-friendliness** — the request/response shapes were simple enough to build a faithful
  offline fixture gateway, so our whole workflow (and CI) runs with zero live calls.

---

*Filed by the ClaimLine project. Happy to provide repro requests, call IDs, or a walkthrough.*
