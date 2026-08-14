# Safety

Phone calls have real-world side effects (they cost money and reach real people),
and escalation calls are, by design, high-stakes. These rules are non-negotiable.

## Rules

- **Allowlist only.** Place calls only to numbers explicitly registered in the
  escalation chain. Never dial an unknown, guessed, or unconsented number, and
  never guess a country code — ask if a number is ambiguous.
- **AI disclosure on every call.** The call goal opens with an identification line,
  e.g. "This is an automated readiness assistant calling on behalf of <org>."
- **Consent.** Responders opt into the on-call chain in advance. This skill is for
  people who expect these calls, not the public. Do not add a third party to the
  chain without their documented prior consent.
- **Human decides.** The call delivers a classification + recommendation and
  requests acknowledgment. It never makes the operational or medical decision. For
  health/readiness use, language stays **non-diagnostic** — state the flag and the
  recommendation; do not diagnose.
- **Fail toward escalation.** Anything short of a clear, confident acknowledgment
  (declined, no answer, voicemail, ambiguous, low confidence) is treated as *not
  acknowledged*, and the chain advances. Never silently close an alert.
- **Nothing hidden.** Every attempt (reached / declined / acknowledged) is logged
  with responder, timestamp, and the structured result. Chain exhaustion escalates
  to the alert owner out-of-band; escalations are visible to that owner.
- **No exposed secrets.** Auth is the CALL-E CLI browser-login state — no API keys
  in code, config, or logs. Do not print tokens or personal data.

## Cancellation / rollback

This is a recurring, multi-leg workflow. To stop an in-progress escalation, mark
the alert acknowledged/closed in the owning system before the next leg dials — the
skill checks alert status between legs and halts. There is no way to recall a call
already placed; the guardrail is the between-legs status check plus the allowlist.
