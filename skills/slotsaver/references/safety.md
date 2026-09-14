# Safety notes

## Consent and scope

- A real call is only ever placed to a number on an explicit, operator-set
  allow-list. An empty allow-list means zero real calls can be placed,
  even with valid credentials.
- Every call task tells the agent to identify itself as the clinic's
  assistant at the start of the call — no impersonation of a human staff
  member.
- Every call task asks the agent to keep the call under ~45 seconds once
  it has an answer, and to thank the person and end the call rather than
  linger. This is a prompt instruction, not a server- or client-enforced
  cutoff — nothing outside the model following it forcibly ends a call
  at 45 seconds. The only actually enforced limit is the CALL-E client
  wait budget (`CALLE_TIMEOUT_SECONDS`, default 300s in the reference
  implementation).
- Every call task explicitly forbids pressing phone/DTMF keys and forbids
  waiting on hold. This was added after an early version of the task
  wording accidentally taught the agent to press keys on itself mid-call.

## Credential and data handling

- The CALL-E API key and any auth token used to trigger a run are read
  from server-side environment/secret storage only; neither is ever sent
  to, or readable from, any browser-facing page or API response.
- Any status page shows masked phone numbers (e.g. `+9182••••404`) and
  opaque integer IDs — never a full phone number or an internal token.
- Endpoints that can place a real call or start a real run are gated by a
  server-side token check using a constant-time comparison, to avoid
  leaking the token's value through response-timing differences.
- A minimal rate limit (a cooldown between calls, and a daily cap) applies
  even to an authorized caller, to bound the cost of a leaked or misused
  token.

## Idempotency and retries

- Each call attempt carries a fresh, unique idempotency key. A reused key
  returns CALL-E's cached result instead of placing a second call — treat
  this as long-lived, but do not assume a specific retention window or
  expiry either way. A key must never be reused across a legitimate
  retry, and a key must never be reused across separate runs (e.g. a real
  run and a dry-run/test run of the same date).
- Exactly one retry is attempted after a `no_answer`. A second `no_answer`
  is a terminal state (flagged for human follow-up) — the skill never
  auto-retries more than once.

## Ambiguous, wrong-person, and malformed results

- `wrong_person_or_unclear` (the call reached someone but couldn't
  confirm their identity, or the conversation was too ambiguous to
  classify) and a missing/malformed `structured_result` (no `outcome`
  field, a value outside the schema's enum, or the call never reaches
  `completed`) are both treated as "we don't know what happened," never
  as `no_answer` and never as `cancelled`/`declined`.
- Neither case gets an automatic retry, and neither one is allowed to
  free a slot, mark a cancellation, or advance the waitlist on its own.
  Both are flagged NEEDS-ATTENTION and require a human to reconcile the
  real outcome before any appointment/waitlist record changes on the
  strength of that call.
- A real appointment or waitlist state change is only finalized on a
  `structured_result` that both parses against the schema and reflects a
  confirmed recipient identity per `references/runtime-prompt.md`.
- See `references/runtime-prompt.md` and `references/examples.md` for
  the exact prompt wording and example payloads.

## Cancelling a submitted call

- Once a call has been submitted to CALL-E, this skill has no reliable
  way to cancel it in flight — the reference implementation doesn't
  expose, or depend on, an in-flight cancel endpoint. A submitted call
  can only be waited out, bounded by the client wait budget
  (`CALLE_TIMEOUT_SECONDS`); it should not be assumed to be abortable on
  demand.

## Scope

- This skill is limited to appointment scheduling: confirming,
  rescheduling, cancelling, and backfilling slots. It must never be used
  to give medical advice, triage symptoms, or handle a medical
  emergency. If a call surfaces anything outside rescheduling an
  appointment, the agent ends the call and the run flags it for a
  human — it does not attempt to help with it.

## Cancellation / rollback behavior for a recurring (scheduled) run

- A scheduled/automatic variant of this skill must default to **disabled**
  and require an explicit, separately-toggleable operator action to arm
  it — it is not safe to ship "on by default" since it rings real phones
  and spends real money without a human present.
- Arming/disarming must take effect without a redeploy (e.g. a runtime
  flag in shared storage), so an operator can disable it immediately if
  something looks wrong, without needing to touch code or wait for a
  deploy.
- A run in progress is guarded against being started twice concurrently
  (e.g. by both a manual trigger and a scheduled tick firing close
  together) with a short-lived lock, so the same patient is never called
  twice for the same run.
- A dry-run/test invocation must never be able to mark a real day's run as
  "already done" (which would silently skip the real scheduled run), and
  must never be allowed to start while a real run for that day is already
  in progress.

## Examples in this skill

All phone numbers in `references/examples.md` are fictional
(`+1555…`-style) placeholders, not real numbers.
