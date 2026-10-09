# Vendor Discovery & Outreach Agent

**Zero-input vendor sourcing.** Give it a product and a city — no lead list, no CRM, no
manual research — and it finds real local businesses on OpenStreetMap, shows you a
masked preview, and only *after* you approve it runs a two-round CALL-E phone campaign:
Round 1 qualifies interest, Round 2 captures pricing, quantities, timeline, and a
contact name from every vendor who said yes.

Built for the CALL-E Hackathon (deadline Sep 14 2026).

---

## Features

- **Discovery** — queries OpenStreetMap/Overpass for businesses matching a product
  keyword in any city, with an LLM fallback for keywords it doesn't recognize, and
  filters to vendors that actually have a phone number.
- **Qualify (Round 1)** — a CALL-E voice agent calls each vendor to check interest.
- **Capture (Round 2)** — follows up with every interested vendor to collect pricing,
  quantities, timeline, and a contact name.
- **Infer** — Groq (Llama) reads each transcript and extracts structured fields.
- **Dry-run by default** — every campaign plans calls but places none unless you pass
  `--live`. Nothing dials without that explicit flag.
- **Recipient-authorization gate enforced at the dispatch point** — a live call needs
  the operator's explicit attestation that every recipient authorized the call, plus a
  strict ASCII E.164 destination for the chosen region. The function that actually
  places a call checks both itself, so nothing — not the CLI, not the dashboard, not
  the AI assistant, not the scheduler — can route around it. Being listed on
  OpenStreetMap is **not** recipient authorization.
- **No automatic redial after an ambiguous outcome** — if `calle call run` times out,
  errors, returns no run ID, or the call is still unresolved when polling ends, the
  lead is marked `skipped / ambiguous_submission` and never retried automatically.
- **Business-hours gating** — resolves each vendor's timezone and skips the call
  outside 09:00–18:00 local; fails *closed* (skips) if the timezone can't be resolved.
- **Cancellable follow-ups** — scheduled retries and callbacks can be cancelled before
  they fire.
- **Web dashboard** — live campaign view, a map, analytics, and an AI chat assistant
  ("Callie") that can run the same discover → confirm → call flow conversationally.

---

## Requirements

- Python 3.9+
- Node.js (for the `calle` CLI)
- `calle` npm package: `npm install -g @calle-ai/cli`
- A CALL-E account at [calle.ai](https://calle.ai)

Install Python dependencies:
```
pip install -r requirements.txt
```

Set environment variables (never hardcode):
```
set GROQ_API_KEY=<your-groq-key>
```
`GROQ_API_KEY` is optional — it enables transcript inference and the dashboard's AI
assistant. Everything else (discovery, calling, dry-run) works without it.

---

## Usage

**Dry-run is the default.** Without `--live`, every campaign plans calls but never
dials — safe to run with no CALL-E credits spent and no phone rings.

### Dry run (default — no real calls placed)
```
python main.py --product "office chairs" --location "London, UK"
```

### Real campaign (requires --live, --region and your attestation)
Only run this for vendors who have authorized you to call them (an existing supplier
relationship, a prior opt-in). You will be asked to type `I ATTEST`; for
non-interactive runs pass `--attest-recipient-authorization`. `--yes` only skips the
vendor-list prompt — it never attests for you.
```
python main.py --product "leather shoes" --location "Mumbai, India" --region IN --limit 5 --live
```

### With Excel export
```
python main.py --product "hardware tools" --location "Berlin, Germany" --limit 10 --export-excel results.xlsx
```

### All flags
```
  --product        Product or service to source (required)
  --location       City or region to search (required)
  --limit          Max vendors to discover (default 10)
  --region         Region for CALL-E and E.164 validation, e.g. GB, US, IN (required with --live)
  --language       Region hint for CALL-E, e.g. English
  --live           Actually place real calls. Without this, always dry-run.
  --dry-run        Explicit no-op — dry-run is already the default without --live
  --yes / -y       Skip the vendor-list confirmation prompt (does not attest)
  --attest-recipient-authorization
                   With --live: attest that every recipient authorized the calls
  --export-excel   Export results to .xlsx after campaign
  --export-csv     Export results to .csv after campaign
  --export-json    Export results to .json after campaign
  --cancel-campaign ID   Cancel every pending scheduled call for a campaign and exit
```

### Scheduled follow-ups & cancellation

Round-2 follow-ups and retry-on-no-answer calls are queued in the `scheduled_calls`
table and fired by a background scheduler thread (`scheduler.py`) that polls every
10 seconds — this thread starts automatically whenever `dashboard.py` runs. To cancel
work already queued:

```
python main.py --cancel-campaign 3
```
or from Python:
```python
from scheduler import cancel_scheduled, cancel_campaign
cancel_scheduled(scheduled_call_id)   # cancel one queued call
cancel_campaign(campaign_id)          # cancel every pending call for a campaign
```

Cancelling only prevents calls that haven't fired yet — a call already in progress
will complete.

### Web dashboard

```
python dashboard.py
# Open http://127.0.0.1:5000
```

Auto-refreshes every 8s. Shows every campaign, masked phone numbers, R1/R2 status,
AI-extracted summaries, consent timestamps, a live call console, a map view, and an
analytics tab. With `GROQ_API_KEY` set, an AI chat assistant ("Callie") is also
available — it can discover vendors, start a campaign, check results, and send
WhatsApp messages, but is still bound by the same consent gate as everything else:
it requires an explicit yes/confirm from you before it will place a real call.

---

## Architecture

```
main.py              Orchestrator: discovery -> consent gate -> R1 calls -> R2 calls
discovery.py         OpenStreetMap/Overpass API vendor search
script_gen.py        Goal script generator + client approval prompt
caller.py            CALL-E plan/run/poll pipeline + Groq transcript inference +
                      the actual consent/business-hours gate at call-dispatch time
business_hours.py    Timezone-aware business hours gate (fails closed on unknown tz)
scheduler.py         Background retry/follow-up scheduler + cancellation
scoring.py           Lead quality scoring from OSM data richness
reliability.py       Vendor reliability badges from call-history aggregates
models.py            SQLite schema: campaigns, leads, call_logs, scheduled_calls
dashboard.py         Flask web UI + Callie AI assistant
```

### Recipient-authorization gate

Discovering a business in a public directory, or having a business reason to call it,
is not authorization to call it. Before any live call the operator must attest that
every recipient has authorized the call:

- **CLI:** type `I ATTEST` at the prompt (or pass `--attest-recipient-authorization`).
- **Dashboard:** tick the attestation checkbox in the wizard, or confirm the
  attestation dialog on "Attest & Call" in the Campaigns tab.
- **AI assistant:** cannot attest on your behalf; it can only start a campaign you
  have already attested in the UI.

The attestation is stored as `consent_basis = operator-attested-recipient-authorization`
alongside `consent_approved_at`. `caller.py`'s `execute_call_pipeline` — the function
that actually dials — re-checks it from the database for every live call, and for a
one-off call without a campaign it requires `recipient_authorized=True`. Campaigns
approved before this gate existed must be attested again before they can dial.

### Destination validation (E.164)

Every destination must already be exact ASCII E.164 (`+<country code><number>`, 8–15
digits, no spaces) and match the campaign region (`--region`, required for live
calls). Discovery keeps only OpenStreetMap numbers that are already written with their
own `+<country code>`; numbers without one are dropped rather than guessed at, so some
listings will no longer appear.

### Ambiguous outcomes

A timed-out or failed `calle call run`, a run with no run ID, or a call still
unresolved when polling ends is an ambiguous submission — the vendor may already have
been called. These are recorded as `skipped / ambiguous_submission: …` and are never
retried. Only clean `NO_ANSWER` / `BUSY` outcomes are retried automatically. Scheduled
calls interrupted by a crash are marked `ambiguous` on restart instead of being
re-queued. Check the run in CALL-E before calling that vendor again.

### Business hours

Before each call, `business_hours.py` resolves the vendor's timezone from lat/lon
(via `timezonefinder`) and checks Mon–Fri 09:00–18:00 local. Calls outside this
window, or where the timezone can't be resolved at all, are skipped (logged as
`skipped / outside_business_hours` or `skipped / no_consent_on_record`) — never
silently placed.

