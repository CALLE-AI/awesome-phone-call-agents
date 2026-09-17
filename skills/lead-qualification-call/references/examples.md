# Examples

All phone numbers below are reserved fictional numbers in the NANP `+1555010xxxx` range and cannot be dialed. Never use a real subscriber number in examples. Only example.com, example.net, and example.org may appear as email addresses.

## Safe

- A website callback request from `+15550101234` with `consent: true`, qualified by a disclosed AI call that captures needs, budget, timing, and interest as structured JSON, then routed to a human sales queue as `qualified`.
- A consent-gated campaign lead from `+15550101235` whose call returns `needs_human` because the call reached voicemail; a human reviews before any next step.
- Previewing the compiled task and masked phone from `assets/sample-lead.json` in a demo video without dialing.

## Unsafe

- Calling a lead scraped from a public website with no consent record.
- Treating voicemail or silence as `qualified`.
- Writing `qualified` straight to a CRM and auto-assigning a sales rep before any human review.
- Putting `CALLE_API_KEY` in the intake JSON or on screen during a recording.
- Auto-redialing when CALL-E returns `unknown` or an ambiguous timeout.
- Running `calle call start` or any live sequence without a separate explicit user confirmation.