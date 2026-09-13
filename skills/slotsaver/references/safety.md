# Safety notes

## Consent and scope

- A real call is only ever placed to a number on an explicit, operator-set
  allow-list. An empty allow-list means zero real calls can be placed,
  even with valid credentials.
- Every call task tells the agent to identify itself as the clinic's
  assistant at the start of the call — no impersonation of a human staff
  member.
- Every call task caps itself under ~45 seconds and instructs the agent to
  thank the person and end the call as soon as it has an answer — no
  lingering on the line once the outcome is known.
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

- Each call attempt carries a fresh, unique idempotency key. Because
  CALL-E dedupes a reused key server-side forever, a key must never be
  reused across a legitimate retry, and a key must never be reused across
  separate runs (e.g. a real run and a dry-run/test run of the same date).
- Exactly one retry is attempted after a `no_answer`. A second `no_answer`
  is a terminal state (flagged for human follow-up) — the skill never
  auto-retries more than once.

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
