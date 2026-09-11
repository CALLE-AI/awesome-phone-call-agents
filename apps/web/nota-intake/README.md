# Nota Intake — bilingual law-firm intake by phone

**The form is four fields. The phone call is the intake.**

A prospective client picks a topic and leaves their name and number on a three-step form (English, Spanish or Bahasa Indonesia). Within a minute,
a CALL-E agent calls them back, runs a structured legal-intake interview in the language their number
supports, and returns a record an intake paralegal can act on: matter type, summary, the other party's
name for the conflict check, deadlines, urgency, best time to reach them, confirmed email, and consent.
The attorney reviews it in a small console and schedules a consultation-reminder call with one click.

Live demo: **https://nota-intake.pages.dev** (form) · `/review` (attorney console, token-protected)

Built for the CALL-E *"Your Code Is Calling"* hackathon by Nota.Lawyer / Derek Soltis.

## Matter types

The client picks a topic — **real estate, will, trust, lawsuit, or something else** — and that choice plans the
call. Each type has its own questions and its own result fields on top of the common intake (`functions/_matters.js`):
a lawsuit intake asks which side they're on, whether court papers arrived and what deadline they state; a will intake
asks about family, an existing will and an executor; real estate asks for the property, their role and a closing date;
a trust asks what it should accomplish and who the beneficiaries are (relationships only, never amounts or health).
Scripts and fields exist in English, Spanish and Bahasa Indonesia. Adding a type is one entry in that file.

## Staff console (`/review`)

Token-gated. Staff can **call a client from the desk** (walk-ins, voicemails, phone leads): name, phone, topic,
language, optional note → a confirmation step → the panel follows the call live until the interview lands.
Records are filterable by topic and status, searchable by name, phone or other party, and each shows the
common fields, the type-specific column, CALL-E's summary and confidence, and the transcript. A date-time picker
places a **consultation reminder call** in the client's language; its outcome (confirmed / can't make it /
reschedule request) syncs back onto the record.

## Demo video

`docs/video/` holds the reproducible pipeline (`build.py`, `cards.py`, `narration.json`). Scene 4 plays the real
lawsuit intake call from Sept 8, 2026, recorded on the client's phone (CALL-E returns transcript turns but no audio);
narration is a voice clone of the author. Records shown in the console are real CALL-E results.

## Why phone, not form

Long intake forms get abandoned, and the people a small firm most wants to reach — older clients,
people on a phone at work, Spanish speakers facing an English-only site — don't fill them out. A short
callback interview meets them where they are and produces *better* structured data than a form, because
the agent can ask one follow-up.

## What CALL-E does at runtime

Every intake and every reminder is a real `POST /v1/calls` from a Cloudflare Pages Function:

| Step | CALL-E feature used |
| --- | --- |
| Callback within a minute of form submit | `POST /v1/calls` with `recipients[{phones, region, locale}]` |
| Interview script in EN or ES, with legal preamble | `task` (see `functions/_intake.js`) |
| Paralegal-ready record | `recipient_result_schema` (JSON Schema, 10 fields) |
| Terminal result pushed to the app | `webhook_url` → `/api/calle-webhook` |
| Authoritative state, transcript, confidence, evidence | `GET /v1/calls/{id}` (`syncIntake`) |
| No duplicate calls on retry | `Idempotency-Key` = intake id |
| Consultation reminder call in the client's language | second `POST /v1/calls` with `REMINDER_SCHEMA` |

## Languages and regions

