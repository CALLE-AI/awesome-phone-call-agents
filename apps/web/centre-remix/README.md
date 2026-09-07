# Centre Remix

SAMPLE leasing board for Harbour Place (fictional shopping centre). Humans and AI agents share the same live page; outbound tenant calls use CALL-E behind a Netlify Function.

- **Live:** https://ornate-pie-10561d.netlify.app
- **Repository:** https://github.com/OCnew-ops/centre-remix
- **License:** MIT

## Phone-call workflow

Tool: `place_tenant_call` (WebMCP + Simulate agent + inspector Confirm UI).

- **Default:** `dry_run: true` → fixture `last_call`, no dial
- **Never auto-dials:** agent stages preview; human must Confirm and call
- **Live (opt-in):** `dry_run: false` + Confirm + `CALLE_API_KEY` in Netlify env (not in git)
- **Simulate agent:** dry-run only (refuses live dial)

Function: `netlify/functions/place-call.js` (CORS, confirm gate, E.164-ish phone check, dry-run fixture, optional live SDK path).

## Setup

1. Open the live URL, or clone `OCnew-ops/centre-remix` and serve the static site.
2. Optional live dials: set Netlify env `CALLE_API_KEY` (secret), uncheck dry-run, Confirm and call.
3. Do not commit API keys.

## Side effects

| Path | Behaviour |
| --- | --- |
| Default / missing key / function unavailable | Fixture `last_call` only — no network dial |
| `dry_run: true` + Confirm | Fixture via Netlify `place-call` or client fallback |
| `dry_run: false` + Confirm + `CALLE_API_KEY` | Live CALL-E outbound (opt-in) |

Cancellation: remix overlays are rejectable; applied remixes undo via `undo_last`. Calls are one-shot (no recurring scheduler).