### Phone masking

All phone numbers are masked (`+44****123`) in logs, the dashboard, Excel/CSV/JSON
output, and any file that could appear in version control. Phone numbers spoken in
transcripts or summaries are redacted in the live console and console output, plans
are never returned or printed with their destination, and raw `calle` command lines
and stderr are never surfaced — errors carry only a short category such as
`timed out`. Raw phone numbers are
stored only in the local SQLite database, which is not committed to git.

---

## Database

SQLite at `vendor_discovery.db` (auto-created on first run, not committed to git).

Tables: `campaigns`, `leads`, `call_logs`, `scheduled_calls`, `messages`, `templates`.

Key lead fields: `masked_phone`, `candidate_id` (stable OSM URI), `skip_reason`,
`lead_score`, `consent_basis`.

Exports (`--export-json` / `--export-csv` / `--export-excel`) also carry the
candidate schema fields `candidateId`, `maskedPhoneNumber`, `outboundGoal`, `status`,
and `skipReason` alongside the human-readable columns.

---

## Side effects

Running with `--live` places **real phone calls** via CALL-E to the discovered
vendors. Each call consumes CALL-E credits. Estimated: 1–2 calls per vendor per round.
Without `--live`, no call is ever placed — the campaign plans and stops.

**Cancellation:** `python main.py --cancel-campaign ID` (or `scheduler.cancel_campaign`)
cancels every not-yet-fired scheduled call for a campaign. A call already in progress
will complete — there is no way to interrupt a call mid-ring. To stop a running CLI
session outright, kill the process (Ctrl+C); already-placed calls will complete and
no further calls will be dispatched.

---

## Testing

```
python test_pipeline.py
python smoke_test_full.py      # discovery + scripts + DRY-RUN plan; never dials
```

`smoke_test_full.py` places a real call only with
`--live --to +<E.164> --region <XX> --attest-recipient-authorization`; there is no
default live destination.

A no-call smoke test: exercises campaign/lead database saves, phone masking, the
business-hours gate, call-status classification, and Groq transcript inference —
without placing a single real call or requiring a CALL-E account.

---

## OSM Attribution

Data (c) OpenStreetMap contributors (ODbL) — https://openstreetmap.org/copyright

---

## License

MIT
