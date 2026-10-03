# DineLine CALL-E Submission Claims Ledger

Updated September 14, 2026 after the live Google Places check and the final
controlled Agent 1 and Agent Jake canaries.

## Verified now

| Claim | Evidence |
| --- | --- |
| The app contains two native CALL-E TypeScript SDK providers. | `calle-intake-provider.ts` and `calle-sdk-provider.ts` use `@call-e/calle` through an explicit create-then-wait runner. |
| Each CALL-E role has its own task, result schema, runtime gate, and destination allowlist. | Provider factories, provider code, `.env.example`, and provider tests. |
| The public adapter cannot place a real call. | `api/index.ts` hard-forces fixture mode and both call gates false; adapter test passes. |
| The public Vercel deployment works in fixture mode. | A fresh September 14 browser smoke test completed sample intake, restaurant selection, approval, fixture booking, duplicate blocking, and the architecture close. `/api/config` returned fixture mode with both real-call readiness values false. |
| Exact approvals are fingerprinted. | Domain contracts use stable SHA-256 IDs and reject changed details. |
| Duplicate or ambiguous dispatches are not retried automatically. | File journals reserve before dispatch; an accepted call ID is preserved; reconciliation reads only that bound ID; timeout, reconciliation, and duplicate tests pass. |
| Fixture resets do not weaken the real-call duplicate boundary. | UI fixture bookings use a journal scoped to the browser session. An exact retry in that session is blocked, while a fresh fixture session can run. Real UI calls and n8n calls retain global ledgers across sessions. |
| Provider summaries alone cannot prove success. | Evidence verifier tests reject summary-only and contradictory results. |
| The n8n integration contains Google Places search, ranking, cache, and selected-result recovery. | Generated inactive workflow and static workflow tests. |
| The final no-call n8n package works across both agent boundaries. | n8n execution `879` passed all ten nodes on September 12, 2026. |
| The package passes its automated gates. | 65 tests, TypeScript build, JavaScript syntax, upstream validator, and npm audit all pass. |
| The first approved Agent 1 request was rejected before dialing. | The September 12 private runtime record has no provider call ID and reports that the original result schema was unsupported. The wire schema was corrected before a separately approved retry. |
| One controlled Agent 1 call reached technical completion and produced verifier-valid data, but did not pass human conversational QA. | The private September 12 controlled-call log records task completed `true`, confidence `0.95`, matching request metadata, and no missing search fields. However, Greg reported unexpected non-English-sounding voice output and had to ask the agent to speak English. The stored transcript is English and therefore does not explain the recording-level defect. |
| The DineLine Google Places request and ranking contract was exercised live. | Exactly one authorized `places:searchText` API test returned HTTP 200, normalized 10 callable restaurants, and ranked five Manhattan Italian options using the workflow's request and ranking logic. This was not a full native n8n execution. Sanitized evidence is recorded in `LIVE_CANARY_EVIDENCE_2026-09-14.md`. |
| A final Agent 1 canary completed cleanly on an owned test line. | CALL-E captured a complete search-ready request with confidence `0.93`, no missing fields, confirmation evidence, and a clear English conversation by Greg's human-heard assessment. Its close correctly handed the asynchronous result back to DineLine rather than speaking restaurant choices during the call. |
| Agent Jake completed a controlled booking-role canary on an owned test line. | Greg role-played the restaurant. CALL-E returned a confirmed result for the approved date, time, and party size, and DineLine's verifier accepted it without human review. The call was clear in English; no restaurant or third party was contacted. |
| The local upload master meets the hackathon's video format and runtime limits. | The final English render is 2 minutes 49.6 seconds, 1920 x 1080 H.264 with 48 kHz AAC audio, small burned-in captions, and a separate SRT. Frame review found no private phone number, API key, account email, or private transcript. SHA-256: `75A2B245B1226D4618E80EA3E13B6E822DA072B6E22850719D2B07C890E5943F`. |
| No secret or private contact data is in the contribution. | Pattern scan found no key, email, private number, transcript, or machine-specific path. |
| DineLine V1 and V2 predate the submission period. | Local Git history and dated capstone artifact recorded in `PROJECT_PROVENANCE.md`. |

## Not yet verified

| Do not claim yet | Required evidence |
| --- | --- |
| The complete Agent 1 -> live Google Places -> diner choice -> Agent Jake chain ran live as one execution. | The three external boundaries were verified separately, while the public interface demonstrates the full staged flow with fixtures. Do not collapse those facts into a complete live-round-trip claim. |
| The upstream contribution exists publicly. | Fork, push, open pull request, and record URL. |
| A public video URL exists and remains available for judging. | Upload the verified local master to YouTube or Vimeo, set it public, and test the URL signed out. |
| The hackathon submission is complete. | Devpost receipt before the deadline. |

## Prohibited overclaims

- Do not call the fixture restaurant cards live Google Places results.
- Do not call a provider summary proof of a reservation.
- Do not say the build is production-ready.
- Do not say the public demo places phone calls.
- Do not describe the separate live canaries as one complete live round trip.
- Do not imply DineLine itself was invented during the CALL-E Hackathon.
- Do not imply Codex originated the product or that Gregory only supplied an
  idea.

## Next claim gates

1. Do not place another CALL-E call for this submission. The unresolved audio
   and billing issues remain documented limitations, not publication blockers.
2. Confirm the exact CALL-E account email before entering it on Devpost.
3. Deploy and test the fixture-only judge interface after separate approval.
4. Fork, push, and open the required public pull request after separate
   approval.
5. Upload the verified local video master publicly and test the URL signed out
   after separate approval.
6. Replace all placeholders, perform one final claim review, and obtain a final
   confirmation immediately before submitting Devpost.
