# Examples

## Safe Workflows

- Property manager triggers dry-run workflow to simulate tenant intake, plumbing dispatch, and confirmation.
- Tenant files a leaking faucet report via dashboard, triggering automated intake call to classify urgency and unit access.
- System matches an available electrician from the vetted roster, calls for ETA and pricing quote, and requests tenant confirmation before dispatching.
- Replaying pre-recorded synthetic call transcripts in tests without outbound telephony network activity.

## Unsafe Workflows

- Calling non-rostered or cold phone numbers scraped from public directories.
- Treating voicemail or unanswered calls as confirmed vendor bookings.
- Automatically charging credit cards or committing financial expenditures without coordinator approval.
- Retrying failed calls continuously in a loop without human review or rate limits.
