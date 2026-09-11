# KinCall

Consent-first phone check-ins that end with a named human, not a notification.

A voice agent calls someone who lives alone, has an ordinary conversation, and reports what
was said. What happens next is decided here — by pure functions, not by the agent. When the
check-in warrants it, the trusted circle is called one contact at a time until somebody
commits, and the monitored person is called back to be told who is coming.

**The agent interprets the conversation. This layer decides what happens.**

## Why the split matters

A voice model can hallucinate, underrate a risk, or behave differently after a version
bump. So it never decides who gets phoned. It fills a closed structured result, and every
subsequent step is a deterministic function of that result:

- a stated request for help **overrides** the agent's own "nothing seems wrong";
- uncertainty is never read as reassurance — an unclear check-in reaches the family;
- a check-in closes quietly only when *every* signal agrees;
- a vague "maybe, I'll try" is never recorded as a commitment;
- an exhausted circle ends **visibly** as "no confirmed support", never silently.

Every function is pure: no clock, no socket, no database. The same result always decides the
same way, on a first run and on a replay after a crash.

## What is in this directory

A self-contained, runnable extract of the decision layer, with tests and a local
walkthrough. There is no HTTP client anywhere in it, so **it cannot place a call**.

| File | Purpose |
| --- | --- |
| `src/types.ts` | The closed structured vocabulary a conversation is reduced to |
| `src/decision-tree.ts` | Should anyone be contacted at all — the ordered rules |
| `src/context-brief.ts` | What a trusted contact is told, in the person's own words |
| `src/cascade.ts` | Eligibility, ordering, and when the cascade stops |
| `src/outcome-message.ts` | What the monitored person hears at the end |
| `demo/run-local.ts` | One complete check-in, decided end to end |
| `test/workflow.test.ts` | 17 tests over all four stages |

The **full application** — Next.js interface, CALL-E integration, Postgres persistence,
crash recovery, dashboard and event timeline — lives at
<https://github.com/JuriSOK/kincall> (MIT).

## Setup

Requires Node.js >= 20. No credentials, no account, no database.

```bash
npm install
npm test        # 17 tests
npm run check   # tsc --noEmit
npm run demo    # a full check-in, decided locally
```

`npm run demo` prints a complete walkthrough: a person who asks for help with an
administrative document, a first contact who declines, a second who confirms, and the
sentence the person hears at the end. It reaches no network.

## Side effects

**This directory places no calls and creates no jobs.** It performs no I/O at all.

The full application can place real outbound CALL-E calls, and only then:

- calls happen **only** after `CALLE_MODE=live` is set explicitly *and* a CALL-E API key is
  supplied; the default mode places no call;
- live calls consume CALL-E credit;
- retries are bounded — at most two attempts to the monitored person, and at most two per
  trusted contact. A contact who answered and declined is never called again;
- the cascade stops immediately on an explicit confirmation;
- the closing callback to the monitored person is attempted **exactly once** and is never
  retried;
- there is **no recurring scheduler**. Schedule preferences are stored and displayed, but
  nothing runs unattended — a check-in is started by a person.

## Cancellation

There is no recurring job to cancel. In the full application, stopping the local process
stops all local execution, and a terminal event (`CASE_CLOSED` or `ATTENTION_UNRESOLVED`)
can never create another call.

## Credentials and phone data

- No credential is needed for anything in this directory.
- In the full application, phone numbers are read from the operator's own database — never
  from source. There is no hardcoded real-number fallback.
- Numbers are validated as E.164 and masked wherever they are displayed or logged.
- Numbers reserved for fiction are refused before any request leaves the process, so a
  half-configured profile fails loudly instead of dialling a stranger.
- Consent must be `confirmed` or no call is placed, in any mode.
- The fixtures here use no phone numbers at all.

## Boundaries

KinCall is not an emergency service and never contacts one. It does not diagnose, assess
severity, or give medical, legal or financial advice. A confirmed intervention is a
**recorded commitment**, not a verified action — it records that somebody said they would
help, and never claims that they did.

## Known limitations

- Voicemail cannot be reliably detected, so an unanswered callback and a voicemail are
  indistinguishable; delivery is reported as unconfirmed rather than guessed.
- The delay between a provider accepting a call and the phone ringing is external.
- This extract covers the decision layer only. Persistence, idempotency, leases and crash
  recovery live in the full application.
