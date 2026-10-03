# Live integration verification

The default judge and developer path is the credential-free local demo in
[README.md](README.md). It places no real calls. This document describes the
optional live boundary; it does not authorize a new call.

## Completed production check

On September 13, 2026, one separately authorized US English call used the
maintainer-designated test hotline and the production CALL-E SDK path. The
provider reported an 83-second completed attempt. Consent to the synthetic
checklist was not confirmed, so the voice agent ended the call. The local
binding and closed-result checks passed and recorded `DO_NOT_CONTACT`, with
all three propositions `NOT_ESTABLISHED`. No redial followed.

See [LIVE_VALIDATION.md](LIVE_VALIDATION.md) for the precise evidence and limits.
A prior Malaysia / Mandarin request was rejected before dialing. Neither a
published region table nor the US test establishes current Malaysian routing
or multilingual quality. Do not relabel a destination to bypass restrictions.

## Preconditions for a separately authorized future test

- Use one recipient and a supported region/locale whose calling code matches
  the exact authorized E.164 destination.
- Confirm the account can use an existing free allowance without a payment,
  card, top-up, purchased number or inaccurate identity information.
- Keep the destination, credentials, approval receipt and ledger private.
- Prepare a harmless three-proposition synthetic case and inspect the complete
  task, disclosure, masked preview and approval digest.
- Require a fresh content-bound live approval, an exact recipient allowlist,
  a current timezone-aware window and the CLI's explicit one-call confirmation.
- Explain the AI voice and possible recording, transcription, summarization,
  analysis, storage and provider processing before asking any question. Proceed
  only after a clear yes. Unconfirmed consent or a stop request ends the call.

## One attempt and read-only recovery

The workflow durably reserves the intent before one SDK create request. An
existing reservation returns its recorded outcome and cannot redial. A known
accepted call may be read with `reconcile-live`; an unknown submission must not
be replaced with a new call merely to discover its outcome.

A deterministic rejection is recorded before start, with a bounded sanitized
provider message. A timeout, ambiguous response or binding failure requires
human reconciliation. Do not retry a rejected route or change its language
without a separately reviewed new purpose and authorization.

The Calls API has no documented client cancellation operation. Closing the
local process stops polling but does not cancel a provider-accepted call.
After verification, disable live calls and remove the key and recipient
allowlist from the process environment. Retain the ledger so that the duplicate
guard survives restarts. No recording, transcript or private call artifact
belongs in the public contribution.

## Reproducible submission evidence

The source suite has 58 offline tests. The default fake-server demo exercises
the pinned official SDK, yields confirmed, contradicted and ambiguous outcomes,
and blocks duplicate execution without any credential or real call. A release
candidate should include clean-install test results and repository validation.

The public project description and demonstration must distinguish this
reproducible local demo from the limited production consent-stop check. The
hackathon also requires a public PR, English materials and a publicly viewable
video; a hosted application is optional. Check the current official submission
form before completing external submission actions.
