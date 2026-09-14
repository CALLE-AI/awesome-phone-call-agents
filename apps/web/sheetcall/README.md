# SheetCall

> An external experimental console for spreadsheet-to-CALL-E workflows: validate rows, check a regional calling window, and classify results for human review. The author reports building and running it from an Android phone.

SheetCall is an operator console for turning a list of contacts into a batch of outbound calls. An operator loads records from any of five sources (paste CSV, an Excel/CSV file, a Google Sheets link, paste JSON, or Airtable), previews them through a Dry Run, then places real calls through CALL-E and reviews the classified outcome for each one.

This directory contains documentation only; the implementation is in the linked external project. The walkthrough below is limited to fictional data and Dry Run, not a recommendation to use the public deployment for real contacts or calls.

## What it does

Each record moves through a small state machine before a call is ever placed:

1. **Validate** — E.164 phone format, supported CALL-E region, matching locale, not on a do-not-call list, not a duplicate in the batch.
2. **Eligibility** — check an editable regional calling window and timezone. These are approximate defaults, not recipient-specific legal compliance checks; the caller-supplied configuration can disable this guard.
3. **Call** — handed to CALL-E's Calls API.
4. **Classify** — apply basic result checks and sort into `done`, `review`, `no_answer`, or `error`. These labels are advisory: missing confidence can still produce `done`, and a failed call may be labelled `no_answer`. A human must review the evidence before acting or considering another call.

## Fictional dry-run walkthrough

**App:** https://sheetcall-ntrs.vercel.app

1. Load only fictional records — pick a sample spreadsheet or paste synthetic rows.
2. Keep the **Dry Run** checkbox enabled, select records, and run the local fixture path. No real call is placed.
3. Inspect the simulated classification, confidence score, and evidence. They are fixture output, not proof of a real conversation.

The linked call/status routes do not enforce operator authentication, and a direct API request does not default to dry-run. Do not turn Dry Run off or submit private contact data on the public site. Authorized live experiments require a separately controlled local-only or authenticated operator deployment, explicit per-run consent, and review of the limitations below; this reference does not certify that deployment.

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

- The live path submits eligible records using a configurable task template and `recipient_result_schema` (`reached`, `outcome`, `promise_date`, `promise_amount`, `note`). Duplicate checks are per selection, not a guarantee against separate repeated submissions.
- CALL-E's webhook is treated as untrusted: the handler extracts a call identifier and re-fetches authoritative state before classifying it. It does not persist an update; polling is the implemented result path.
- A result below a confidence threshold, or with an outcome the operator flagged as always-review, is routed to `review` instead of being auto-accepted.

## Credential handling

- `CALLE_API_KEY` is read only server-side (`process.env.CALLE_API_KEY`) and is never sent to the browser or included in any client-facing response.
- The one exception is the Airtable input source: the user's Airtable personal access token stays entirely in the browser tab and goes straight from the browser to Airtable — SheetCall's own server never receives or stores it.
- Destination display fields use last-four masking, but returned free-text notes and evidence can still contain full phone numbers or other personal data. This is partial masking, not anonymization; use only fictional data in the public walkthrough.

## Dry-run / no-call path

Dry Run is checked by default in the UI. For selected records, it uses the same validation and configured eligibility logic as the live path, then returns a fixed local fixture instead of calling CALL-E. It can detect invalid phone formats, unsupported regions/locales, duplicates, and configured calling-window problems. Missing template values are replaced with `[not provided]`, not rejected: manually review required fields and the generated task. The checkbox is not a server-side safety boundary.

## Side effects, cancellation, rollback

- Placing a non-Dry-Run call is a real, billed phone call through CALL-E to the number in the record — there is no simulation mode beyond Dry Run.
- The Google Sheets input source only reads (GET) a shared sheet through a server-side proxy host-allowlisted to `docs.google.com`, does not follow redirects, and returns the sheet's raw text without executing it — it cannot be used to reach an arbitrary internal URL.
- SheetCall keeps no server-side call database. Disable the live deployment or revoke its provider key to prevent new submissions; changing a host environment variable may require redeployment. An already in-flight call remains managed by CALL-E. After an ambiguous submission, stop and reconcile it before another call; closing the page is not cancellation. Redeploying a previous commit rolls back code, not calls already submitted.
