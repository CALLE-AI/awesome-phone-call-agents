# Safety Notes

Safety properties of `emergency-dispatch-relay`, why each exists, and the
failure modes they exist to prevent.

## Purpose boundary

The skill carries a **human-confirmed dispatch decision** to a response unit
by phone and brings back a structured answer. It never selects units, never
reassigns cases, never instructs movement, and never escalates on its own.

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
constraints bound the drift.

**Failure mode prevented:** an AI voice giving a lawful order it cannot give,
or negotiating a reassignment mid-call.

## Unknown over guesswork

The result schema is tri-state (`yes | no | unknown`). Noisy lines, dropped
calls, and unsure officers produce `unknown`, which is returned to the human
dispatcher rather than silently retried.

**Failure mode prevented:** a fabricated "yes" or invented ETA flowing into a
console that treats it as ground truth.

## Preview parity

Default mode prints the byte-identical payload `--real` would send, with zero
side effects. Anyone can audit exactly what the agent will say, to whom, in
which language, before a phone ever rings.

**Failure mode prevented:** unreviewable call behavior — the classic
"what did the agent actually say?" incident.

## Bounded side effects

One call per invocation, capped at two minutes by the goal text. No
scheduling, retries, or recurrence live inside the skill; recurrence belongs
to the host scheduler (provider/host separation per repository principles).

**Failure mode prevented:** runaway retry loops dialing an emergency channel,
and duplicate calls on client timeouts.

## Numbers and privacy

Phone numbers arrive via flags or environment variables only; samples and
documentation use masked placeholders. The skill makes no assumptions about
who owns the number — consent and contact-list authorization are upstream
concerns of the caller (see `service-dispatch-call`'s authorized-contact
boundary for the vendor analogue).

**Failure mode prevented:** personal or duty numbers leaking into committed
code and logs.
