# Security Policy

Phone-call workflows can trigger real-world side effects. Treat every skill, app, example, provider adapter, scheduler recipe, and script as potentially sensitive.

## Do not include secrets

Never commit:

- API keys
- OAuth tokens
- bearer tokens
- session cookies
- private phone numbers
- provider credentials
- call recordings
- private call transcripts

## Report a security issue

If you find a vulnerability, unsafe instruction, or credential leak pattern, please open a private security report through GitHub Security Advisories if available.

If private reporting is not available, open an issue with minimal details and do not include working exploit code or live credentials.

## Safety expectations for phone-call workflows

A safe phone-call workflow should:

- require clear user intent before placing calls
- require E.164 phone numbers
- mask phone numbers in final summaries
- avoid hidden recurring jobs
- make cancellation behavior explicit
- separate host scheduling from provider call execution when possible
- avoid storing credentials in repository files
- avoid asking the user to paste tokens into chat

## Medical, legal, financial, and emergency boundaries

Resources in this repository are workflow helpers. They should not provide professional advice.

Medication reminders may remind the user to follow instructions from their doctor or medication label. They must not provide dosage, diagnosis, treatment, or medication timing advice.

Emergency workflows should not rely on this repository as the only path for urgent help.
