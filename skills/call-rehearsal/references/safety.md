# Safety notes

## A call is a real-world side effect, and so is what follows it

Rehearsing is not. This skill places no call, reads no credential, and opens no
network connection, so it can run before every call and on every commit.

The thing being made safe is the branch that runs afterwards. Treat any action
that dispatches, ships, charges, cancels, grants access, or writes a
confirmation into a system of record as requiring a verified, consenting yes,
and nothing weaker.

## Absent is not no

The single rule worth carrying away. A field the call never established is
absent from the result, and absent is falsy in every language anyone writes this
automation in. So:

- `not declined` is **true** when nobody answered.
- `confirmed != false` is **true** when voicemail picked up.
- `status != "refused"` is **true** when the line was busy.

Each of those ships the order because the phone rang out. Write the rule as a
positive test for the confirmation you need.

## Distinguish the four things that are not a yes

A result schema with one boolean cannot tell these apart, and downstream cannot
either:

| What happened | Why it is not a confirmation |
| --- | --- |
| Voicemail, no answer, busy | No person was reached at all. |
| A gatekeeper answered | The callee was never reached. |
| Someone else answered and agreed | The agreement came from the wrong person. |
| The callee refused to continue | There was no consent to act on. |

Give each of reachability, identity and consent its own field. Without them the
distinction is lost before the result reaches the automation, and no later audit
can recover it.

## Do not guess a field role

Which field carries the decision is a critical value, and this repository's
design principles say a workflow must not guess critical values. If the decision
field is unclear, ask the workflow owner rather than picking the
plausible-looking boolean. A wrong guess rehearses the wrong thing and then
reports a clean run, which is worse than no rehearsal.

`--suggest-fields` offers candidates for a person to choose between and selects
none of them.

## A required field the call cannot fill

If `result_schema.required` lists the decision field, then every ending that did
not establish it either violates the schema or gets filled with a value nobody
said. Require only what the call can always produce, such as how the call ended.

## What a clean rehearsal does not mean

The outcome library is a model of how calls end, not a recording of any real
one. A clean run means the plan survives those endings. It is not evidence about
extraction quality, phrasing, or any individual live call, and it does not
remove the need to listen to the first real calls a workflow makes.
