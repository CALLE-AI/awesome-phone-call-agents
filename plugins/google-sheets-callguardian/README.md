# CallGuardian for Google Sheets

A Google Sheets Apps Script plugin that adds a compliance gate in front of CALL-E:
pre-dial consent, call-window, do-not-call, and daily-attempt-cap checks, plus live
in-call opt-out detection, delivered as a **CallGuardian** menu in any spreadsheet — no
dashboard, CLI, or API client required by the end user.

Outreach and collections teams already keep their contact lists in a spreadsheet, not a
CRM. This plugin meets them there instead of asking them to adopt a new tool.

The compliance engine and dashboard this plugin talks to are open source:
[github.com/ayodejiades/callguardian](https://github.com/ayodejiades/callguardian).

## What it does

1. **Check compliance** on the selected rows — writes `CLEARED` or `BLOCKED: <reason
   code>` (`OUTSIDE_CALL_WINDOW`, `NO_CONSENT`, `SUPPRESSED`, `ATTEMPT_LIMIT_EXCEEDED`)
   into the `Status`/`Reasons` columns. Places no call.
2. **Place call (cleared only)** — re-checks compliance at the moment of dialing (never
   trusts a stale `Status` cell), then calls CALL-E for rows that clear, and writes the
   call outcome back into the row. If the recipient invokes an opt-out phrase during the
   call, `Suppressed` is set to `TRUE` automatically.
3. **Verify audit log** — every decision and call outcome from this sheet (and from the
   CallGuardian dashboard, if you use both) lands in one shared, hash-chained audit log.
   This menu item recomputes the whole chain and reports the first entry where it breaks,
   if any.

## Requirements

- A Google account (no other signup) and any Google Sheet you can edit.
- A deployed CallGuardian API (`make deploy` in the main repo, or the reference instance)
  reachable over HTTPS.
- A CALL-E account for live calls. Without one, or with the CallGuardian API running in
  `DEMO_MODE=1`, "Place call" returns a deterministic fixture outcome instead of dialing —
  useful for trying the whole flow with zero cost and zero real phone calls.

## Setup

1. Open a Google Sheet, then **Extensions > Apps Script**.
2. Copy [`Code.gs`](Code.gs) into the script editor, and copy
   [`appsscript.json`](appsscript.json)'s content into the project's manifest
   (**Project Settings > Show "appsscript.json"**).
3. Save, reload the spreadsheet, and accept the OAuth prompt (spreadsheet access + the
   ability to call an external URL — both scopes are declared in the manifest, nothing
   hidden).
4. **CallGuardian menu > Set API base URL…**, enter your deployed origin
   (e.g. `https://callguardian.onrender.com`).
5. **CallGuardian menu > Insert header row** on a blank sheet, or use
   [`examples/sample-sheet.csv`](examples/sample-sheet.csv) to try it immediately with
   fictional 555-01xx numbers.

## Columns

| Column | Meaning |
|---|---|
| Name, Phone, Timezone | The recipient. Timezone is an IANA name (`America/Chicago`) — it decides the calling-window check. |
| Rule Pack | One of `us-tcpa-collections`, `us-telemarketing-dnc`, `appointment-reminder`, `healthcare-outreach`. |
| Consent Given, Consent Date | `TRUE`/`FALSE` and a date; ignored by rule packs that don't require consent. |
| Suppressed | `TRUE`/`FALSE`. Set automatically when a call detects an opt-out; can also be set by hand. |
| Status, Reasons, Call Outcome, Audit Hash | Written by the plugin — don't hand-edit while a check/call is running. |

## Side effects and cancellation

- "Check compliance" has no side effect beyond writing to the sheet and the shared audit
  log; it never dials.
- "Place call" may create exactly one outbound call per selected row, only for rows that
  clear the gate at the moment of dialing.
- There is no recurring schedule or batch queue — running the menu item again on the same
  rows is a new, separate action each time, and it is on you (or a script trigger you add
  yourself) to avoid re-dialing a row you already called.
- Stopping the script (closing the sheet) cannot recall a call CALL-E has already accepted.

## Credential handling

- The API base URL is stored in the sheet-bound Script Properties, not in the sheet
  itself.
- No CALL-E credential is entered into the sheet or the script — the deployed
  CallGuardian API holds `CALLE_API_KEY` as a server-side environment variable and this
  plugin only ever talks to that API, never to CALL-E directly.
- **Known limitation:** `/api/gate/check-external` and `/api/gate/place-call-external`
  have no authentication of their own — anything that can reach your deployed
  CallGuardian instance can call them. The public reference deploy runs `DEMO_MODE=1` for
  exactly this reason (every call returns a fixture, nothing real happens). If you deploy
  your own instance with a real `CALLE_API_KEY` and `DEMO_MODE=0`, put it behind your own
  auth (a shared secret header, an IP allowlist, or your host's access controls) before
  exposing it to the internet.

## Dry run

Point **Set API base URL…** at a CallGuardian instance running with `DEMO_MODE=1` (see
the main repo's `.env.example`) to exercise the entire check/call/audit loop against
fixtures — no CALL-E account, no network call to CALL-E, no cost.
