# Safety Contract

`mobilize` places real phone calls to real people via CALL-E. These rules
are enforced in code (`mobilize/core/policy.py`), not just documented here.

## Consent

The pool passed to `mobilize` must be people who consented to being
contacted for this purpose (a donor registry, a volunteer roster, an
on-call rotation). `mobilize` is not a cold-outreach or lead-generation
tool. If the user has not stated the pool is consented, ask before running
`mobilize_real`.

## Disclosure

Every call task prompt sent to CALL-E instructs the agent to identify
itself as an AI assistant at the start of the call
(`mobilize/transports/base.py::build_task_prompt`).

## Do-not-call

`add_do_not_call(candidate_id)` is permanent and immediate. A candidate who
asks to be removed, at any point including mid-call, must never be
dispatched to again for any future need. This is enforced by
`GovernanceState.do_not_call`, checked before every dispatch.

## Cooldown and contact fatigue

Default policy: at least 12 hours between calls to the same person, and no
more than 2 calls in a rolling 30-day window. These defaults exist because
contact fatigue is a documented cause of donor and volunteer registry
attrition -- see the README's cited literature.

## Calling hours

Default policy only calls between 08:00 and 21:00 local time. An explicit
`emergency_override=True` on `GovernancePolicy` bypasses this for genuinely
time-critical needs (e.g. an active medical emergency) and every override
should be logged with the reason.

## Call length and content

Task prompts are written to keep calls under 60 seconds and to end
gracefully on a decline. Do not modify the generated task prompt to extend
call length or add persuasive/pressuring language.

## Budget

`mobilize_real` never expands beyond the exact phone numbers the caller
supplies. There is no default pool size for real calls -- it must always be
explicit.