The interview language is chosen per phone number from CALL-E's published
[Supported Regions and Languages](https://github.com/CALLE-AI/call-e-integrations#supported-regions-and-languages)
table (42 countries, `public/regions.json`). The form shows the caller which languages their number supports.

Verified by live calls (2026-09-04/05):

- **US (+1) numbers: English and Bahasa Indonesia** (`en-US`, `id`). Both ran real intake calls.
- **US numbers reject Spanish** — via REST `locale` (`es`, `es-US`, `es-MX`, even with `region: "MX"`),
  via Spanish task text with `locale: "en-US"` (the planner catches the intent), and via MCP
  `plan_call --language Spanish` (offers "English or Bahasa for US" instead). It's a per-line capability,
  not a validation gap. Spanish interviews currently run for Mexico (local line), Spain and Honduras.
- **Language is locked per call.** In the Bahasa test the bot offered to switch to English when asked and
  then couldn't — STT and TTS run in the call's locale. The form's language choice is binding.

The Spanish script is complete and wired; the day CALL-E enables Spanish on US lines, the only change is one
row in `regions.json`. Adding any language = one row there + one file in `functions/locales/` + one block in `public/i18n.json`.

## Authorization and safety

Every call is a real, billed side effect, so the endpoints that can place one are gated (`functions/_lib.js`):

| Endpoint | Who may call it | Controls |
| --- | --- | --- |
| `POST /api/intake` (public form) | A browser on this site | `Origin` must be the app's own origin (or `ALLOWED_ORIGINS`); explicit consent checkbox; optional `INTAKE_ACCESS_CODE` (open the form as `/?code=...`); 3 submissions per IP per hour; `MAX_CALLS_PER_DAY` cap on the whole deployment |
| `POST /api/intake` with `source: "staff"` | Staff | Same, plus the `x-review-token` header must match `REVIEW_TOKEN` |
| `GET /api/intakes` | Staff | `x-review-token` header (constant-time compare; never accepted in the query string) |
| `POST /api/remind` | Staff | `x-review-token` + `Origin`; the number dialed is the one already on the stored record, never taken from the request |
| `POST /api/calle-webhook` | CALL-E | Must present `WEBHOOK_SECRET` (`?s=` or `x-webhook-secret`); fails closed when unset; the body only identifies the call, and the record is re-fetched from CALL-E with the API key |

Recipient policy on every dial: strict E.164, no emergency or short-code prefixes, and when `ALLOWED_RECIPIENTS`
is set only those numbers can be called (recommended for demos and test deployments).

What leaves the server: the console receives phone numbers masked to country code plus last four (`+1******0100`)
and never receives CALL-E's raw payloads or evidence blobs. The webhook stores only the call id and arrival time.
`CALLE_API_KEY`, `REVIEW_TOKEN` and `WEBHOOK_SECRET` live only as Pages secrets (locally `.dev.vars`) and are never
sent to a browser; the CALL-E key is used exclusively server-to-server from Pages Functions.

Cancellation: the public CALL-E API exposes create and read only (no cancel endpoint), so a call already handed
to CALL-E is stopped from the CALL-E dashboard; provider-side blocklists and kill switches apply. The app never
schedules recurring calls; a reminder is one explicit click per call, and the daily cap bounds the blast radius.

## Architecture

```mermaid
sequenceDiagram
  participant C as Client (browser)
  participant P as Cloudflare Pages + Functions
  participant K as KV (INTAKES)
  participant E as CALL-E
  participant A as Attorney (/review)
  C->>P: POST /api/intake {name, phone, email?, lang, locale, matter?, consent}
  P->>P: regionFor(phone) → region + allowed locales; build interview task
  P->>E: POST /v1/calls (task, recipients, recipient_result_schema, webhook_url, Idempotency-Key)
  E-->>P: {id, status}
  P->>K: put intake record (status: calling)
  E->>C: 📞 intake interview (EN/ES)
  E->>P: POST /api/calle-webhook?s=secret
  P->>E: GET /v1/calls/{id}
  P->>K: update record (result, transcript, confidence, status)
  A->>P: GET /api/intakes  (x-review-token; &sync=1 to poll)
  A->>P: POST /api/remind {id, when}
  P->>E: POST /v1/calls (reminder task, REMINDER_SCHEMA)
```

Everything runs on Cloudflare (Pages, Functions, KV). No servers, no framework, no build step.

## Files

```
public/index.html          form (EN/ES/ID); loads /i18n.json for its strings and /regions.json for the country → language picker
public/i18n.json           form UI strings in English, Spanish and Bahasa Indonesia (data only)
public/review.html         attorney console: records, transcript, confidence, "schedule reminder call"
public/regions.json        CALL-E region/language matrix (generated from the integrations README)
functions/api/intake.js    POST /api/intake  — validate, authorize, pick locale, create the CALL-E call, store record
functions/api/calle-webhook.js  POST — terminal result; authenticated; re-fetches authoritative state from CALL-E
functions/api/intakes.js   GET  /api/intakes — review list (token header), redacted; optional sync of in-flight calls
functions/api/remind.js    POST /api/remind  — reminder call in the client's language
functions/_lib.js          auth, origin, recipient policy, rate limits, masking
functions/_intake.js       assembles the interview task and result schema; reminder task + schema
functions/_matters.js      matter types: icon + result fields; text comes from the locale files
functions/locales/{en,es,id}.js  interview scripts and matter labels per language (data only)
functions/_calle.js        syncIntake(): GET /v1/calls/{id} → KV record
functions/_regions.js      same matrix as regions.json, for the Functions
wrangler.toml              Pages config, KV binding
```

## Run it yourself

```bash
npm i -g wrangler            # or use npx
cp .dev.vars.example .dev.vars   # then fill in CALLE_API_KEY, REVIEW_TOKEN, WEBHOOK_SECRET
npx wrangler pages dev public --kv=INTAKES --port 8799
# open http://127.0.0.1:8799  and  http://127.0.0.1:8799/review
```

Deploy:

```bash
npx wrangler kv namespace create INTAKES          # paste the id into wrangler.toml
npx wrangler pages project create nota-intake --production-branch main
echo "$CALLE_API_KEY" | npx wrangler pages secret put CALLE_API_KEY --project-name nota-intake
# same for CALLE_BASE_URL (https://api.heycall-e.com), REVIEW_TOKEN, WEBHOOK_SECRET
npx wrangler pages deploy --branch main
```

Locally the webhook can't reach you; the review page's **Sync with CALL-E** button (`?sync=1`) polls instead.

## The interview

The agent opens by confirming the caller's name, then states — in the caller's language — that this is an
intake call, not legal advice, and that no attorney-client relationship exists until an attorney confirms in
writing. It then asks, conversationally: matter in their own words (one follow-up if unclear); other parties
(conflict check); deadlines or court dates; urgency; best time to call (asks AM/PM if ambiguous); email
(spelled back, or just confirmed if given on the form); consent to phone and email contact. It never quotes
fees, never gives legal advice, never promises outcomes, and closes by saying an attorney will review.

Result schema (`recipient_result_schema`):

```json
{ "full_name": "…", "email": "…", "preferred_language": "…",
  "matter_type": "contract | litigation | international_discovery | …",
  "matter_summary": "2-3 sentences in English", "opposing_party": "for the conflict check, or 'none'",
  "urgency": "low | normal | high", "deadline_or_court_date": "verbatim or 'none'",
  "best_time_to_call": "…", "consent_to_contact": "yes | no | unknown" }
```

## What a real call looks like

From the first full test (2026-09-04, English, US number). Completion confidence **0.92 / high**:

```
bot:  Hi, is this Derek Soltis?
user: Hello? Yes. It is.
bot:  I'm calling from Nota Lawyer about your website consultation request to gather intake information;
      this is not legal advice, and no attorney-client relationship exists until an attorney confirms it in writing.
bot:  What's the legal matter in your own words?
user: I'm suing Acme Corp for not delivering what they said they were. It's a contract dispute.
bot:  Any other party names I should check for conflicts?
user: Wildy coyote.
…
```

```json
{ "matter_type": "contract", "urgency": "high", "opposing_party": "Acme Corp; Wildy coyote",
  "deadline_or_court_date": "none", "consent_to_contact": "yes", … }
```

## Limits and honest notes

- CALL-E is outbound-only, so the web form is the trigger; the firm's inbound line is out of scope here.
- Spanish for US numbers is not available on CALL-E today (see above). In production, Nota.Lawyer routes
  those callers to a human or to its own inbound Spanish line.
- Reminder calls are placed immediately by the console; scheduling for a future time is left to the caller
  of `/api/remind` (a cron or the firm's calendar), since batch/scheduled calls are outside the current beta.
- "International" line regions are marked by CALL-E as primarily for testing.
- This is intake, not advice: the script is written so the agent never crosses that line.

## License

MIT
