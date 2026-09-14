# DineLine CALL-E Edition: Final Submission Video

Updated September 14, 2026 after the final controlled-call evidence and media
QA pass.

## Verified render

- Runtime: 2 minutes 49.6 seconds
- Frame size: 1920 x 1080
- Video: H.264 at 25 frames per second
- Audio: mono AAC at 48 kHz, normalized to approximately -16 LUFS
- Captions: small burned-in English captions plus a separate SRT file
- Music: none
- Real calls placed during recording: none
- Private phone numbers, API keys, account emails, and private transcripts shown: none

## Claim boundary

The video shows the functioning fixture-only judge interface and explicitly
says the displayed result is simulated. It also states that separate controlled
calls to an owned phone verified both native CALL-E roles: Agent 1 captured a
complete request in clear English, and Agent Jake returned a confirmed outcome
while Greg role-played the restaurant. It does not describe those role-level
canaries as one complete live round trip.

## Shot list and final narration

### 0:00-0:20 | The product

Visual: DineLine hero and the two-agent summary.

Narration:

> Hi, I am Gregory Schwartz. This is DineLine CALL-E Edition. A diner describes
> the meal they want. One phone agent turns that conversation into a clean
> request. After the diner chooses and approves a restaurant, Agent Jake makes
> one bounded reservation call and brings the answer back.

### 0:20-0:40 | Safe judge mode

Visual: DineLine Concierge panel, sample-mode label, then the structured sample
request.

Narration:

> For judges, this interface starts in safe sample mode. It cannot place a call
> or spend credits. The real path uses the official CALL-E TypeScript SDK behind
> server-only gates. The sample lets us walk through the same contracts, checks,
> and outcomes without contacting a diner or restaurant.

### 0:40-1:04 | Intake and discovery

Visual: Evidence-backed preferences, five fictional choices, and the selected
restaurant.

Narration:

> The DineLine Concierge has one job: ask about place, cuisine, date, time, party
> size, budget, atmosphere, and dietary needs. Required fields, confidence, and
> call evidence must agree before the request moves forward. n eight n then
> validates it, queries Google Places when live credentials are configured, and
> returns five choices.

### 1:04-1:25 | Exact approval

Visual: Booking details, masked destination, immutable request ID, and approval
control.

Narration:

> The diner chooses the restaurant; the browser does not get to invent a phone
> number. n eight n recovers the selected place from its cached result set.
> Before Agent Jake can act, DineLine shows the exact restaurant, guest, date,
> time, party size, and rules. Changing any protected detail cancels the
> approval.

### 1:25-1:56 | Agent Jake and evidence

Visual: Approved Agent Jake control followed by the verified fixture outcome.

Narration:

> Agent Jake has a separate CALL-E task, result schema, permission switch,
> destination allowlist, and journal. DineLine reports a booking only when
> provider status, task completion, confidence, evidence, and the approved
> contract all agree. This public result is simulated. In separate controlled
> calls to an owned phone, the Concierge captured a complete dinner request in
> clear English, and Agent Jake returned a confirmed outcome while I role-played
> the restaurant.

### 1:56-2:17 | Duplicate and uncertain-call safety

Visual: Exact retry followed by the visible duplicate-blocked result.

Narration:

> Now I try the exact call again. DineLine blocks it before dispatch. The same
> fail-closed rule handles timeouts, voicemail, contradictions, and incomplete
> evidence. If CALL-E accepted a call but the result is late, DineLine checks
> that exact call ID. It never guesses and never automatically retries.

### 2:17-2:49 | Provenance, new work, and close

Visual: The six-stage architecture strip and final product statement.

Narration:

> I first built DineLine for my April 2026 capstone and rebuilt version two over
> Memorial Day weekend, before this hackathon. For this edition, I adapted that
> original architecture to two CALL-E providers, added bounded approvals and
> reconciliation, built this interface, and added sixty-five automated tests.
> The same pattern is already becoming CaseCapture, a separate three-agent
> legal-intake prototype. DineLine finds the place. Agent Jake closes the phone
> loop.
