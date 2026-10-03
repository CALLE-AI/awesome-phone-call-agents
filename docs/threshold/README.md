# Threshold

Threshold is an experimental Japanese-language missed-call review demo. It separates what a respondent stated, general guidance, and unresolved information so that a person can decide whether to call back. It does not classify a caller as safe or fraudulent.

- Public demo: https://call-e-attention-gate.cohyme.chatgpt.site
- CALL-E execution issue: https://github.com/CALLE-AI/awesome-phone-call-agents/issues/229

The application UI is Japanese. This guide describes the judge path in English.

## Safe judge path

The hosted demo uses fixture mode. Real calling is disabled, and the synthetic result examples require no CALL-E credentials or telephone number entry. They are not recordings, transcripts, or measurements from live AI calls.

1. Open the public demo.
2. Expand the fictional-result section below the phone-number form. On a narrow screen, scroll below the form.
3. Select each of the five example buttons in order.
4. Review the result card on the right, or farther down on a narrow screen.
5. Expand the unavailable-fields section to inspect why information was not used.

| Button | Example | What it demonstrates |
| --- | --- | --- |
| 1 | Delivery message | A stated respondent label, message, and individual callback request. Number readback is separate from independent public verification. |
| 2 | Hospital general guidance | The purpose is withheld under a disclosure policy. Reception hours remain general information instead of becoming an individual deadline. |
| 3 | “Mom, call me” | The message is preserved without inferring the speaker's age, identity, or family relationship. |
| 4 | Authentication-code request | A synthetic safety-boundary result. It does not claim that a live call was stopped. |
| 5 | One inconsistent field | An unsupported deadline is rejected while other supported information remains visible. |

Result sections keep respondent statements, general guidance, and unavailable information distinct. Applicable fields include supporting evidence. Conversation auditing is explicitly marked as not performed, and the final callback decision remains with the user.

## Pre-call controls

The normal number-input route accepts Japanese general fixed lines and 070, 080, or 090 mobile numbers. Other number types are outside this MVP's scope; they are not classified as fraudulent. For a supported input, the primary button opens a pre-call review. It is not a live-call button in the hosted demo. Missing dispatch prerequisites produce a clear no-call notice.

A separate local test profile was prepared for CALL-E's official US testing hotline. That profile is not configured in the hosted fixture demo. Do not enter the hotline in the normal Japanese-number route or attempt another live test.

## Actual CALL-E integration record

On September 8, 2026, an authorized controlled test against CALL-E's official US testing hotline completed the planning stage successfully. The client then reached the execution stage, but no Run ID was returned. It remains unknown whether CALL-E accepted the execution request, created a Run, or began a telephone call.

The unresolved execution-result behavior is tracked in public Issue [#229](https://github.com/CALLE-AI/awesome-phone-call-agents/issues/229). `PROVIDER_ERROR` was the Threshold client's normalized label; it was not a raw CALL-E error and does not establish the provider or root cause. The test was not retried because execution acceptance could not be determined and a retry could cause duplicate dialing.

## Author-reported validation

These results are author-reported and have not been independently verified by CALL-E maintainers:

- 79 automated tests passed: 76 core tests and 3 rendering or route tests.
- A later focused checkpoint passed 20 hotline-path tests, TypeScript checking, and the production build.
- Tests use fake clients and local infrastructure; they do not demonstrate successful live calling.

## Known limits

- Japanese CALL-E voice behavior is unavailable or unverified in the tested account and runtime scope.
- Live call completion, result extraction, and durable result persistence have not been verified end to end.
- A provider-enforced maximum call duration has not been verified.
- The hosted deployment is a no-call product demonstration, not a production calling service.

Live dispatch remains disabled unless an operator explicitly confirms an allowlisted destination, credentials are present, and the required runtime safeguards are attested. No additional live test should be run while the September 8 execution remains unresolved.
