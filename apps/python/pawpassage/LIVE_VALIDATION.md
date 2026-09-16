# Production integration evidence — September 13, 2026

PawPassage performed one authorized English test call to the US test hotline
published by the CALL-E maintainer. The live call used the official
`calle-ai==0.7.0` SDK, the production Calls API, and the same approval, ledger,
binding and result-validation workflow used by the local demo.

The API reported a completed 83-second call attempt and returned the closed
structured result. The provider summary said that a live respondent did not
confirm consent for the synthetic checklist test, so the voice agent ended the
call. PawPassage verified the returned binding and recorded `DO_NOT_CONTACT`.
All three propositions remained `NOT_ESTABLISHED`. No second create request or
redial was made for this test.

This verifies a production create/read/result path and the stop-on-unconfirmed-
consent outcome. It does not establish successful checklist answers, an actual
pet-journey service-desk workflow, or Mandarin call quality. `task_completed=true`
describes completion of the instructed call workflow, not completion of the
underlying business goal.

A separate Malaysia / Mandarin request earlier that day was rejected before
dialing with `call_not_ready`. A published region table is not a guarantee of
current account routing. The user then selected the official US English
hotline; the test did not relabel the Malaysian destination or caller identity.

The local test suite passed 58 tests before the production call. Source changes
also preserve a bounded, sanitized message on the first deterministic rejection
without adding a retry. The reproducible default demo still makes zero real
calls and needs no credentials after installation.

Raw credentials, private recipient inputs, approval receipts, ledgers, account
identifiers and provider call IDs are excluded from the contribution. No
recording or transcript is included. The provider account UI had not yet shown
the final usage entry when checked; no final billing amount is claimed.

Source: [CALL-E maintainer's official test-hotline announcement](https://github.com/CALLE-AI/call-e-integrations/issues/102#issuecomment-5569338723).
