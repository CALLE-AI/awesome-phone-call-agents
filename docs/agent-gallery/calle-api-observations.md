# CALL-E API Observations

Record of the de-risking call: one real outbound call placed to a consenting
team member's own phone to observe how CALL-E actually behaves before building
against it. It was placed while the app still targeted an appointment-recovery
workflow, which CareCall SG replaced. The API findings below are surface-level
and carried over unchanged; see [`product-spec.md`](product-spec.md) for the
decisions they froze.

Observed on 2026-08-04 through the `calle` CLI against
`https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`. Phone numbers are
masked here; the raw capture was kept outside the repository.

## Integration surface

CALL-E is **MCP**, not REST. This corrects the provisional decision recorded in
the product specification. Three tools matter:

| Tool | Purpose |
| --- | --- |
| `plan_call` | Plans a call; returns `plan_id`, `ready_to_run`, `confirm_summary`, and `confirm_token`. |
| `run_call` | Requires `plan_id` **and** `confirm_token`. Starts the call and returns a `run_id`. |
| `get_call_run` | Polls a `run_id` for `status`, `activity`, and `result`. |

### Plan-then-confirm is a built-in authorization gate

`run_call` cannot execute without the `confirm_token` that `plan_call` issued,
and the token expires (`confirm_expires_at`). The app's preview-then-authorize
flow therefore maps onto a real protocol boundary rather than being a
UI-only convention, and one token yielding one run supplies idempotency without
the app storing anything.

### The planner rewrites the goal

The submitted goal came back expanded inside `result.extracted.goal`, including
voicemail behavior that was never requested:

> If nobody answers, leave a short voicemail summarizing that ... is calling
> about rebooking the missed ... appointment and report back that nobody
> answered.

Leaving a voicemail is a real-world side effect, so the workflow must state its
own voicemail policy explicitly instead of letting the planner choose one.

## Result shape

`get_call_run` returns `result` with `summary`, `post_summary`, `outcome`,
`extracted`, `transcript`, `call_id`, `call_ids`, and `batch`.

### `outcome.task_completed` does not mean the business goal succeeded

This is the most important finding. On the observed call the customer accepted
no appointment and nothing was rebooked, yet CALL-E returned:

```json
{
  "task_completed": true,
  "completion_confidence": { "score": 0.9, "label": "high" },
  "evidence": [
    "The customer did not accept either approved replacement window.",
    "The customer asked about a discount, and the bot declined to discuss discounts as instructed.",
    "The bot clearly said the requested Saturday time could not be confirmed because it was outside the available windows."
  ]
}
```

`task_completed` reports that the call reached a clear end state, not that the
appointment was recovered. Mapping it directly onto a success outcome would
have made the app report a recovery that never happened. Business outcomes must
be derived from the conversation; `completion_confidence` is used only to route
to `uncertain`. See [`outcome.ts`](../../apps/typescript/agent-gallery/src/lib/outcome.ts).

### `extracted` carries no domain fields

There is no custom extraction schema on the input side. `extracted` echoed the
rewritten `goal`, `region`, `language`, `to_phones`, a `repair` block, and
`calling` timing metadata. It contained no agreed time and no SMS-confirmation
flag. Domain facts must be obtained by instructing the agent to state them
plainly and reading them back conservatively, defaulting to `uncertain`.

## Statuses and timing

Statuses seen: `PREPARING` then `COMPLETED`. The tool description also lists
`SCHEDULED`, `NO ANSWER`, `DECLINED`, and `FAILED`; the CLI treats `COMPLETED`,
`FAILED`, `NO_ANSWER`, `DECLINED`, `CANCELED`, `CANCELLED`, `VOICEMAIL`,
`BUSY`, and `EXPIRED` as terminal.

`DECLINED` is a telephony-level rejection of the incoming call, not a customer
refusing the offer. The two must not be conflated: a rejected call means nobody
had the conversation.

Timing on the observed run:

- 34 seconds from `run_call` starting to the phone ringing.
- 3 seconds from ringing to connection.
- 75 seconds of conversation.

The live-call screen must therefore stay informative through roughly half a
minute before anything audible happens.

## Activity feed

`activity` entries carry `ts`, `level`, `kind`, and `message`, and include live
transcript lines as the call proceeds, which makes a live transcript view
feasible. Entries include partial speech-recognition results that revise
themselves ("We are sent to a n Whoops"), so any live view must de-duplicate and
prefer settled lines.

## Conversational behavior

Policy constraints held under three separate probes. The agent refused a time
outside the offered windows, refused a discount request, and — the strongest
signal — rejected a proposed time that fell outside an otherwise valid window,
naming the reason.

One weakness: after each invalid proposal the agent deflected to "the front desk
will follow up" instead of restating the approved windows and asking the
customer to choose. It held the boundary but lost a recoverable booking, so the
goal text must include an explicit recovery instruction.

## Consequences for the application

1. Build the server integration on MCP, not REST.
2. Derive business outcomes from the conversation; never from `task_completed`.
3. Treat telephony `DECLINED` as unreachable, not as a customer decline.
4. Add a distinct outcome for a reachable, engaged customer for whom no approved
   window worked, since that is operationally different from both a refusal and
   an unreadable call.
5. State the voicemail policy explicitly in the goal.
6. Instruct the agent to restate the approved windows when an unavailable time
   is proposed.
7. Keep the live screen informative during the pre-ring delay.
