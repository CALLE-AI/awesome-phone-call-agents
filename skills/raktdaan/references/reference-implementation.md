# Wiring it to CALL-E

The runner takes an injected `dial` callable, so the fixture harness and a live
run share one code path. Everything below is one implementation of that callable.

```python
Dialler = Callable[[Donor, Request], CallOutcome]
```

## Verified behaviour

The notes below come from a real call placed to an Indian number on 2026-09-03,
not from the documentation. They are the things worth knowing before wiring this
up.

- **India works, over international lines.** Region `IN`, +91, languages English,
  Hindi and Tamil. The platform documents international routing as intended for
  testing; production needs a local line requested from CALL-E.
- **`plan_call` validates a destination without dialling and without spending a
  call.** Run it first. It returns `ready_to_run`, a `plan_id`, a
  `confirm_token`, and a `display_goal` that shows exactly how the goal was
  understood. If the constraints you wrote are missing from `display_goal`, they
  will not be honoured on the call — check before running.
- **`run_call` requires the exact `plan_id` and `confirm_token`.** Nothing dials
  until a plan has been produced and explicitly confirmed. This maps directly
  onto the skill's dispatch gate; do not build a wrapper that hides it.
- **`PREPARING` lasts a while.** In the observed run, roughly two minutes elapsed
  between `run_call` and the phone ringing. Poll `get_call_run`, do not assume a
  stall.
- **There is no webhook on the MCP path.** Poll. The `next_step` block tells you
  how long to wait (`poll_after_seconds`, observed as 10).
- **The MCP path returns a transcript, not schema-validated fields.** `outcome`
  carries `task_completed` and `completion_confidence` (observed `0.9 / high`),
  and `activity` carries the turn-by-turn transcript. It does **not** return a
  typed `{will_donate, arrival_window}` object. Grading is therefore done from
  the transcript, by the rules in `reading-the-answer.md`. If you want typed
  extraction, use the SDK.
- `completion_confidence` scores whether the *task* completed, not how firm the
  donor's commitment was. Do not use it as a commitment signal.

## MCP path, via the CLI

```bash
npm install -g @call-e/cli
calle auth login          # brokered OAuth, caches a token locally
calle auth status
calle mcp tools           # plan_call, run_call, get_call_run
```

Plan first — this costs nothing and confirms the destination is supported:

```bash
calle call plan \
  --to-phone +91XXXXXXXXXX \
  --region IN --language Hindi \
  --goal "$GOAL"
```

Then dial with the returned identifiers:

```bash
calle call run --plan-id <plan_id> --confirm-token <confirm_token>
calle call status --run-id <run_id>          # poll until COMPLETED
```

`calle call recover` exists for the case where a `run_call` submission is
uncertain — a timeout after dispatch, say. Use it instead of retrying
`run_call`, which is how you accidentally ring a donor twice.

## SDK path, for typed extraction

Use this when you want the donor's answer as a validated object rather than
transcript text. The `result_schema` is where the skill's grading vocabulary
belongs.

```python
from calle import CalleClient

client = CalleClient(api_key=os.environ["CALLE_API_KEY"])

call = client.calls.create_and_wait(
    task=goal_text,
    result_schema={
        "type": "object",
        "required": ["commitment"],
        "properties": {
            "commitment": {
                "type": "string",
                "enum": ["confirmed", "declined", "unclear", "no_answer"],
                "description": (
                    "confirmed ONLY if the donor agreed AND gave a specific "
                    "clock-time arrival window. Agreement without a window is "
                    "unclear. A hedge such as 'I'll try' is unclear even when "
                    "paired with yes."
                ),
            },
            "arrival_window": {"type": "string"},
            "opt_out_requested": {"type": "boolean"},
        },
    },
)
```

The `enum` descriptions carry the grading rules into the extraction step, which
is the difference between a typed field and a trustworthy one. Still apply
`commitment.grade()` to the transcript as a cross-check and take the stricter of
the two answers.

## The adapter

```python
def make_dialler(place_call) -> Dialler:
    """place_call(donor, goal, language) -> (transcript, answered)"""

    def dial(donor: Donor, request: Request) -> CallOutcome:
        goal = build_goal(request)                    # see safety.md
        transcript, answered = place_call(donor, goal, donor.language)
        state, _why = commitment.grade(transcript, answered=answered)
        if commitment.wants_opt_out(transcript):
            register.mark_opted_out(donor.ref)        # before the run continues
        return CallOutcome(
            donor_ref=donor.ref,
            commitment=state,
            arrival_window=transcript if state == CONFIRMED else None,
            transcript_ref=store_transcript(transcript),
        )

    return dial
```

Two things the adapter must get right:

1. **Return an outcome for the donor it was asked about.** The runner raises if
   `outcome.donor_ref` does not match, because a mismatch means a confirmation
   was credited to the wrong person.
2. **Write opt-outs back before the next dispatch**, not at the end of the run.

## Idempotency

Pass an idempotency key derived from the request and donor — `{request.ref}:{donor.ref}`
— on any path that supports it. A retried dispatch that reaches the platform
twice is a donor rung twice, which is the exact failure the anti-fatigue budget
exists to prevent.

## Telemetry

`DO_NOT_TRACK=1`, `CALLE_TELEMETRY=0`, or `--no-telemetry` on the CLI.
