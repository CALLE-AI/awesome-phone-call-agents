# DineLine CALL-E Sanitized Live Canary Evidence

Date: September 14, 2026

## Boundaries

Every external action was separately authorized, limited to one attempt, and
sent only to an owned test line. No restaurant or unrelated third party was
called. Provider call identifiers, the destination number, and private
transcripts are intentionally omitted.

## Google Places

- One `places:searchText` request returned HTTP 200 with 10 callable results.
- The same normalization and ranking contract used by the generated workflow
  selected five options.
- This was a bounded API test, not a claimed full live n8n execution.

## CALL-E Agent 1

- One final native SDK canary completed successfully with no retry.
- The Concierge captured a complete steakhouse request for New York City,
  including date, time, party size, atmosphere, and dietary constraints.
- CALL-E returned confidence `0.93`, no missing required fields, and evidence
  that the request was repeated and confirmed.
- Greg heard a clear English conversation.
- The call ended after promising that five options would be prepared. That is
  the deliberate asynchronous handoff to the app and n8n discovery stage, not a
  claim that recommendations were spoken during the same call.

## CALL-E Agent Jake

- One native SDK booking-role canary completed successfully with no retry.
- Greg role-played the restaurant on the owned line.
- CALL-E returned a confirmed result for the approved date, time, and party
  size; DineLine's evidence verifier accepted it without human review.
- Greg heard a clear English conversation.
- After this canary, the task prompt was tightened to require an outcome
  readback and confirmation before ending. Automated tests cover that prompt
  contract; no additional paid call was placed.

## Claim boundary

The two CALL-E roles and the Google request were verified as separate bounded
canaries. The public fixture demo shows the complete staged product journey.
The project does not claim that all three external boundaries ran as one live
round trip.
