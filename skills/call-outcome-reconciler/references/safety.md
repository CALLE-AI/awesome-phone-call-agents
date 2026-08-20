# Safety

## This skill places no calls

It reads the status of a call reference the caller already created. It does not
plan, place, retry, or cancel a call, and it holds no recipient list. The
strongest safety property here is an absence: there is no code path that dials
anybody.

That also means the usual consent question does not arise at this layer.
Consent, recipient selection, and call content are decided before a call
reference exists. This skill only answers how an existing call ended.

## Explicit user intent

Reconciliation acts on a call reference supplied by the caller. It initiates
nothing on its own and discovers no new work. If no call reference is supplied,
nothing happens.

## Phone numbers

* Use fictional E.164 numbers in examples and fixtures. This skill's examples
  use `+15550101234`.
* Every human-readable line masks the recipient: `+1555010****`.
* The full E.164 number stays wherever the caller already holds it. This layer
  does not persist it.

**One caveat worth stating plainly.** An outcome record preserves the upstream
payload verbatim, because raw fidelity is a core guarantee. If upstream returns
an unmasked phone number in that payload, it is in the record. Treat an outcome
record as data at the same sensitivity as the upstream response: safe to store
where you already store call data, not safe to paste into a public issue. Mask
or redact before sharing one. The `explain` view is safe to share — it prints
the masked recipient and never the raw payload.

## Credentials

* Credentials are read from the environment (`CALLE_API_KEY`) or from the token
  cache written by `@call-e/cli`. They are never logged, printed, or persisted
  by this skill.
* Never ask a user to paste a token into chat.
* `CALLE_API_KEY` is only ever sent to `https://api.heycall-e.com` or to
  loopback. The base URL is checked **before the key is read**, so a mistyped or
  hostile host cannot leak it — by the time a warning could be read, the
  credential would already have left. Host matching is exact: a suffix like
  `api.heycall-e.com.attacker.example` is refused, and https alone is not
  accepted as trust, because it attests the transport and not who answers.
* Authentication is re-checked before every poll cycle, since a token can expire
  mid-poll.
* The default test suite uses a local fake server and requires no credentials at
  all. Test fixtures are sanitized and contain no real identifiers.

## No hidden or recurring work

* No schedules are created. No jobs run in the background.
* Polling runs in the foreground and stops when interrupted. There is nothing to
  cancel afterwards.
* Reconciling the same call reference twice is safe and side-effect free: it
  produces a new record from fresh observations.

## Stop rather than guess

The central safety property. An undocumented status value is never translated
into a semantic outcome. When the public contract does not answer the question,
the outcome is `unresolved`, carrying the reason and the raw payload, and the
caller decides what to do.

This matters most where guessing is most tempting. A zero-duration call reported
as declined looks like a person refusing, but carries no evidence that anybody
heard it. This layer will not report that as `declined`.

## Sensitive domains

Outcome reconciliation is content-agnostic: it reads status fields, not
conversation content, and makes no judgement about what a call was for. It
therefore gives no medical, legal, or financial advice and must not be used as
part of an emergency escalation path. If a call was placed for a sensitive
purpose, the decision about what an `unresolved` outcome means belongs to a
human, not to downstream automation.

## Downstream use

An `unresolved` outcome is not a failure and must not be silently coerced into
one. Automation that treats `unresolved` as `completed`, or as `declined`,
reintroduces exactly the ambiguity this layer exists to remove. Route it to a
human, retry the read later, or record it as unknown.
