# Monetization Business Model

## Tiers

1. **Community (Free)** — Essential care access, safety, privacy, offline work, dry-run CALL-E.
2. **Professional CHW** — Live call credits, advanced AI briefs, exports, expanded command center.
3. **Clinic / Team** — Seats, org dashboard, premium analytics, workflow automation.
4. **Organization / NGO** — Sponsored CHW access, invoicing-ready (preview / coming soon).
5. **Enterprise Contract** — Manual billing, SSO hooks (preview).

Prices are loaded from the server catalog — not hard-coded in UI.

## Revenue streams

- Individual subscriptions (mobile IAP when live)
- Organization seat + usage contracts
- Call-credit overage (live CALL-E only)
- Future: API/automation entitlements (feature-flagged)

## Unit economics

CALL-E live calls consume **call credits** reserved server-side before dispatch. Dry-run calls are free and unlimited within fair-use meters.

Demo mode uses **synthetic** purchases via `MockBillingProvider` — not production revenue.

## B2B principle

Charge clinics and programs for **software capacity**, not beneficiary access to essential care information.
