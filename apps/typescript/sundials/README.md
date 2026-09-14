# Sundials — Call while your lead is warm

> An agentic toolchain — embeddable SDK, backend, and dashboard — that reads inbound intent, places a high-quality discovery call while the lead is still hot, and ranks who sales should talk to next.

No Docker. No hosted URL. **Without a `.env` file, nothing places a real call and Gemini does not run** — the app uses a built-in dry-run fixture and heuristic Brain drafts. For the full experience, copy `.env.example` and add your CALL-E and Gemini keys (see below).

---

## Run locally

**Need:** Node.js **22.13+** and npm.

### Recommended (full experience)

```bash
cd apps/typescript/sundials
npm install
cp .env.example .env
# Edit .env: set CALLE_API_KEY, CALLE_LIVE=true, and GEMINI_API_KEY
npm run dev
```

| With keys | What you get |
| --- | --- |
| `CALLE_API_KEY` + `CALLE_LIVE=true` | Real outbound CALL-E discovery call |
| `GEMINI_API_KEY` | Post-call sales briefing on the lead dossier; richer Brain ingest and Copilot |

Both keys are server-side only. Never commit `.env`.

### Minimal (no `.env`, judges only)

```bash
cd apps/typescript/sundials
npm install
npm run dev
```

Logic-gated fallbacks only:

- **CALL-E:** `dryRun: true`. Status polling advances a **fixture** call with a canned transcript and opportunity profile (`lib/calle/fixture.ts`). No network call to CALL-E.
- **Gemini:** skipped. Brain still works from Harbor fixture text and short Copilot commands; no LLM drafts or post-call briefing.

Open **http://localhost:3000/login** (Harbor demo: username `harbor`, password `harbor`). Generate an SDK key on **http://localhost:3000/app/keys**, then open **http://localhost:3000/demo**. Harbor `/demo` auto-injects that key for the bundled demo site only — on your own site you pass `apiKey` yourself (snippets on `/app/keys`). Allow tracking, browse Pricing / FAQ, then **Talk to sales** or **Get Demo**. Use a reserved number such as `+15550192831`. Then open the dashboard at **http://localhost:3000/app/home**.

Optional shortcut: **http://localhost:3000/app/settings** → Mock overlay shows a sample leads/calls queue without walking Harbor.

| URL | What |
| --- | --- |
| http://localhost:3000/login | Dashboard sign-in (seeded Harbor: `harbor` / `harbor`) |
| http://localhost:3000/signup | Create another company account |
| http://localhost:3000/demo | Harbor site + `<Sundials />` widget (also `/demo/pricing`, `/reviews`, `/faq`, `/contact`) |
| http://localhost:3000/app/home | Analytics (`/` redirects here; requires sign-in) |
| http://localhost:3000/app/leads | Inbound queue |
| http://localhost:3000/app/brain | Qualification brief, opening/closing script (retry locked) |
| http://localhost:3000/app/keys | Generate the account SDK key |
| http://localhost:3000/app/settings | Live SQLite vs mock overlay |

`npm test` runs unit tests then a production build. `npm run test:unit` is tests only.

---

## Environment and keys

Copy the template, then restart `npm run dev` after edits:

```bash
cp .env.example .env
```

| Variable | Required? | What happens without it |
| --- | --- | --- |
| *(no `.env`)* | OK for smoke test | Dry-run fixture call + heuristic Brain only |
| `CALLE_API_KEY` + `CALLE_LIVE=true` | **Recommended** | Stays dry-run. A key alone is **not** enough — `CALLE_LIVE` must be `true`. |
| `GEMINI_API_KEY` | **Recommended** | No post-call briefing; Brain ingest/Copilot use heuristics |
| `SUNDIALS_HARBOR_PASSWORD` | Optional | Default `harbor` for the seeded Harbor dashboard user |
| `SUNDIALS_SESSION_SECRET` | Optional | Signs the dashboard cookie. Dev default is documented in code; set in production |
| Public SDK key | Generated | Not in git. Sign in → `/app/keys` → **Generate key**, then paste into your embed (`apiKey` / `data-sundials-key`). Harbor `/demo` auto-reads Harbor’s key from SQLite for the bundled demo only. Unknown keys are rejected. |
| `CALLE_BASE_URL` | Optional | Default `https://api.heycall-e.com` |
| `CALLE_AGENT_ID` | Optional | Default `sundial_default` |
| `SUNDIALS_DB_PATH` | Optional | Default `./data/sundials.db` (auto-created) |
| `NEXT_PUBLIC_APP_URL` | Optional | Default `http://localhost:3000` |

Recommended `.env` for reviewers who want live CALL-E + Gemini:

```env
CALLE_API_KEY=your_calle_api_key_here
CALLE_LIVE=true
CALLE_BASE_URL=https://api.heycall-e.com
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## ⚡ Why Sundials? (The Speed-to-Lead Moat)

- **21x Conversion Boost**: Data from the seminal _Lead Response Management Study (Harvard Business Review)_ demonstrates that calling a warm inbound lead within **5 minutes** makes them **21x more likely to qualify** compared to waiting 30 minutes.
- **Zero Form Fatigue**: Every additional field on a web form drops conversion by **10–25%**. Sundials replaces grueling 10-field demo forms with a 1-tap phone callback button.
- **Behavioral Context Injection**: The voice AI doesn't make a generic cold pitch. It automatically knows which pricing tier the user configured, how many seats they selected, and which compliance checkboxes they lingered on.

---

## Loop

```text
OBSERVE  page views, Get Demo / Learn more / Talk to sales
    →
