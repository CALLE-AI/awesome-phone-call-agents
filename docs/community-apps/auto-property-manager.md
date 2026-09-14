# Auto Property Manager

A hosted short-term-rental management platform that uses CALL-E for two
author-described workflows: alerting a property owner by phone when a guest has an
urgent access issue, and calling (or emailing) a contractor about a
guest-reported property issue.

- Live app: https://autopropertymanager.com
- License: Proprietary (closed source); this entry documents the hosted app only.

Auto Property Manager is hosted in its own private repository. It is not a
CALL-E SDK and does not define a supported application API. The behavior and
safeguards below are author-described and not independently verified against
the private implementation; this reference is not production certification.

## Overview

Guests message the property through in-app chat, SMS, WhatsApp, or email. AI
triage classifies each reported issue (urgency, category, whether it must be
fixed while the guest is present). Two situations can trigger a CALL-E phone
call: a guest who explicitly asks for the owner or reports being unable to
enter the property (owner-alert call), and an urgent, legitimate maintenance
issue that needs a contractor's live accept/decline (contractor-dispatch
call). Every automatic call is gated by an explicit per-account toggle, a
saved destination number, a cooldown, and a rolling call/email allowance.

## Setup

Log in at https://autopropertymanager.com/login with the reviewer demo
account below (pre-authorized for the rehearsal screen, not an admin
account; no signup, property, or settings steps are required):

- Email: calle-reviewer@autopropertymanager.com
- Password: CalleReview-ef213cad56

Then open **Safe Call & Email Tests** (`/communication-test`) for a
rehearsal that never contacts a real guest or business — see below.

## CALL-E integration method

Server-side Supabase Edge Functions call the CALL-E REST API directly over
HTTPS (no vendored SDK). Two call sites exist:

- `guest-owner-call` — places an owner-alert call.
- `provider-contact-dispatch` — places a contractor-acceptance call (or sends
  email/SMS) about a guest-reported issue.

Both requests include a structured `result_schema` so the model's spoken
outcome comes back as machine-checked JSON (for example `acknowledgement` or
`decision`), and both register a per-call webhook so the terminal state is
read from an independently re-fetched provider callback rather than trusted
from the initial create response.

## Call side effects

Outside of the rehearsal page, a real owner-alert call rings the property
owner's saved phone, and a real contractor call/email reaches the provider's
saved contact — never the guest. Every dispatch is tied to one guest issue
and one approval-gated activity record, and is bounded by cooldowns, a
rolling per-account allowance, and an idempotency key.

## Read-only evaluation and optional real-call rehearsal

For a no-send review, inspect the documentation and existing fictional screens
without entering a destination or authorizing a send. The separate **Find
businesses — no contact** panel performs lookup only, according to the author.
Do not confuse either inspection path with the rehearsal actions below.

The **Safe Call & Email Tests** page (`/communication-test`) is a dedicated,
consent-gated **real-send** rehearsal surface, not an offline/no-call demo:

1. Save your own phone/email as the test destination and confirm you own/
   consent to being contacted at that number/address.
2. Authorize one real send and pick a fictional scenario: owner-alert call,
   urgent-contractor call, or routine-contractor email.
3. Every send uses a fixed fictional script, a stable request id, and is
   capped at two calls plus one email per rolling 24 hours per account.
4. "Verify result" re-reads the provider's own terminal state (it never
   re-sends), so an unanswered or ambiguous call is never reported as a
   success.

A separate **Find businesses — no contact** panel runs the same real
AI/provider-lookup used for live dispatch, but only displays results; it
never contacts anyone.

There is no offline/mock mode for this page — every rehearsal send is a real,
capped, consent-gated CALL-E call/email to a destination you control.

## Confirmation for the submitted build

The hosted build always requires an explicit saved consenting contact, an
explicit "authorize one send" action, and the account's own allowance cap
before any rehearsal call or email is placed. There is no path from this page
to contacting anyone other than the saved test contact.

## Credential handling

CALL-E, Twilio, and email-provider credentials are stored only as private
Supabase server secrets; the browser client never sees them. Phone numbers
are normalized to E.164 server-side and are never logged alongside
credentials.

## Cancellation and duplicate-call protections

- Every dispatch reserves an idempotency key before contacting the provider,
  so a retried request cannot double-dial.
- A rolling per-account cooldown and a fixed 24-hour cap (two calls, one
  email) bound how many rehearsal or live sends can happen.
- Completion state is only ever accepted from an independently re-fetched
  provider callback, never assumed from the local create request.

## Phone-number handling

Numbers are normalized to E.164 and only ever displayed as the last four
digits in owner-facing UI; rehearsal recipients are restricted to the
account's own saved test contact.

## Boundaries

Auto Property Manager's CALL-E calls are explicitly scoped to routine
owner-alert and contractor-dispatch coordination for short-term rentals. They
are not emergency-response infrastructure: a guest reporting a life-safety
emergency is told to contact local emergency services directly, and the app
never claims to have dispatched emergency responders.
