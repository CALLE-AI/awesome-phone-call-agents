# Safety Reference — insurance-claims-orchestrator

## Disclosure Requirement

Both calls MUST open with:
> "Hello, this is an automated assistant calling on behalf of your insurance provider.
> This call may be recorded for quality and compliance purposes."

The word "automated" must appear. If the recipient asks to speak with a human, the call stops immediately and returns `outcome: "refused"`.

## PII / PCI Boundaries

The following are NEVER collected, repeated, or stored:
- Social Security Numbers
- Credit card numbers, CVVs, expiry dates
- Bank account numbers
- Passwords or authentication codes
- Full date of birth (year-of-birth is acceptable context only)
- Medical diagnoses or treatment details

If a claimant volunteers any of the above, CALL-E is instructed to say:
> "For security, please do not share that information over the phone.
> Our team will contact you through a secure channel."

## Coverage Decision Boundary

CALL-E agents under this skill NEVER:
- State whether a claim will be approved or denied
- Quote settlement amounts
- Promise specific outcomes
- Make commitments on behalf of the insurer

Any question about claim decision routes to:
> "An adjuster from our team will be in contact within 2-3 business days to discuss your claim."

## Fail-Closed Dispositions

| Outcome | Action |
|---|---|
| completed + schema valid | Route to adjuster queue |
| completed + schema null | Human review: extraction failure |
| voicemail | Human review: do NOT leave a message |
| no_answer | One retry after 4 hours, then human review |
| refused | Human review: do not retry |
| unclear | Human review: do not retry |

## Calling Hours

Calls must only be placed between 8:00 AM and 9:00 PM recipient local time.
The operator is responsible for computing local time before invoking the skill.

## Phone Number Handling

- Phone numbers are passed as E.164 strings
- Numbers are masked in all console output: first 4 characters + asterisks
- Numbers are never logged to disk in full
- Fixture files use +1555XXXXXXX format (NANP reserved test range — will never reach a real person)

## Idempotency

Idempotency key format: `sha256(phone + step_id + incident_date)`
A second invocation with the same key within 24 hours is a no-op.