IDENTIFY visitor_id then email / phone / company
    →
ENGAGE   explicit form + consent (never auto-dial)
    →
UNDERSTAND  CALL-E discovery from interest themes, not page-hit counts
    →
SCORE    intent + opportunity profile
    →
PRIORITIZE  dashboard queue
    →
ANALYTICS  Improve call objective and webpage with data
```

Live mode can take a CALL-E webhook as a **ping only**. `POST /api/sundials/webhook` ignores `transcript`, `recordingUrl`, `extractedIntelligence`, and status from the body. If `callId` (or `id`) matches a known `calleCallId`, Sundials re-fetches `GET /v1/calls/{id}` with the server key and runs the same snapshot mapper as status/console polling. Unknown ids return 404; a failed CALL-E verify returns 401. Failed and no-speech outcomes are treated as ambiguous: the call is marked for reconciliation and **no automatic follow-up is scheduled** (Brain retry delay is locked for this hackathon demo). No seed call data. Settings can overlay mock analytics and a curated leads/calls queue (`lib/console/fixtures/`) without writing SQLite.

`/app/brain` is the qualification brief, not a voice studio. Paste a website (`/demo` uses the Harbor fixture and does not fetch the network) or upload a text file. Brain scrapes company copy and drafts a report. Edit the report in place or ask Copilot. Call policy covers the opening and closing scripts. Failed-call retry is locked for the hackathon. Agent voice, tone, and manner are not configured here.

---

## SDK

Production install is one React component after `npm install`. That component calls `init()`, which starts tracking. The business does not install shadcn or Tailwind for the widget.

```tsx
import { Sundials } from "@sundials/sdk";

<Sundials apiKey="pk_live_…" accountId="acme" />
```

That drop-in is the full embed: fixed top consent bar, floating launcher (default bottom-right), and the contact modal. In this repo the same component is imported from `@/lib/sdk`.

**Demo vs production:** Harbor `/demo` is a bundled reference site. Its layout reads Harbor’s generated key from SQLite so judges can try the widget without wiring credentials. On your own site, generate a key on `/app/keys` and pass it explicitly — the SDK does not auto-discover keys.

```tsx
<Sundials
  accountId="harbor"
  apiKey="Harbor-…"
  brandName="Harbor"
  position="bottom-right"
  primaryAction="talk_to_sales"
/>
```

Optional:

- `position="bottom-left"` — move the launcher
- `showLauncher={false}` — hide the floating card and use your own buttons
- `<SundialButton />` — put a trigger wherever you want; it opens the same modal
- `useSundial().scheduleCall(...)` — headless dispatch (alias of `dispatchCall`). Prefer `CaptureForm` so the destination-bound checkbox is included. Headless calls still need `callConsent` matching the E.164 or dispatch returns 400

Existing site buttons stay yours. Mark them to **track** or to **open the widget**:

```html
<a href="/pricing" data-sc-cta="learn_more">Learn more</a>
<button type="button" data-sc-cta="talk_to_sales" data-sc-open>Talk to sales</button>
```

`data-sc-cta` only records the click (after Allow). Add `data-sc-open` to intercept the click and open the Sundials modal. Extra `data-sc-*` attributes (for example `data-sc-plan`) are copied onto the event.

`SundialsApi.init()` is enough if you only want the tracker and tagged buttons, with no launcher. Events batch to `POST {apiEndpoint}/events` with header `x-sundials-api-key`. Call dispatch uses the same header. The server looks that key up in the `accounts` table — it must have been generated on `/app/keys`. Default `apiEndpoint` is `/api/sundials` on the host that serves the backend.

Identity is the browser `visitorId` in `localStorage` (`sundials_visitor_id`), not email or company. Changing the form email updates that same visitor.

---

## Guardrails

- Masked phone and email in public JSON
- E.164 required (`+` plus an allowlisted country: +1, +44, +49, +61, +65, +81). Unknown codes are rejected, not routed as US
- Emergency / premium destinations blocked
- Dispatch rate limit 5/min/IP; event batches 60/min/IP
- Explicit Allow before page/CTA/hover tracking; Decline still allows Talk to sales. Tracking consent is session-only and expires after about 5 minutes
- Call consent is a required checkbox on the SDK `CaptureForm`. It names the exact E.164, discloses a recorded automated call now, and that at most one follow-up may occur. For this hackathon demo the follow-up is **locked off**: failed and no-speech provider outcomes stay in the inbox for reconciliation
- Dispatch rejects missing, stale, or mismatched call consent
- Thank-you screen includes Stop the follow-up, which revokes retry consent if a queued retry were present
- Dispatch, events, and stop require a server-issued SDK key (`x-sundials-api-key`) that maps to an account row. The dashboard requires username/password (Harbor seed: `harbor` / `harbor`)
- Webhook is a ping: re-fetch the CALL-E call and apply the snapshot mapper. Body transcript, recording URL, and extracted intelligence are ignored
- Agent discloses automated assistant; does not recite clickstream or hover time
- No calendar booking, no auto-dial, no fingerprinting
