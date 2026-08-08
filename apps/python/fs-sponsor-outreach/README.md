# fs-sponsor-outreach

Batch outbound sponsor-outreach caller for student racing teams (Formula
Student, FSAE, and similar), built on the CALL-E CLI. Reads a list of
prospective sponsor contacts from a CSV and places one outbound call per
contact, returning structured, per-contact results (interest level, best
follow-up method/time, notes) instead of raw transcripts.

## What it does

For each row in a leads CSV, the script:
1. Builds a call goal — introduce the team, gauge sponsorship interest,
   capture a follow-up method/time if interested, or close politely if not.
2. Runs `calle call start` to plan and place the call.
3. Polls `calle call status` until the call reaches a terminal state
   (`COMPLETED`, `NO ANSWER`, `DECLINED`, `FAILED`).
4. Writes structured results to an output CSV.

## Setup

Requires Node.js (for the CALL-E CLI) and Python 3.

npm install -g @call-e/cli
calle auth login

Confirm auth works:
calle auth status

No API keys or credentials are stored by this app — it relies entirely
on the calle CLI's own local auth cache.

## Usage

Preview the calls that would be made, without placing any real calls:
python3 fs_sponsor_outreach.py leads.csv --team-name "Formula Student XYZ" --dry-run

Place the calls for real:
python3 fs_sponsor_outreach.py leads.csv --team-name "Formula Student XYZ" --out results.csv

## CSV format

Required columns: name, phone (E.164 format, e.g. +15550101234), region.
Optional: notes (extra context folded into the call goal).

See leads.example.csv for a template.

## Side effects

This app places real outbound phone calls. Each non-dry-run invocation
dials every contact in the CSV. Only add contacts who have consented to
being called by this workflow — do not add un-contacted third parties.

## Cancellation / rollback

Calls are one-off, not recurring — there is no scheduled job to cancel.
To stop a batch mid-run, interrupt the script (Ctrl+C) before it starts
the next row; any call already placed cannot be recalled, only reflected
in the output CSV once it completes.

## Known limitations

- CALL-E's supported recipient regions are currently limited (see CALL-E
  docs for the current list); contacts outside supported regions will be
  rejected at the planning stage.
- The CLI's call start does not expose a custom result_schema
  parameter, so structured fields (interest_level, best_contact_method,
  best_contact_time) are read from whatever CALL-E infers into
  result.extracted by default, rather than a fields list this app defines.
- Tested against a single self-consented contact; not yet run against a
  real sponsor list.

## Built for

CALL-E: Your Code Is Calling hackathon (Devpost, 2026).
