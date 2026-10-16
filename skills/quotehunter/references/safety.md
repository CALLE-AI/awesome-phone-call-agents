# Safety contract

The QuoteHunter skill initiates phone inquiries to trade providers to gather competitive quote estimates. Follow these core safety boundaries:

## Consent and operator confirmation

- Real outbound calls are never initiated automatically without explicit human operator confirmation.
- The user must preview recipient details, service requirements, and task instructions in the pre-flight verification modal.
- A 3-second cancellation buffer allows the operator to abort unintended calls before telecommunication carriers are dispatched.
- Testing, demonstrations, and simulated executions use internal simulation mode or synthetic sandbox fixtures without placing live carrier calls.

## AI identity disclosure

- Every call placed via CALL-E strictly includes an AI disclosure informing the recipient that the caller is an automated AI phone assistant calling on behalf of the customer for estimate inquiries.
- The assistant does not impersonate human owners or falsify identity.

## Phone numbers and verification

- All recipient phone numbers must be formatted in valid E.164 notation with unique destinations per swarm execution.
- In test environments and documentation, reserved fictional numbers (such as `+1-555-0100` through `+1-555-0199`) must be used.
- Real recipient phone numbers are masked in backend logs, diagnostics, and frontend views (e.g. `+91 ***** **367`) to protect PII.

## Bounded decision authority

- **Discovery only, no commitment:** The assistant is authorized strictly to inquire about pricing, scheduling availability, and scope inclusions.
- Under no circumstances does the assistant enter into binding agreements, accept terms, authorize work orders, or execute financial transactions over the phone.
- Final contractor selection and booking decisions require direct human operator confirmation.

## Honest and fail-closed reporting

- The assistant reports verbatim quotes and extracted data directly from CALL-E call logs and audio evidence.
- If a vendor is unreachable, declines to quote, or provides vague estimates, the outcome is marked as `no` or `unknown`.
- Never hallucinate, extrapolate, or fabricate price quotes or availability. Low-confidence fallback extractions are explicitly flagged as advisory.

## Extraction, cancellation, and timing limits

- **Advisory Extractions:** All extracted quotes, turnaround estimates, and condition terms represent advisory extractions subject to audio transcription quality and vendor phrasing. They do not constitute binding price quotes or legal guarantees.
- **Speculative Cancellation Limits:** Call abort and cancellation requests dispatched to carriers terminate client-side tracking and dispatch cancellation signals to the provider API. However, carrier-level disconnect is subject to telecommunication network propagation latency; the system does not claim instantaneous carrier hangup.
- **Timing and Latency Disclaimers:** Reported turn latencies, completion durations, and provider response times are empirical approximations from network logs, not SLA guarantees.

## Credential safety

- `CALLE_API_KEY`, database connection strings, and other credentials must strictly remain in environment variables on the backend server.
- Credentials are never exposed to the frontend, included in source repositories, or logged in client-accessible logs.

## Prohibited use cases

- No mass telemarketing, robocalling, or unsolicited promotional outreach.
- No calls to emergency services, government agencies, financial institutions, or sensitive numbers.
- No harassment, deceptive negotiation practices, or automated high-frequency redialing.
