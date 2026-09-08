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

Open **http://localhost:3000/demo**. Allow tracking, browse Pricing / FAQ, then **Talk to sales** or **Get Demo**. Use a reserved number such as `+15550192831`. Then open the dashboard at **http://localhost:3000/app/home**.

Optional shortcut: **http://localhost:3000/app/settings** → Mock overlay shows a sample leads/calls queue without walking Harbor.

| URL | What |
| --- | --- |
| http://localhost:3000/demo | Harbor site + `<Sundials />` widget (also `/demo/pricing`, `/reviews`, `/faq`, `/contact`) |
| http://localhost:3000/app/home | Analytics (`/` redirects here) |
| http://localhost:3000/app/leads | Inbound queue |
| http://localhost:3000/app/brain | Qualification brief, opening script, retry |
| http://localhost:3000/app/keys | Public SDK key (`hardcoded-sdk-key`) |
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
| Public SDK key `hardcoded-sdk-key` | Built in | Always used by Harbor / SDK. Shown on `/app/keys`. Account: `harbor`. |
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

Live mode does **not** use a webhook. Status and console poll CALL-E `GET /v1/calls/{id}`. That same poll fires at most one host-side retry when `retryDueAt` is due (Brain `retryDelayHours`, default 1 hour). Dry-run advances on read and still persists a queued retry. No seed data. Settings can overlay mock analytics and a curated leads/calls queue (`lib/console/fixtures/`) without writing SQLite.

`/app/brain` is the qualification brief, not a voice studio. Paste a website (`/demo` uses the Harbor fixture and does not fetch the network) or upload a text file. Brain scrapes company copy and drafts a report. Edit the report in place or ask Copilot. Call policy covers retry delay and the opening script. Agent voice, tone, and manner are not configured here.

---

## SDK

Production install is one React component after `npm install`. That component calls `init()`, which starts tracking. The business does not install shadcn or Tailwind for the widget.

```tsx
import { Sundials } from "@sundials/sdk";

<Sundials apiKey="pk_live_…" accountId="acme" />
```

That drop-in is the full embed: fixed top consent bar, floating launcher (default bottom-right), and the contact modal. In this repo the same component is imported from `@/lib/sdk`.

```tsx
<Sundials
  accountId="harbor"
  apiKey="hardcoded-sdk-key"
  brandName="Harbor"
  position="bottom-right"
  primaryAction="talk_to_sales"
/>
```

Optional:

- `position="bottom-left"` — move the launcher
- `showLauncher={false}` — hide the floating card and use your own buttons
- `<SundialButton />` — put a trigger wherever you want; it opens the same modal
- `useSundial().scheduleCall(...)` — headless dispatch (alias of `dispatchCall`) for a page you design yourself, like Harbor `/demo/contact`

Existing site buttons stay yours. Mark them to **track** or to **open the widget**:

```html
<a href="/pricing" data-sc-cta="learn_more">Learn more</a>
<button type="button" data-sc-cta="talk_to_sales" data-sc-open>Talk to sales</button>
```

`data-sc-cta` only records the click (after Allow). Add `data-sc-open` to intercept the click and open the Sundials modal. Extra `data-sc-*` attributes (for example `data-sc-plan`) are copied onto the event.

`SundialsApi.init()` is enough if you only want the tracker and tagged buttons, with no launcher. Events batch to `POST {apiEndpoint}/events` with header `x-sundials-api-key`. Call dispatch uses the same header. Default `apiEndpoint` is `/api/sundials` on the host that serves the backend.

Identity is the browser `visitorId` in `localStorage` (`sundials_visitor_id`), not email or company. Changing the form email updates that same visitor.

---

## Guardrails

- Masked phone and email in public JSON
- E.164 required (`+` plus an allowlisted country: +1, +44, +49, +61, +65, +81). Unknown codes are rejected, not routed as US
- Emergency / premium destinations blocked
- Dispatch rate limit 5/min/IP; event batches 60/min/IP
- Explicit Allow before page/CTA/hover tracking; Decline still allows Talk to sales
- Explicit consent copy on Talk to sales / Get Demo
- Agent discloses automated assistant; does not recite clickstream or hover time
- No calendar booking, no auto-dial, no fingerprinting
