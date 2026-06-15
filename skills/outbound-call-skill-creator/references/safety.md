# Safety

Use this reference when creating a generated outbound phone-call business skill.

## Creator Safety

The creator must not generate a business skill that calls arbitrary phone-looking values. It must capture a source contract, outreach basis, E.164 phone-number field, dedupe key, execution policy, and writeback behavior.

If the user cannot explain why records are authorized for phone follow-up, generate a dry-run-only skill or stop and ask for a consent field or approved source basis.

## Generated Skill Safety

Every generated business skill must include rules for:

- explicit user intent before processing records for calls
- E.164 phone numbers
- no country-code guessing
- masked phone numbers in summaries
- no credential exposure
- no hidden recurring schedules
- no duplicate jobs
- dedupe by stable candidate ID or source record ID
- clear cancellation behavior for scheduled workflows
- dry-run or approved direct execution policy
- sensitive-domain boundaries

## Direct Execution

Direct execution is allowed only when the generated skill's creation-time contract explicitly says that a concrete request such as "process all June 20 records" authorizes real calls after validation.

Direct execution still requires:

- candidate validation
- outreach basis validation
- dedupe checks
- masked summaries
- skipping unsafe records
- writeback or session-table output

If direct execution is not configured, generated skills must dry-run first and ask the user to approve the exact pending call list.

## Serial Candidate Execution

After the user approves the exact pending call list, generated skills should serially process all ready candidates and should not ask for another per-candidate confirmation. Each candidate must reach a terminal result or skip state before the next candidate starts.

If one candidate fails, record the failure and continue with the next candidate when it is safe to continue. Stop the batch when authentication is missing, the MCP route is unavailable, required provider tools are unavailable, dedupe state cannot be trusted, or continuing would be unsafe.

After all candidates are complete, write configured results or output the session table, then report one final batch summary.

## Sensitive Domains

Generated goals must not provide medical, legal, financial, or emergency advice.

For sensitive workflows, generated calls may collect logistics, confirm preferences, schedule follow-up, or route to a human. They must not provide diagnosis, legal conclusions, investment advice, emergency instructions, or other professional judgment.

## Credentials

Do not expose:

- OAuth access tokens or refresh tokens
- MCP auth tokens
- provider credentials
- callback URLs
- confirmation tokens
- cookies
- private full phone numbers in user-facing summaries

## Cancellation

For one-off calls, cancellation is possible only before the provider call runs.

For scheduled processing, cancellation belongs to the host scheduler. Generated skills must explain how to find and disable the scheduler job when the host supports it.
