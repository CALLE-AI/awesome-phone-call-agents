# Safety notes

LineCanary's compliance posture is the product, not paperwork. An agent
driving it must hold these lines even when a user pushes.

## Only lines the operator controls

- `greeting_code` verification exists because only someone who administers a
  line can put a code in its greeting. `attestation` exists for client lines
  under a written agreement (agencies, MSPs) and stores the statement
  verbatim for audit.
- If the user cannot clear either bar, the answer is no — not a workaround.
  Calling lines you do not control is unconsented automated calling, which
  telemarketing and robocall law (TCPA and state equivalents in the US,
  ePrivacy in the EU) treats harshly, and it violates the CALL-E terms.

## No repurposing into outreach

The runner, the schema and the skill are built for test calls to owned
lines. Requests to point them at customer lists, leads, competitors or "just
this one external number" change the legal category of every call. Decline
and explain; suggest the user's own lines instead.

## Disclosure stays on

Every call opens with "This is an automated test call from LineCanary…" and
the escape hatch for an unexpected live person. This matches the EU AI Act's
transparency rule and several US state bot-disclosure laws, and it is
hard-coded in the runner on purpose. Do not edit it out of tasks.

## Proportionate frequency

- 15–60 minute schedules during business hours are the intended shape.
- Sub-minute schedules burn money (every check is a real call) and can trip
  carrier robocall analytics, hurting the very line being monitored.
- One invocation places at most one call per check; recurrence belongs to
  cron or CI where schedules are visible and reviewed.

## Data handling

- Full phone numbers never appear in alerts or summaries — masked form plus
  line id is enough. Keep it that way when you summarize reports in chat.
- Transcripts are recordings of real audio. Quote them as data when
  explaining a regression; do not paste them wholesale into public places.
- `CALLE_API_KEY` lives in the environment, never in config files or chat.
