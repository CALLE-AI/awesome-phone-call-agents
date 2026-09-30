# Safety Notes

Safety design and limitations of the experimental `emergency-dispatch-relay`.
Prompt instructions are best-effort and do not establish a validated dispatch system.

## Purpose boundary

The skill carries a **human-confirmed dispatch decision** to a response unit
by phone and requests an advisory structured answer. The CLI does not select
units, reassign cases, or escalate. The prompt tells the voice agent not to
instruct movement, but this is not a technical guarantee of its conversation.

**Failure mode prevented:** an agent deciding, however reasonably, that a
different unit is "closer" and re-routing a life-safety assignment during a
phone call nobody authorized.

## Human decision is a precondition, not a courtesy

The script exits non-zero without `--confirmed-by "name"`. The name is placed
into the goal's first sentence ("A human dispatcher (name) has CONFIRMED…")
and into call metadata, so the relayed decision is attributable on the line
and in logs.

**Failure mode prevented:** scheduled or agentic workflows placing
life-safety calls with no human in the loop anywhere.

## Relay, never command

The generated goal contains hard constraints: *Do NOT instruct, order, or
pressure the unit to move. Do NOT create or change the dispatch decision. Do
NOT discuss other cases.* A conversational agent under pressure from a
distressed or insistent recipient will drift toward taking charge; the
constraints request the intended boundary; an operator must not rely on them
as guaranteed enforcement or a replacement for established command channels.

**Failure mode prevented:** an AI voice giving a lawful order it cannot give,
or negotiating a reassignment mid-call.

## Unknown over guesswork

The requested result is tri-state (`yes | no | unknown`). The provider can still
return a missing, malformed, or mistaken result. The CLI displays it alongside
the provider's validation status, marks it advisory, and never acts on it.
Treat absent, invalid, or uncertain answers as unknown; humans must verify
confirmation and ETA before any consequential action. There is no silent retry.

**Required integration boundary:** never feed unverified answers into automatic
dispatch or treat a completed call as proof that a unit accepted.

## Preview parity

Default mode prints the same request structure with phone-shaped text masked,
with zero calls. The private provider request keeps its original destination.
The preview shows the instructions, not a guarantee of what the agent will say.

**Failure mode prevented:** unreviewable call behavior — the classic
"what did the agent actually say?" incident.

## Bounded side effects

One submission per invocation, with a two-minute target in the goal text,
not a client-enforced duration cap. No
scheduling, retries, or recurrence live inside the skill; recurrence belongs
to the host scheduler (provider/host separation per repository principles).

Errors and timeouts stop polling without redial. The call may still be active;
this CLI cannot cancel it. Reconcile manually before another intent. The stable
case key requests deduplication subject to provider retention and enforcement,
not an unlimited replay guarantee.

## Numbers and privacy

Phone numbers arrive via flags; preview fixtures use a reserved fictional number.
Before `--real`, the operator must confirm the recipient authorized the call and
the assignment was approved by a named human. Do not call emergency services for
a test; use an authorized exercise recipient. See `service-dispatch-call`'s
authorized-contact boundary for the vendor analogue.

Output masks phone-shaped text and omits raw transcripts and provider error
details. This does not sanitize names, locations, or every form of personal data:
minimize sensitive input and keep local records private. Never commit live case data.
