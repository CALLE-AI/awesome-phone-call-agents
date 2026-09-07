# Safety Reference

Phone-call workflows are real-world side effects. `capacity-backfill-cascade` must preserve explicit user consent, strict execution boundaries, and safe data handling.

## Explicit Intent and Consent

Run a cascade workflow only when the user explicitly provides:
1. Reservations data with consent flags
2. Waitlist data with consent flags
3. Clear intent to confirm bookings and/or backfill cancellations

Every record must have an explicit `consent: true` field. Records with `consent: false` are never dialed, regardless of priority or slot availability.

## Required Fields

Every reservation record requires:
- booking_id (unique identifier)
- name (guest name)
- phone (E.164 format)
- party_size (integer)
- slot (ISO 8601 datetime with timezone)
- consent (boolean, must be true to dial)
- status (PENDING_CONFIRM, CONFIRMED, CANCELLED, RESCHEDULED, NO_ANSWER, RECOVERED, NEEDS_REVIEW)

Every waitlist record requires:
- entry_id (unique identifier)
- name (guest name)
- phone (E.164 format)
- party_size (integer)
- window_start (ISO 8601 datetime)
- window_end (ISO 8601 datetime)
- priority (integer, lower is called first)
- consent (boolean, must be true to dial)
- status (WAITING, OFFERED, ACCEPTED, DECLINED, NO_ANSWER, EXHAUSTED, NEEDS_REVIEW)

## Phone Numbers

Use E.164 numbers only. Documentation and sample data use reserved fictional numbers (e.g., +15550111, +15550112).

Mask phone numbers in all outputs. The app masks to the last two digits (e.g., `+15550111` renders as `+******11`); expose no more than that anywhere.

The full phone number appears only in private runtime state for dialing. Never log full numbers in:
- Public reports
- Commit messages
- Issue comments
- README examples
- Audit logs (use masked form)
- Live call manifests
- Provider summaries and errors (sanitize before logging)

## Consent Verification

Never assume consent. Every record must have an explicit consent flag.

If a record has `consent: false`, skip it and log `SKIPPED_NO_CONSENT` in the audit.

If consent is missing from the input, fail validation and require the user to add consent flags.

## Call Budget and Boundaries

The workflow respects these hard limits:
- Maximum call budget: set via `--max-calls` argument
- Dry-run by default: `--live` flag required for real calls
- Call window: only dial within configured time windows
- Duplicate prevention: skip already-dialed targets in the same run

When the budget is exhausted, stop before placing the next call and write back state.

## Destination Allowlist and Origin Pinning

Live destinations must pass region-aware E.164 validation and appear in the
operator's `authorized_destinations.jsonl` allowlist, keyed on the exact E.164
string. Before the first call, the run prints a manifest of every destination
and requires typed confirmation; every dial re-checks authorization.

The MCP origin is pinned to `https://seleven-mcp-sg.airudder.com`. A
`--base-url` value outside that allowlist - including any `http://` origin - is
rejected before any network call, so credentials can never be sent to an
arbitrary or insecure origin.

## Uncertain Outcomes Stop the Run

Outcomes are classified from the explicit `OUTCOME:` token only. Prose-only
summaries, unparseable or wrong-family tokens, no-answer, and
provider failures all mark the target NEEDS_REVIEW and stop the run
(exit code 2) before anyone else is called; keyword hints from the transcript
appear in the report for the human reviewer only.

After human review, continue with:

```bash
table-rescue resume --run-id <run-id> --data-dir <dir>
```

Resume retries only NEEDS_REVIEW/pending targets; settled targets are never
re-dialed, and operator-cancelled runs refuse to resume.

## Duplicate Prevention

Each run has a unique run ID. The engine tracks which targets were dialed in that run.

On re-run with the same run ID:
- Skip targets that were already dialed
- Log `SKIPPED_DUPLICATE` in the audit
- Continue with remaining targets

This prevents accidental repeat calls when a workflow is resumed.

## Cancellation

An operator can cancel a run with:
```bash
table-rescue cancel --run-id <run-id>
```

After cancellation:
- Audit log records `CANCELLED_BY_OPERATOR`
- Later runs refuse to dial targets from the cancelled run
- The workflow state is preserved for inspection

## Error Handling

When a call results in the first `NO_ANSWER`:
- Log the outcome in the audit
- Include the target in the masked staff report
- Do not automatically redial without operator intervention

When a call completes but the OUTCOME is unparsable:
- Log status as `ERROR`
- Include the target in the staff report for escalation
- Do not proceed with cascade logic

## Sensitive Domains

This workflow is for booking and waitlist management only.

Out of scope:
- Medical advice or diagnosis
- Legal advice
- Financial advice
- Emergency services
- Any content requiring professional qualifications

For sensitive domains, decline and suggest appropriate professional services.

## Data Isolation

The workflow stores state in:
- `state/runs/<run-id>/audit.jsonl` - append-only decision log
- `state/runs/<run-id>/report.md` - masked staff report
- `state/runs/<run-id>/state.json` - runtime state (private)

Phone numbers are masked in audit, report, manifests, and error messages; provider summaries are sanitized before persistence. Full numbers exist only in the private runtime stores for dialing.

## Verification

Before live execution:
1. Run dry-run first and inspect the plan
2. Verify call budget is appropriate
3. Confirm consent flags are present and correct
4. Review time windows match business hours
5. Check sample outputs for proper masking

Only when the dry-run plan is correct, run with `--live`.
- Call goals begin with self-identification as an automated assistant (disclosure by design).
