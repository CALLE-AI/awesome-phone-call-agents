# Reading a call

## Three questions, not one

A status word answers three questions at once and cannot keep them apart.

**How the call ended.** A person, a recording, a busy line, nobody, a number
that could not be reached. The Calls API cannot state this on its own. It can
once you declare `answered_by` in a per-recipient result schema.

**Whether the job got done.** `task_completed` states this, and it states it for
a voicemail box too. Its own definition is about the task reaching a clear end
state, which a voicemail box does.

**Where the answer came from.** A `structured_result` can be present and
schema-valid on a call that never connected, so a result proves a shape and not
a conversation.

Keeping them apart is the whole point. A call can end perfectly and fail its
task. A task can be met while the result is null. The pairing that costs money
is a job reported done on an ending where nothing establishes a person, and that
pairing is invisible if the three are collapsed into one field.

## Provenance on every reading

Each answer carries how it was arrived at.

**Quoted.** The payload stated it. `task_completed` is quoted. A declared
`answered_by` is quoted.

**Derived.** It was inferred from other fields, and the inference is named.
Reading an ending from an attempt failure code is derived, always, because the
codes are undocumented and two unreachable destinations produced two different
ones.

**Absent.** No field carries this fact. The value is unknown and that is the
answer, not a gap to fill.

Absent is the load-bearing one. A reading that cannot say "this surface does not
carry that fact" will invent the fact instead.

## Worked examples

**A recording answered and the job is reported done.** Ending reads
`answered_machine` if `answered_by` was declared, `answered_unspecified` and
absent if it was not. Outcome reads met, quoted. Both correct, and neither is
useful alone. The rule is about the pair: a task reported complete on an ending
that is not a conversation needs a person before anything acts on it.

**A call rang out and returned a result anyway.** Ending reads `no_answer`,
derived from the attempt code. Result reads unsourced, because the object exists
on a call whose status is not completed, so nothing in it came from speech.

**A call connected, ran, and the other side never spoke.** Status completed, no
failure code, result present, and zero turns from the other party. Result reads
unsourced on the turn count. A payload carrying no transcript at all is left
alone, because no transcript and an empty transcript are different facts.

**A call is still queued and has never been dialled.** Ending is unknown and
absent, because the call has not ended. If it has been open past the point
anything would still be waiting, that is the finding, and it outranks everything
else because it is the only one still happening.
