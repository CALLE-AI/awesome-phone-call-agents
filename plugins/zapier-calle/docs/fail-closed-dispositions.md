# Fail-closed dispositions for phone-call outcomes

This pattern is about how to turn a phone-call provider's raw status
signals into a decision your workflow can branch on, without ever letting
ambiguity slide into a success branch. It applies to any platform that
places a call and later reports what happened: an n8n node, a Dify
workflow, a Zapier integration, or a bare script polling an API. The Zapier
CALL-E integration in this repository (`plugins/zapier-calle/lib/disposition.js`,
`plugins/zapier-calle/lib/flatten-result.js`) is used below as one concrete
example, not the subject of this document.

## 1. The problem

A call outcome is not a boolean. "Did the call succeed?" has at least four
distinct answers that all look like "not success," and they are not
interchangeable:

- **Transport failure.** The call never connected, or the provider's API
  itself returned an error placing or reporting it.
- **Task not completed.** The call connected and ran, but the provider's
  own judgment is that the objective was not accomplished (for example, the
  wrong person answered, or the conversation was cut off before the
  question was asked).
- **Low extraction confidence.** The call ran and the objective looks
  accomplished, but the provider is not confident in the structured data it
  pulled out of the conversation.
- **Result-schema validation failure.** The call ran, but the data
  extracted from it does not match the shape your workflow asked for.

An integration that branches on "did the API return a 2xx?" collapses all
four into one bucket, and worse, often collapses them into whatever the
default branch happens to be. If that default branch is "treat as success,"
a task that was never completed, or was completed with data your workflow
cannot trust, is reported to a human as done.

## 2. Signals the provider gives you

Design your classification around the raw fields the provider actually
sends, not around a single overall status. A call-outcome API generally
exposes several independent signals that need to be read together:

- **An event or notification type**, distinguishing "the call finished
  normally," "the call failed," and "the extracted result failed
  validation" as different kinds of event, not different values of the
  same status field. CALL-E's webhook sends exactly three:
  `call.completed`, `call.failed`, `call.result_validation_failed`.
- **A call status**, describing where the call itself is in its lifecycle.
  CALL-E's Developer API uses five lowercase values: `queued`,
  `in_progress`, `completed`, `failed`, `canceled`.
- **A completion flag**, separate from the status, saying whether the
  provider believes the objective was accomplished (CALL-E:
  `task_completed`).
- **A confidence label** on whatever data was extracted (CALL-E:
  `completion_confidence.label`).
- **Nullability of the structured result itself** - a call can complete
  with `task_completed: true` and still carry no structured result, or an
  empty one.
- **A failure code that is not a fixed enum.** Treat it as an opaque,
  unbounded string for logging and for a human to read, never as a value
  you branch on by exact match, since the provider can add new codes at any
  time (CALL-E: `failure_code`).

Classify on all of these together. Any single one of them, read alone, is
not the answer to "did this work."

## 3. The two vocabularies

Watch for a provider that documents more than one vocabulary for the same
concept across different surfaces - a REST/webhook API, a CLI, an MCP
server, a dashboard export - and confirm which one you are actually
consuming. CALL-E is a concrete example: its Developer API status field
uses five lowercase values (`queued`, `in_progress`, `completed`, `failed`,
`canceled`), while its CLI and MCP surface uses a different, uppercase
vocabulary that includes values such as `NO_ANSWER` and `VOICEMAIL` and
does not map one-to-one onto the API vocabulary.

State explicitly, in code and in your own docs, which vocabulary your
integration consumes, and enforce it - reject or fail closed on any value
from the vocabulary you did not choose. Silently accepting a value that
happens to look plausible but actually belongs to the other vocabulary is
how a wrong branch gets taken: a status meant for a human reading a CLI
table gets fed into a machine comparison it was never designed for.

## 4. The seven dispositions

Rather than exposing raw provider fields to the rest of your workflow,
collapse them into a small, closed set of dispositions and make every
downstream branch key off that set instead of the raw fields. CALL-E's
integration uses seven:

| Disposition | Actionable? | When it applies |
| --- | --- | --- |
| `confirmed` | Yes | The call completed, the provider marked the task completed, confidence was high, and a non-empty structured result was extracted. |
| `review_required` | No | The call completed but the task was not marked completed, confidence was not high, or the structured result was missing or empty. |
| `result_invalid` | No | The provider could not validate the extracted result against the schema you supplied. |
| `failed` | No | The call failed outright (a failure status or failure event). |
| `canceled` | No | The call was canceled before it completed. |
| `outcome_unknown` | No | The call is still in a non-terminal state, or the payload describing it was unreadable. |
| `needs_human` | No | Fail-closed default: a malformed event, an unrecognized event type, a missing or unrecognized status, or a callback that failed identity verification. |

Only one disposition is actionable without a human in the loop. Every
other disposition, including a `confirmed` call whose extracted data is
itself ambiguous (for example an enum value of `unknown`), is designed to
be read by a person before anything acts on it. The rule that makes this
table work is that **the default is `needs_human`**: every code path that
does not positively match one of the other six falls through to it, rather
than to `confirmed` or to a silent no-op.

