# Monetization Release Audit

## Pre-release checklist

- [ ] `pnpm run billing:health` passes
- [ ] `pnpm run test:billing` passes
- [ ] `pnpm run test:calle` passes (CALL-E + billing gates)
- [ ] UI shows DEMO/synthetic labels when `BILLING_DEMO_MODE=true`
- [ ] No payment secrets in client bundle
- [ ] Always-free features tested on community plan
- [ ] Live call budget gate tested (insufficient credits fail closed)
- [ ] Docs: architecture, ethics, provider setup, store review notes

## Known limitations

- In-memory billing store when DB not connected
- Apple/Google/Stripe adapters not live until `BILLING_LIVE_PROVIDERS=true`
- Organization NGO / enterprise tiers marked coming soon
