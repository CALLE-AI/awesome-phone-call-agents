# Google Play Review Notes (Monetization)

- Demo mode uses mock billing provider; UI shows DEMO indicator.
- Play Billing integration stubbed behind `BILLING_LIVE_PROVIDERS=true`.
- Free tier includes safety, privacy, offline work, and dry-run calling.
- Paid tiers disclose call credits, seats, and feature lists from server catalog.
- Restore purchases flow present; server re-verifies all tokens.
