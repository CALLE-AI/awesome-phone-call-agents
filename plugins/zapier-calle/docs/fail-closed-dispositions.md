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
- **A numeric confidence score**, which is often the stricter of the two.
  CALL-E declares `completion_confidence.score` as required and bounded 0-1,
  while `label` is documented only by example ("for example `low`, `medium`,
  or `high`") - so the label is the looser, unenumerated field. Checking only
  the label accepts a `high` carrying a score of 0.05. Check both, and make
  the floor configurable rather than hard-coding a number the provider never
  published.
- **Nullability of the structured result itself** - a call can complete
  with `task_completed: true` and still carry no structured result, or an
  empty one.
- **The values inside the structured result**, not just its presence. See
  section 5 below; this is the signal most integrations skip.
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

## 4. The ten dispositions

Rather than exposing raw provider fields to the rest of your workflow,
collapse them into a small, closed set of dispositions and make every
downstream branch key off that set instead of the raw fields. CALL-E's
integration uses ten:

| Disposition | Actionable? | When it applies |
| --- | --- | --- |
| `confirmed` | Yes | The call completed, the provider marked the task completed, both the confidence label and the numeric score cleared their thresholds, and every field the caller declared required came back with a usable value. |
| `review_required` | No | The call completed but the task was not marked completed, confidence was not high enough by label or by score, or the structured result was missing, empty, or carried no usable answer. |
| `result_invalid` | No | The provider could not validate the extracted result against the schema you supplied. |
| `failed` | No | The call failed outright (a failure status or failure event). |
| `canceled` | No | The call was canceled before it completed. |
| `outcome_unknown` | No | The call is still in a non-terminal state, or the payload describing it was unreadable. |
| `needs_human` | No | Fail-closed default: a malformed event, an unrecognized event type, a missing or unrecognized status, or a callback that failed identity verification. |
| `outside_calling_window` | No | The integration refused to place the call at all, because doing so would fall outside a configured quiet-hours window. See [Pre-flight refusals](#pre-flight-refusals) below - this one is not like the other seven. |
| `suppressed` | No | The integration refused to place the call at all, because the recipient matched an entry on a caller-supplied do-not-call list. See [Pre-flight refusals](#pre-flight-refusals) below - like `outside_calling_window`, this one is not like the other seven. |
| `retry_policy_blocked` | No | The integration refused to place the call at all, because the caller-supplied attempt history shows it would exceed a per-day cap or a minimum interval between attempts. Also a [pre-flight refusal](#pre-flight-refusals). |

Only one disposition is actionable without a human in the loop. Every
other disposition is designed to be read by a person before anything acts
on it. The rule that makes this table work is that **the default is
`needs_human`**: every code path that does not positively match one of the
other six outcome-of-a-call dispositions falls through to it, rather than
to `confirmed` or to a silent no-op.

### Branching on ten values is its own problem

A closed vocabulary is right for correctness and wrong for ergonomics. Ten
string values is a wall of configuration in a visual workflow builder, and
it forces every person who builds one to re-derive which values are safe to
act on - a derivation that is the integration's job, not theirs. Publish a
coarse projection alongside the precise one. CALL-E's integration emits
`lead_state`, which is exactly three values: `qualified` (only
`confirmed`), `blocked_compliance` (the three pre-flight refusals, plus any
call where consent was revoked), and `needs_human` (everything else,
including an unrecognized disposition). Nothing is lost, because the full
`disposition` and `disposition_reason` stay on the output for anyone who
needs them.

### Pre-flight refusals

Seven of these ten dispositions classify a call that happened: the
provider ran it, and the result - success, failure, ambiguity - is being
read back. `outside_calling_window`, `suppressed` and
`retry_policy_blocked` are a different kind of thing. Each is produced
**before dialing**, by the integration itself rather than by the provider,
when a policy the integration enforces - a quiet-hours window, a
do-not-call list, or a retry cap - says the call should not be placed right
now. CALL-E's `deriveDisposition` classifier - the function that turns a
webhook event into one of the other seven values - never returns any of
them; nothing about them comes from a call outcome, because no call was
placed.

The general principle behind both: a refusal to place a call is a distinct
outcome from any result of a call, and collapsing the two loses
information the workflow needs. A workflow that cannot tell "the call
failed" from "the call was never attempted because it would have violated
policy" ends up either retrying a policy refusal on the next scheduled run
(masking the policy as a transient failure) or, worse, treating a policy
refusal as equivalent to a successful call because neither one is
`failed`. Give every pre-flight refusal its own disposition, keep all of
them out of the vocabulary your provider's callback can produce, and route
each one somewhere a human or a later retry step can see why the call
never happened.

## 5. A present result is not a usable result

This is the check most integrations skip, and it is the one that lets an
ambiguous call reach a success branch even after everything in section 4 is
implemented correctly.

The mistake is to treat the structured result as a boolean: it exists, so
the call worked. But a good extraction model does not fail when the call
produced no answer - it succeeds at reporting that there was no answer.
CALL-E's own schema guidance says so directly: *"Prefer string enums over
booleans for business decisions that may be unclear, and include an
`unknown` enum value when the call may not provide enough evidence."* Follow
that advice and the provider will hand you `{"qualified": "unknown"}` with
`task_completed: true` and a `high` confidence label - because it is
genuinely confident that the caller never answered the question.

Every signal in section 4 agrees. The call is a success by every field the
provider sends. And the answer is not there.

So check the values, not just the envelope:

1. **Reject unknown-like values.** Whatever token set your schema convention
   uses (`unknown`, `unclear`, `not_stated`, `undetermined`), a required
   field carrying one of them is not an answer. Compare case-insensitively
   and after trimming.
2. **Reject empty values** - `null`, `""`, `[]`, `{}`. But note that `false`
   and `0` are *answers*, not absences. A guard written with a truthiness
   test throws away every legitimate "no" and every legitimate zero. This is
   the single easiest bug to write here.
3. **Enforce the caller's own `required` list**, where you have it. If the
   workflow declared a field required and the provider did not return it,
   the contract the workflow was written against is not satisfied, whatever
   the provider thinks of the call.
4. **Only check what was required.** An optional field coming back `unknown`
   is not a defect; the caller said it was optional.

There is an asymmetry worth designing for: some surfaces know the schema and
some do not. An action that placed the call has the `result_schema` it was
placed with and can do all four checks. A webhook trigger reacting to a call
placed from a CLI, an MCP tool, or someone else's workflow has no declared
contract to compare against - it can still do checks 1 and 2 on the values
it can see, but it cannot detect a *missing* field, because nothing told it
what should have been there. Give each surface the strongest check it can
support rather than lowering all of them to the weakest.

Finally: if you also ship tooling that tells authors to add an `unknown`
enum member - a linter, a template, a docs page - and your runtime then
treats that value as a success, the two halves of your product contradict
each other. Check the value.

## 6. Revocation of consent is not a call outcome

If the person says "stop calling me," that fact is in the transcript and
nowhere else. It will not appear in the status, the completion flag, the
confidence, or the structured result unless you explicitly asked for it -
and the call may otherwise be a complete success, with every required field
answered. An integration that classifies only the business outcome will
report `confirmed`, and the workflow will advance the outreach sequence for
someone who just asked never to be contacted again.

Three design points:

- **Surface it as its own field, not as a disposition value.** It is
  orthogonal to whether the call produced an answer - both can be true at
  once - so it needs to travel alongside the outcome, with the quote and its
  offset into the call so a human can verify it.
- **Let it override actionability.** Whatever the business result was, the
  call must not be actionable and must route to the compliance branch. The
  extracted result stays on the output for whoever handles it.
- **Scan only the recipient's turns.** State bot-disclosure laws push
  callers to read an opt-out offer aloud, so the agent's own script
  routinely contains the exact phrases you are matching on. Scanning both
  speakers flags every compliant call as a revocation.

Be honest about the ceiling. A phrase list over one language is not intent
classification: it misses other languages and over-triggers on conditional
requests. Both failure directions are acceptable here only because a miss
changes nothing and an over-trigger merely asks a human - check that
property holds for your design before shipping one. The stronger version is
to put an `opt_out_requested` enum (with an `unknown` member) in the result
schema itself, which moves the judgment into the extraction model, and keep
the phrase list as a backstop for callers who did not add the field.

## 7. Three rules

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

## 8. Clarification is not failure

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

## 9. Non-terminal does not mean failed

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

## 10. Idempotency

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

## 11. A webhook body is a notification, not a result

A callback or webhook URL handed to a third-party provider is generally
unauthenticated: anything that discovers the URL can post to it, so its mere
arrival is not proof it describes the call you actually started.

The tempting fix is to match an identifier - confirm the body references the
call ID your workflow recorded when it placed the call. Do that; it is
cheap, and it rejects a body that is not even claiming to be about your
call. But be clear about what it is worth, because it is easy to mistake for
authentication and it is not:

**The identifier travels inside the same untrusted body.** An attacker who
knows the URL and the ID can send both. An ID-matching check then waves the
payload through, and every field behind it - the completion flag, the
confidence, the extracted result - is whatever the sender chose to type.
That is a forged `confirmed` written into a CRM. Matching a value the
attacker supplies against a value you already know proves only that they
knew it too.

The property you actually need is that the data came from the provider, and
if the transport cannot give you that, get it from the content instead:

> Treat the delivered body as a notification, never as data. It tells you
> *which* call to go look at. Then fetch that call from the provider over
> your own authenticated credential, and classify the response you get back.

Every field the workflow acts on is then something the provider told you
directly. A forged post at worst causes an authenticated lookup of a call
your account can already see. Note also that the caller can still influence
the *envelope* it hands you - an event type, say - so make sure a hostile
value there can only move the verdict toward less actionable, never toward
success.

If the provider does publish a signature (an HMAC over the raw body with a
shared secret), verify it and you can skip the extra fetch. Verify it
against the **raw** bytes, before any JSON parsing or normalization, and
compare in constant time. If it publishes nothing - which is the situation
this pattern was written for - the fetch is the substitute.

Handle the two ways a lookup can fail differently, because they mean
opposite things:

- **The provider says the call does not exist.** The payload is not about
  anything you own: a forgery, a stale delivery, or a webhook wired to
  another project. Emit nothing at all. Manufacturing a review item for
  every forged post hands an attacker a way to flood a human's queue.
- **The lookup could not be completed** - a timeout, a rate limit, a 5xx.
  You have learned nothing about the call, and a real outcome must not be
  silently dropped because the provider was briefly unreachable. Emit it,
  marked unverified, routed to review, never actionable.

Carry that distinction on the output as a field of its own (`verified`), so
a downstream step can tell "the provider confirmed this" from "nobody could
check."

## 12. How to test it

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
defeats the entire point of offering one. Assert it for the case where the
preview flag was **never set at all**, not only where it was set to true: an
unset flag is the state a freshly built workflow is in, and if absence reads
as "go ahead," the safety of the preview mode depends on everyone
remembering to turn it on.

Four assertions are worth writing explicitly, because each covers a bug
that is easy to introduce and invisible until production:

- **`false` and `0` are still confirmed.** The usable-value check in section
  5 is one truthiness test away from discarding every legitimate "no."
- **Every threshold input falls back rather than loosening.** A confidence
  floor, an hour bound, a retry cap - feed each of them an array, an object,
  and a garbage string, and assert the guard tightens to its default instead
  of widening. `Number([])` is `0`, so the naive coercion turns an
  accidentally-mapped empty list into the most permissive possible setting.
- **The agent's own script cannot trigger the transcript scanners.** Feed a
  transcript where the bot reads an opt-out disclosure and the recipient says
  something ordinary, and assert nothing fires.
- **A webhook body cannot outrank the provider.** Post a body claiming a
  perfect success for a call the provider reports as unfinished or empty, and
  assert the result is not actionable. This is the one assertion that fails
  loudly the moment someone "optimizes away" the verification fetch in
  section 11, which is exactly the change that looks like a harmless
  performance win.

Keep a small set of committed fixture payloads for the cases that are hard
to describe in prose - a clean success, a provider-reported success that
carries no answer, a call carrying a revocation - and run them through the
real classifier in the test suite rather than leaving them as documentation
nobody executes.

See `plugins/zapier-calle/lib/disposition.js` and
`plugins/zapier-calle/lib/result-quality.js` for a fail-closed classifier
built around these rules, `plugins/zapier-calle/lib/opt-out.js` for the
revocation scanner, `plugins/zapier-calle/lib/reconcile.js` for the
authenticated re-read in section 11, and
`plugins/zapier-calle/test/disposition.test.js` plus
`plugins/zapier-calle/test/fixtures.test.js` and
`plugins/zapier-calle/test/reconcile.test.js` for the tests described above.
