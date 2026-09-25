# Billing Provider Setup

## Current state (demo)

Default: `BILLING_DEMO_MODE=true` → `MockBillingProvider` only.

Mock purchase flow:
1. `billing.startPurchase({ planId })`
2. `billing.verifyPurchase({ planId, receiptToken: "mock_receipt_..." })`

## Future: Apple IAP

- Product IDs in server config
- StoreKit purchase → server verification → entitlement refresh
- No web checkout for digital features inside iOS app

## Future: Google Play Billing

- Play purchase token → server verification
- Same entitlement model as Apple

## Future: Stripe / invoicing

- Web or org admin surface only
- Does not bypass mobile store requirements for consumer digital goods

## Secrets

Never set payment API keys in Expo `app.json` or client env. Server-only.
