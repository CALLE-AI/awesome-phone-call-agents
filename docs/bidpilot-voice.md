# BidPilot Voice: external CALL-E procurement app reference

BidPilot Voice adds operator-authorized supplier fact calls to an existing RFP analysis app. This contribution is an **external app reference and reproduction guide**, not an embedded copy or a production SDK.

- Source: https://github.com/babifarah9/bidpilot-ai/tree/call-e-hackathon
- Narrated demo (2:05; captured-result replay): https://youtu.be/OuIqCwQORBc
- Implementation PR: https://github.com/babifarah9/bidpilot-ai/pull/1
- Isolated demo: https://bidpilot-voice-demo.onrender.com
- Runtime: Node 22+, Express, React, TypeScript, Vite; CALL-E Developer REST API.

## No-call demonstration

Open the demo, select **Try Demo**, scroll to **BidPilot Voice**, then select **Preview sample result (no call)**. It shows explicitly fictional supplier facts without an API key, operator token, phone number, or CALL-E request. The sample RFP requires no Gemini key. The free hosting instance may need time to wake up.

To reproduce locally:

```sh
git clone --branch call-e-hackathon https://github.com/babifarah9/bidpilot-ai.git
cd bidpilot-ai
npm ci
npm run lint
npm run build
npm run test:calle
node --import tsx --test tests/calle-errors.test.ts
npm start
```

Visit http://localhost:3000. `lint` runs TypeScript checking. Integration tests use a local fake provider and never place telephone calls. See the linked project's `docs/RELEASE.md` for the browser recording/check path and isolated Render instructions.

## Workflow and output

The operator reviews the supplier, E.164 destination, and exact procurement questions before checking authorization. Express creates one CALL-E task, then the browser polls its status. Supplier facts come from `recipients[0].structured_result`, rather than the overall completion count. Availability, lead time, coverage, qualification status, voluntary indicative pricing, follow-up, and notes remain supplier-reported information for human review.

## Live opt-in, credentials, and side effects

Live calls require private server environment variables: `CALLE_API_KEY`, a separate `CALLE_OPERATOR_TOKEN` of at least 24 characters, and `CALLE_ALLOWED_PHONES` containing only consenting test recipients. Use the official HTTPS base URL `https://api.heycall-e.com`. Never publish keys or use a VITE_ prefix. Enter the operator token only on your trusted app origin. Avoid recording the recipient input or tokens; mask real numbers in summaries and recordings.

Explicit per-run authorization, an E.164 check, and an exact recipient allowlist precede any provider request. The agent is instructed to disclose that it is AI, ask only the reviewed questions, and avoid purchases or commitments. This experimental app is not for emergency, medical, legal, or financial advice. Procurement compliance claims require human review.

English calls to Canada were rejected in the author's test. The English-only UI defaults to US and disables Canada. Confirm current provider region/language support before using a consenting test recipient; the region selector is not a guarantee of support.

## Duplicate prevention and cancellation

An unchanged request shares a stable idempotency key. One request consumes the demo server process's budget, including failures and timeouts. No automatic redial or recurring schedule is created. After an ambiguous outcome, check provider history before any intentional restart/reset; do not scale this in-memory demo to multiple instances.

Closing the browser does not cancel a submitted call. There is no in-app cancellation control; use provider dashboard cancellation if available and verify its outcome. Disabling the server prevents future requests but does not recall a call already submitted.

New API task IDs survive page refresh in sessionStorage; the operator must re-enter their token to retrieve status. Tokens, recipient numbers, and transcripts are not persisted by that feature. Server restart recovery remains unsupported because the allowed-ID set is in memory.

## Evidence and limitations

The first authorized test reached voicemail. A subsequent consenting role-play test completed. The operator supplied an app-generated API-field export and a screenshot: all seven recipient fields match exactly, and completion confidence 0.86 displays as 86%. Availability remains unknown; lead time is ten business days, coverage is Massachusetts, indicative pricing is 150 US dollars, certification needs document verification, and human follow-up is true. Private call identifiers, phone numbers, and original screenshots are excluded from this contribution.

This validates response-to-UI mapping for one test, not general extraction accuracy. The second call's transcript/audio was not supplied for independent comparison. The updated narrated video is a clearly labeled replay of captured live-result fields in the functioning UI, with private details replaced by fixtures. Public sample preview data remains fictional. The contribution makes no production-readiness claim.