## 5. Three rules

1. **The default branch is never success.** Whatever mechanism you use for
   "none of the above" - an `else`, a `default` case, a fallback route in a
   visual workflow builder - must resolve to a human-review state, never to
   the disposition that says the workflow can proceed unattended.
2. **An unrecognized value is never success.** A status, event type, or
   error code your integration does not recognize is not evidence of
   anything - not success, not a specific known failure. Route it exactly
   like a malformed payload: to fail-closed review. This is also what
   protects you from the provider extending its own vocabulary after your
   integration ships; a new status value should degrade to "needs a human,"
   not silently match whichever branch happens to catch unhandled strings.
3. **`outcome_unknown` is never `failed`.** A call that has not reached a
   terminal state has not failed - it just has not resolved yet. Treating
   "unknown" as "failed" is how a workflow ends up retrying, and therefore
   redialing, someone who may already have been reached. Keep it a distinct
   state from both `confirmed` and `failed`, and let a human or a
   reconciliation step, not an automatic retry, decide what to do about it.

## 6. Clarification is not failure

A provider that supports open-ended instructions may reject a call request
outright and ask a clarifying question instead of guessing at your intent.
CALL-E does this: it can reject call creation with `HTTP 422` and error
code `call_not_ready`, returning a `details.questions` array. Observed
live against the production API: a call placed to a Vietnamese phone
number produced a question asking whether the call should be conducted in
Vietnamese, rather than the provider silently guessing a language.

Do not fold this into your generic "request failed" handling. An
integration that maps every non-2xx response to a blanket failure discards
an answerable question and hands the person operating the workflow an
opaque error instead of the actual thing blocking progress. Treat a
clarification response as its own state: surface the question text to
whoever can answer it (a form field, a log line, a support queue), and let
them supply the missing information - a language, a region, a target
identity - rather than retrying blind or writing the request off as
broken.

## 7. Non-terminal does not mean failed

Do not infer failure from the absence of progress. Observed live against
the production API: a real call task remained at status `queued` for a
300-second polling window - through the phone ringing and being answered -
and never transitioned to `in_progress`, let alone a terminal status,
within that window.

An integration that infers failure (or success) from a status simply not
having changed yet will conclude the call did not happen, when in fact it
may already be in progress or even finished from the recipient's point of
view. This is the strongest argument for keeping a distinct
`outcome_unknown` state rather than collapsing it into `failed`: reaching
that state does not license a retry, and a retry on an unresolved call is
how a real person gets dialed twice. Where the platform supports it, prefer
a callback or webhook delivered when the provider reaches a terminal state
over polling a status endpoint - it removes the window in which "no update
yet" can be misread as "nothing happened."

## 8. Idempotency

Retries and duplicate triggers are inevitable in any workflow platform.
Key your idempotency guard on a digest of the canonical request payload -
the task instructions, the recipient, and any result schema - not on a
workflow-run identifier or trigger ID. A workflow ID is unique per attempt
even when the underlying request is identical, so keying on it does nothing
to prevent a duplicate call caused by the platform re-running the same
step. Canonicalize the payload (stable key ordering, consistent
serialization) before hashing, and exclude fields that legitimately differ
per run but do not change what the call is - a freshly generated callback
URL is the clearest example, since minting a new one on every attempt would
otherwise make an identical retry hash differently and place a second call.

## 9. Verifying the callback

A callback URL delivered to a third-party provider is generally
unauthenticated: anything that discovers the URL can post to it, so its
mere arrival is not proof it describes the call you actually started.
Before trusting a callback body as the outcome of a specific call, confirm
it references an identifier your workflow recorded when it placed that
call (a call ID, a correlation ID) and that the two match exactly. If the
identifier your workflow started with is unknown, if the callback carries
no identifier, or if the two differ, treat the callback the same as any
other unverifiable input - route it to the fail-closed review disposition
rather than accepting its contents as the result of your call.

## 10. How to test it

The property worth asserting is not "each disposition returns the right
string for a given input" in isolation, but a single global invariant
checked across every input you can construct: **no input produces an
actionable/success result except a fully agreeing terminal success** -
every signal (status, completion flag, confidence, non-empty valid result)
has to agree before the actionable disposition is returned, and any one
of them disagreeing, missing, or unrecognized has to fail closed. Write
that as one test that exercises malformed events, unrecognized statuses,
unrecognized event types, and partially-populated payloads, and assert
none of them produce the actionable disposition.

Separately, assert that a dry-run or preview code path makes zero network
requests and generates no side-effecting resources (no callback URL, no
call placed) - a dry run that quietly still performs the real action
defeats the entire point of offering one.

See `plugins/zapier-calle/lib/disposition.js` for a fail-closed classifier
built around these rules, and `plugins/zapier-calle/test/disposition.test.js`
for the invariant-style tests described above.
