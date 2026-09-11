# Centre Remix

SAMPLE leasing board for Harbour Place (fictional shopping centre). Humans and AI agents share the same live page.

The **public** Netlify demo is **honestly fake-only**: the public `place-call` function never places a live CALL-E dial (live SDK path removed). Confirm only gates writing a fixture `last_call` onto the board.

- **Live:** https://ornate-pie-10561d.netlify.app
- **Repository:** https://github.com/OCnew-ops/centre-remix
- **License:** MIT

## Phone-call workflow

Tool: `place_tenant_call` (WebMCP + Simulate agent + inspector Confirm UI).

- Public demo: always fixture / fake-only (never dials)
- Phones: standards-reserved SAMPLE only (`+15550100100`, `+15550100101`, `+61491570006`, `+61491570156`); others rejected
- Responses mask the phone (no full E.164 in JSON)
- Confirm gates the fixture write only — not a real dial

Function: `netlify/functions/place-call.js` (CORS, confirm gate, allowlisted SAMPLE phones, masked fixture responses).

## Setup

1. Open the live URL, or clone `OCnew-ops/centre-remix` and serve the static site.
2. Use SAMPLE phone `+15550100100` in Simulate / inspector Confirm.
3. Do not expect live outbound calls from the public demo URL.

## Side effects

| Path | Behaviour |
| --- | --- |
| Public Netlify function / client fallback | Fixture `last_call` only — no network dial |
| Non-allowlisted phone | 400 / rejected |

Cancellation: remix overlays are rejectable; applied remixes undo via `undo_last`. No recurring scheduler.
