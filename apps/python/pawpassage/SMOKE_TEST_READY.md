# Smoke-test status

The authorized production integration check is complete. No further call is
scheduled or required by this document.

| Check | Observed result |
| --- | --- |
| Official SDK and production endpoint | Used for one authorized US English official-hotline call |
| Provider attempt | One completed attempt, 83 seconds |
| In-call consent | Not confirmed; the agent ended the call |
| Local validation | `TERMINAL_VERIFIED` with `DO_NOT_CONTACT` |
| Three propositions | All `NOT_ESTABLISHED`; no successful business answers claimed |
| Duplicate handling | No second create request or redial for this test |
| Malaysia / Mandarin | Earlier request rejected before dialing; route remains unverified |
| Default demonstration | Credential-free loopback SDK path, zero real calls |
| Offline tests | 58 tests covering contracts, approval, binding, recovery and diagnostics |

[LIVE_VALIDATION.md](LIVE_VALIDATION.md) records the production evidence and its
limits. [LIVE_TEST_PLAN.md](LIVE_TEST_PLAN.md) describes the guarded boundary for
any separately authorized future test. Raw recipient inputs, credentials,
approval receipts, ledgers and provider identifiers remain outside this app's
public package.

## Mandarin template

`examples/mandarin_smoke.template.json` is a non-dialable template for a
synthetic Mandarin checklist. Its task requests Mandarin for the disclosure,
questions and closing; the participant is never asked to impersonate a real
service desk. Offline tests verify locale propagation and a deliberately
contradicted proposition. They do not prove production route availability,
speech quality or participant consent.

Do not fill or execute that template as part of judging. The supported default
verification commands are the no-call demo and offline tests in README.

## Submission preparation

Publish only the current runnable source, truthful English documentation and
reviewed demonstration. A completed API workflow is not the same as three
confirmed checklist answers. The PR, public video and final hackathon form are
separate external actions; this status file does not claim they were submitted.
