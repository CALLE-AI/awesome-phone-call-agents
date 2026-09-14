# SheetCall

> Turns spreadsheet rows into real outbound phone calls via CALL-E — validate, check the local calling-hour window, place the call, and classify the result. Built and run entirely from an Android phone.

SheetCall is an operator console for turning a list of contacts into a batch of outbound calls. An operator loads records from any of five sources (paste CSV, an Excel/CSV file, a Google Sheets link, paste JSON, or Airtable), previews them through a Dry Run, then places real calls through CALL-E and reviews the classified outcome for each one.

## What it does

Each record moves through a small state machine before a call is ever placed:

1. **Validate** — E.164 phone format, supported CALL-E region, matching locale, not on a do-not-call list, not a duplicate in the batch.
2. **Eligibility** — is it currently inside a reasonable local calling-hour window for that region? (Windows are based on real regulatory guidance — e.g. TRAI/TCCCPR for India, TCPA for the US, Ofcom for the UK — not an arbitrary default.)
3. **Call** — handed to CALL-E's Calls API.
4. **Classify** — the terminal result is read back and sorted into `done` (confident, schema-valid), `review` (reached, but a human should check), `no_answer`, or `error`.

## Live demo

**App:** https://sheetcall-ntrs.vercel.app

1. Load records — click "Excel or CSV file" and pick a spreadsheet, or paste rows directly.
2. Click "Dry Run" to exercise the full validate/eligibility pipeline against a local fixture, with no real call placed.
3. Turn Dry Run off, select a record, and place a real call.
4. Once CALL-E reports a terminal state, tap the record to see its confidence score and evidence.

## Stack

| Layer | Technology |
| --- | --- |
| Voice AI | CALL-E API — outbound calls with structured result extraction |
| Frontend | Single-file HTML/JS operator console, no build step |
| Backend | Vercel serverless functions (Node.js) |
| Storage | Browser localStorage only — no server-side database |

## Source

https://github.com/ranjangogoi61/sheetcall (branch `main`)

## CALL-E usage

- One outbound call per eligible record, built from a configurable task template plus a strict `recipient_result_schema` (`reached`, `outcome`, `promise_date`, `promise_amount`, `note`).
- CALL-E's webhook is unsigned, so the handler treats the payload as untrusted: it reads only the `call_id` from it and re-fetches the authoritative call state from CALL-E's own Calls API before updating anything.
- A result below a confidence threshold, or with an outcome the operator flagged as always-review, is routed to `review` instead of being auto-accepted.

## Credential handling

- `CALLE_API_KEY` is read only server-side (`process.env.CALLE_API_KEY`) and is never sent to the browser or included in any client-facing response.
- The one exception is the Airtable input source: the user's Airtable personal access token stays entirely in the browser tab and goes straight from the browser to Airtable — SheetCall's own server never receives or stores it.
- Phone numbers are masked to their last 4 digits everywhere they leave the server (UI, logs, any client-facing payload).

## Dry-run / no-call path

Dry Run is the default-safe path: it runs every loaded record through the identical validate/eligibility logic used for real calls, then returns a fixed local fixture result instead of calling CALL-E. It exists to catch bad data (invalid phone format, unsupported region/locale, missing required template fields) and calling-window problems before any credit is spent or any real phone rings.

## Side effects, cancellation, rollback

- Placing a non-Dry-Run call is a real, billed phone call through CALL-E to the number in the record — there is no simulation mode beyond Dry Run.
- The Google Sheets input source only reads (GET) a shared sheet through a server-side proxy host-allowlisted to `docs.google.com`, does not follow redirects, and returns the sheet's raw text without executing it — it cannot be used to reach an arbitrary internal URL.
- SheetCall keeps no server-side state beyond the `CALLE_API_KEY` environment variable. To roll back: remove or rotate that variable to immediately stop new calls from being placed (an already in-flight call is managed by CALL-E, not by SheetCall), and redeploy a previous commit to roll back code — there is no database migration to reverse.
