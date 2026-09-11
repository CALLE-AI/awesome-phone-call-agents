# Safety

Phone calls and the actions they authorize are real-world side effects. This skill sits
*after* the call and decides whether it is safe to act. It does not place calls, hold
resources, write calendars, send SMS, or run on a schedule. The rules below are the
contract for the integration that wraps it.

## Explicit user intent before any real-world action

Verity never triggers a write. It returns `ALLOW` or `BLOCK`. Your integration must
have the user's explicit intent for **this recipient and this value** before it places
the call, and must treat `ALLOW` as *permission to proceed*, not as the write itself.
On `BLOCK` the integration confirms the `repair_target` on a second channel or routes
to a human — it does not retry for a different answer.

`decide()` is fail-closed by construction: a missing field, an unexpected shape, or any
thrown error resolves to `BLOCK`. `task_completed == true` is necessary, never
sufficient — E3 (parsed value exactly matches the action's value), E4 (an in-transcript
confirmation), and E6 (a fresh resource re-check) must also hold.

## Phone numbers

- Recipients are **E.164** (`+` country code + subscriber number, no spaces or
  punctuation). This skill does not parse or dial numbers; when it echoes one for a
  preview it is **masked** (`+*********67`), and it never puts a number in a log line,
  a summary, or a `reason_code`.
- `preview_gate.py --recipient` only ever prints the masked form.
- The bundled fixtures use the reserved fictional `+1 555 0100`-style range.

## Masked numbers in summaries and logs

`evidence_refs` carries only turn indexes and field names — never quoted transcript
text, never a phone number. `reason_detail` is a short machine string. If you log the
skill's output, it is already free of PII; keep it that way when you add context.

## No credential exposure

This skill has **no code path that reads, receives, or transmits a credential**. It
operates purely on the call snapshot you hand it. When your integration calls CALL-E,
keep `CALLE_API_KEY` server-side only — never in a client bundle, a webhook URL, a log,
or a response body. See [`calle-handoff.md`](calle-handoff.md).

## No hidden recurring schedules

This skill runs once per call snapshot, synchronously, and returns. It has no timer, no
cron, no "check back later". It cannot create a recurring job. If your integration
schedules follow-up calls, that recurrence is yours to make visible and cancellable.

## No duplicate booking jobs

`decide()` is a pure function of its input; calling it twice on the same snapshot
returns the same verdict and changes nothing. It authorizes at most one action per
verified call. Idempotency of the *action itself* (e.g. keying a booking on
`slot_id + hold_id`) is the integration's responsibility; a deterministic
`verity:{verification_id}:v1` idempotency key for the CALL-E create is shown in the
preview.

## Cancellation behavior

There is nothing to cancel inside this skill — no held resource, no pending call, no
scheduled job. On `BLOCK`, the integration should release any hold it placed after the
grace window, or hand the verification to a human. A `BLOCK` must never fall through to
the write.

## Medical, legal, financial, and emergency boundaries

**Verity does none of these and must not be used for them.** It is scoped to verifying
routine scheduling outcomes (confirm / reschedule / book an appointment slot). Do not
use it to gate or interpret:

- medical triage, diagnosis, medication, or clinical instructions;
- legal advice, rights, or obligations;
- financial advice, credit, payments, or account changes;
- emergencies, safety-of-life situations, or anything time-critical where a blocked
  verification could cause harm.

If a call's content strays into these areas, stop and route to a qualified human. The
gate's `BLOCK` is a "do not act automatically" signal, not a substitute for human
judgment in a high-stakes domain.
