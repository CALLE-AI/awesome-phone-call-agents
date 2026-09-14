# Devpost Submission Draft

## Project Name

TinySlot

## Tagline

Verified childcare openings, by phone.

## Short Description

TinySlot uses CALL-E to call parent-approved childcare centers in bounded waves, verify current age-band openings, compare staff-reported evidence against a privacy-minimized care brief, stop once enough matches are found, and request a tour only after separate parent approval.

## Inspiration

Childcare directories answer which centers exist, but the information a parent actually needs is often available only by phone: Is there a toddler opening? Does it cover the required weekdays and working hours? What is the current tuition? Can the parent tour before deciding?

Parents repeatedly call centers, re-explain the same constraints, and manually compare incomplete answers. TinySlot turns that fragmented phone work into a bounded, auditable search without turning the AI into an enrollment or payment decision-maker.

## What It Does

The parent enters an age band, desired start date, weekdays, care window, budget, and optional subsidy requirement. No child name, diagnosis, or exact home address is required.

TinySlot ranks an operator-provided center list and calls at most three authorized destinations per wave. CALL-E returns a strict per-recipient result containing identity, age-band acceptance, vacancy, earliest start, weekdays, hours, tuition, registration fee, subsidy status, tour availability, and evidence quotations.

Application code then evaluates every center against the same rules. A waitlist is not an opening, voicemail is not evidence, and missing hard-constraint evidence routes to review. Once the requested number of qualified matches is reached, TinySlot stops and leaves the remaining centers undisturbed.

A qualified result does not authorize another side effect. The parent selects a center, reviews a disclosure envelope, and types `REQUEST TOUR` before CALL-E can place a separate tour-request call. TinySlot cannot enroll, accept policies, pay fees, or disclose the child's identity.

## How We Built It

- Next.js 16, React 19, and TypeScript
- `@call-e/calle` TypeScript SDK at runtime
- CALL-E batch recipients with strict `recipientResultSchema`
- Separate structured schema for tour outcomes
- Zod validation before provider results enter domain logic
- Deterministic matching and adaptive stop rules
- Stable idempotency keys and operation identifiers
- HMAC recipient bindings between reviewed destinations and returned recipients
- Server-side credentials, E.164 validation, explicit allowlists, operator authentication, and rate limits
- Synthetic no-call demo enabled by default
- Sixteen offline adversarial tests

## CALL-E Usage

TinySlot imports `CalleClient` in its server route and calls `client.calls.create()` for search waves and tour requests. It polls the accepted call with `client.calls.get()` and binds the result to the original campaign, operation, stage, and reviewed destination before local validation.

An authorized live validation completed successfully with `task_completed: true`, high confidence (`0.86`), and a schema-valid recipient result. TinySlot independently parsed that result and passed all eight matching checks.

## Challenges

The hardest part was treating phone calls as uncertain real-world side effects rather than ordinary function calls. A client can lose connectivity after CALL-E has accepted a call. TinySlot therefore persists the call identity, never interprets a polling failure as proof that no call happened, and does not automatically redial after an ambiguous outcome.

Another challenge was preventing plausible model output from becoming a false match. TinySlot separates CALL-E's conversational work from deterministic eligibility rules and requires explicit unknown states and evidence quotations.

## Accomplishments

- Completed an authorized real CALL-E call and reconciled its result
- Built a full no-call judge path that works without credentials
- Stops calling once enough verified matches are found
- Keeps waitlist, full, unreachable, and unknown outcomes separate
- Uses a second explicit approval boundary for tour requests
- Exports a portable evidence report without live phone numbers
- Passes focused tests, lint, production build, and repository validation

## What We Learned

The most important voice-agent primitive is not dialing; it is recovering safely when network observations and real-world side effects diverge. Durable call IDs, idempotency, transcript-grounded structured results, and explicit human authority make phone automation reusable.

We also learned that field-level evidence is essential for numeric answers such as tuition and fees. CALL-E's structured extraction provides a strong foundation, and field-level transcript span identifiers would make downstream validation even stronger.

## What's Next

- Licensed-directory connectors with explicit phone provenance
- Parent-controlled freshness and manual recheck workflows
- Field-level transcript evidence and correction warnings
- Multilingual center enquiries
- Employer and relocation-service care navigation
- Human-reviewed tour calendar integration

## Links

- Pull request: `<ADD_AFTER_APPROVAL>`
- Public demo: <https://utpal-kalita.github.io/tinyslot-demo/>
- Demo video: `<ADD_AFTER_UPLOAD>`
- Source path: `apps/typescript/tinyslot/`
