# Safety

- Explicit policyholder consent required before placing any call.
- E.164 phone numbers only. Mask phones in all logs and output.
- Never collect SSN, payment details, banking information, or passwords on the call.
- Never commit `CALLE_API_KEY` or any credentials to the repository.
- One call per intake. No hidden retries or recurring schedules.
- Fail closed: voicemail, no_answer, refused, and unclear outcomes route to human review — never auto-proceed.
- The agent discloses it is automated at the start of every call.
- Claims decisions (approval, denial, settlement) are never made or implied on the call.
- Out of scope: coverage verification, legal advice, medical details, payment processing.
- Calling hours: 8:00 AM to 9:00 PM recipient local time only. Operator is responsible for time zone check.
