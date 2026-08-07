# Shopify Cash-on-Delivery Confirmation Gate

A Shopify Flow plugin that decides whether a cash-on-delivery order should be shipped, using a CALL-E
confirmation call as the evidence.

Cash on delivery is the majority payment method across much of South-East Asia, and a well-known
share of COD orders are fake, duplicated, or carry a wrong address. Merchants already pay humans to
phone every order before dispatch. This plugin does that call and — the part that matters — converts
it into a **decision written back onto the order**, so a warehouse can act on a tag instead of
reading a transcript.

**The plugin is the shipping decision gate, not the phone call.**

## What it does

1. A new order arrives via Shopify Flow's *Send HTTP request* action or an `orders/create` webhook.
2. Orders that are not cash on delivery are skipped without contacting anyone.
3. CALL-E places one confirmation call: is this your order, is this address right, when do you want it.
4. The plugin **polls** `GET /v1/calls/{id}` until the call reaches a terminal state.
5. An explicit decision table converts the result into `ship`, `hold` or one retry.
6. The verdict is written back to the order as tags plus a timeline note.

## Files

- `src/decision.mjs` — pure decision core. No I/O, so the ship/hold rules are testable and auditable.
- `src/calle.mjs` — CALL-E client: create, poll to terminal, ambiguity handling.
- `src/shopify.mjs` — Admin API client and webhook HMAC verification.
- `src/gate.mjs` — orchestration: order in, verdict out, writeback.
- `src/cli.mjs` — `preview` (no call, no credentials) and `run`.
- `src/server.mjs` — webhook receiver for Shopify Flow and `orders/create`.
- `test/fake-calle-server.mjs` — local fake CALL-E covering every decision branch.
- `test/fake-shopify-server.mjs` — local fake Shopify Admin API that records writebacks.
- `examples/order-cod.json`, `examples/order-prepaid.json` — sample orders with fictional reserved numbers.

## Try it without placing a call

No credentials required. This prints the exact call script, the masked phone number and the
idempotency key, and contacts nobody:

```bash
cd plugins/shopify-flow-cod-confirm
node src/cli.mjs preview --order examples/order-cod.json --merchant "Demo Store"
```

Run the full decision table against the local fake CALL-E and fake Shopify servers:

```bash
npm test
```

The suite covers every branch: confirmed, address corrected, address wrong with no correction, not
confirmed, cancellation, null structured result, no answer with retry, ambiguous creation,
idempotency replay, poll-to-terminal, poll timeout, non-COD skip, and a non-E.164 phone number.

## Live use

```bash
export CALL_E_API_KEY=...            # required
export SHOPIFY_SHOP_DOMAIN=my-store.myshopify.com
export SHOPIFY_ACCESS_TOKEN=...      # optional; without it the verdict is not written back
export SHOPIFY_WEBHOOK_SECRET=...    # required in production, see Safety
npm run serve
```

Then point a Shopify Flow *Send HTTP request* action, or an `orders/create` webhook, at
`POST /webhooks/orders-create`.

The server answers Shopify immediately with `202` and a poll URL, because Shopify's webhook budget is
about five seconds and a timeout triggers a retry. The gate then runs in the background; poll
`GET /runs/{key}` for the verdict, or `GET /health` for liveness.

## Inputs

| Input | Source | Required | Notes |
| --- | --- | --- | --- |
| Order | Webhook body | yes | Standard Shopify order payload |
| Shop domain | `X-Shopify-Shop-Domain` header or `SHOPIFY_SHOP_DOMAIN` | yes | Part of the idempotency key |
| Customer phone | `shipping_address.phone`, then `customer.phone`, then `phone` | yes | Must be E.164 |
| Merchant name | `MERCHANT_NAME` | no | Spoken at the start of the call |

## Outputs

The gate returns a verdict object and writes it to the order.

| Decision | Meaning | Tags written |
| --- | --- | --- |
| `ship` | Customer confirmed the order, address usable | `cod-gate`, `cod-confirmed`, `cod-ship` |
| `hold` | Do not dispatch; the reason is in the tag and note | `cod-gate`, `cod-hold`, `cod-hold-<reason>` |
| `skip` | Not a cash-on-delivery order; nobody was called | none |

An address correction adds `cod-address-corrected` and records the corrected address in the note.

The CLI also exits with a code so it can gate a shell step: `0` ship, `3` hold, `4` skip, `1` error.

## The decision table

| Call outcome | Decision | Why |
| --- | --- | --- |
| Confirmed, address correct | `ship` | — |
| Confirmed, address wrong, correction captured | `ship` | Corrected address is recorded on the order |
| Confirmed, address wrong, no correction | `hold` | Shipping now means shipping to a known-bad address |
| Not confirmed | `hold` | — |
| Cancellation requested | `hold` | Beats any confirmation in the same result |
| Answered, `structured_result` is null | `hold` | The call connected but produced nothing usable. This is a real state and is never read as a confirmation |
| No answer, busy, voicemail, first attempt | one retry | CALL-E does not bill unanswered calls or failed routes |
| No answer on the final attempt | `hold` | — |
| Call never reaches a terminal state | `hold` | — |
| Ambiguous creation | `hold` | The call may exist; the order is held and the idempotency key preserved for reconciliation |
| Phone number not E.164 | `hold` | No call is placed |

## Safety

- **Consent and identity.** The script asks whether it is speaking to the named customer *before*
  disclosing any order contents, so a wrong number learns nothing about the order.
- **Non-overridable boundaries.** A fixed instruction prohibiting medical, legal, financial and
  emergency advice, and forbidding payment capture, is prepended to every task.
- **Idempotency.** The key is derived from shop domain, order id and attempt number, so a Shopify
  webhook retry cannot place a second call to a real customer.
- **Ambiguity is never resolved by dialling again.** A network failure mid-create, a `5xx`, a `429`,
  or a `2xx` with no call id are all reported as ambiguous. The order is held and the key preserved
  so the same key can be replayed for reconciliation.
- **Signature verification.** The webhook HMAC is verified before a call can be created. Without it,
  anyone who learns the endpoint URL could make the gate phone arbitrary numbers. The server warns
  loudly when `SHOPIFY_WEBHOOK_SECRET` is unset.
- **Phone masking.** Numbers are masked in logs, previews, run status responses, and the order note.
- **No recurring schedules.** One order, at most two attempts.
- **Sample data.** The example orders use fictional reserved numbers in the `+1500555xxxx` range.

### Cancellation and rollback

Disable the Shopify Flow action or the `orders/create` webhook, or rotate `CALL_E_API_KEY`, to
prevent new calls. A call already accepted by CALL-E cannot be cancelled through this plugin; use
CALL-E's own dashboard or API controls. Removing `SHOPIFY_ACCESS_TOKEN` stops writeback while
leaving the decision path intact.

## Notes on CALL-E behaviour

- **This plugin polls and does not use `webhook_url`.** The field is accepted on call creation, but
  no webhook was delivered for a completed call in field testing, so polling is the only reliable
  completion signal.
- **There is no audio recording field in the API.** `transcript_turns` is available; a recording URL
  is not.
- **Unanswered calls and failed routes are not billed**, which is what makes the single retry cheap.
