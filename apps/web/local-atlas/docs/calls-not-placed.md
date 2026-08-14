# The calls that are not placed

A safety pattern. Most of the work in a phone-call feature that touches strangers is
deciding not to dial. Every refusal below happens before a credit is reserved, and
each one exists for a different reason.

## Refuse because the answer already exists

A stored answer that has not expired is returned instead of dialling. This is the
largest single reduction in call volume, and it is not a cache — it is the point of
the feature. One visitor's call becomes every later visitor's fact.

Two conditions on it:

- **A deliberate recheck overrides reuse.** An answer can be wrong long before its TTL
  says so. The reader looking at the page may simply know better, so `force` bypasses
  the stored answer.
- **A private request never reads the shared list.** Serving one from a public answer
  would leak nothing, but it would answer a question about *your* Thursday with a fact
  somebody else collected on another day — and the reason to ask privately is that the
  general answer was not enough.

## Refuse because the question cannot be answered by phone

A phone agent can only return facts the person holding the phone knows. Refusing early
saves a credit and produces a better outcome than a call that was always going to fail:

| Refused | Because |
|---|---|
| Opinions — "best", "worth it", "should I" | The answer would be no better than the reviews already on the page. |
| Two questions in one | One answer slot; the caller loses half of it. A compound *object* ("high chairs and booster seats?") is fine, so the rule requires a verb after the conjunction rather than banning "and". |
| Anything about an account, order, refund, complaint or named person | Not what a stranger's front desk is for, and it invites the agent to invent a customer. |
| Card numbers, SSNs, passwords, home addresses, personal contact details | Never spoken on an automated call. |
| Abuse, threats, sexual content, slurs | A real person answers this phone. The gate applies to the operator too, not only to the public. |

Each refusal returns a nudge toward an answerable rewrite rather than a bare rejection,
because the failure mode to avoid is a user who concludes the feature is broken and
retries with something worse.

## Refuse because of when it is

- **Listed as closed.** The app already knows whether a place is open. `null` means
  unknown, and not knowing is not a reason to refuse — only an explicit false blocks.
- **Outside 10:00–20:00 Eastern.** This one is not about credits. A place can be open
  at 06:30 and still not want an automated call then; "technically open" is not the
  same as a reasonable moment to ring a stranger. Callers are US/Canada by
  construction, but the available clock is the server's, so the window is deliberately
  generous rather than precise.

Both rules are keyed on **the dialled number**, so the exemption for a demo line you
own cannot be triggered by a client setting a `demo` flag on a real business to call it
at 03:00.

## Refuse because it would be a duplicate

A 10-minute in-flight lock, plus an idempotency key derived from the authorization
rather than the attempt. Both are namespaced by account on the private path, because
two people asking the same place the same thing privately are two requests, and
collapsing them hands one person the other's answer.

## Refuse because the budget is spent

`CALLE_DAILY_CALL_BUDGET` is reserved *before* dialling, not decremented after. A
ceiling checked afterwards is not a ceiling.

## Refuse because nobody confirmed

The confirmation is a server-side gate returning HTTP 428 with the exact question, the
exact opening line, the exact disclosure and the number. Three things about where it
sits:

- **In the server, not the UI.** The endpoint is a public URL; hiding a button
  protects nothing.
- **After validation and moderation.** Asking someone to confirm a question that would
  then be rejected wastes their decision, and the preview must show post-sanitisation
  text or it is not a preview of what will be said.
- **Before budget reservation.** An abandoned confirmation should cost nothing.

## Default to not dialling at all

With no access code configured, every request produces a clearly-labelled simulated
answer. The default falls that way deliberately: a wrong or missing code must never
silently place a real call. One `live` flag decides it, and every later branch reads
that flag rather than re-deriving the decision.

## What is left

After all of the above, the calls that do happen are: a question nobody has asked
recently, that can be answered by phone, to a place that is open, during the day,
confirmed by a signed-in person who saw exactly what would be said. That is a small
number of calls, and each one produces something durable enough to justify having
made it.
