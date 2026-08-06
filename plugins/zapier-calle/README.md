# Zapier CALL-E integration

A Zapier Platform CLI integration that places outbound CALL-E phone calls from
a Zap and reports back a fail-closed disposition, transcript, summary, and
any structured result the call extracted.

## Install it

This integration is published to Zapier as a **private** integration, not
listed in Zapier's public app directory, so the invite link below is how
you get access:

https://zapier.com/developer/public-invite/244591/5987695714e8692147ff45fdcb3be684/

Installing it requires a CALL-E API key, entered when you connect the
account inside Zapier - see [Setup](#7-setup) for what the key needs.

The quickest way to confirm it works end to end is
[`examples/two-step-free-plan.md`](examples/two-step-free-plan.md): a
two-step recipe that runs on Zapier's free plan and needs no third-party
app connection beyond the CALL-E account itself.

**`Dry Run` starts on.** A newly added action previews instead of calling
anyone: it returns a masked preview and sends nothing to CALL-E. Turn it off
deliberately, as its own step, once you have read the preview, and only with
a phone number you are authorized to call.

Building from source is not required to try it. The source lives in this
directory; `npm install && npm test` runs the full suite with no
credentials required.

## 1. What it does

The integration places a phone call through the CALL-E Developer API, then
either waits inside the Zap for the call to finish or returns immediately so
a later step can look the result up. Every terminal outcome, and every
pre-flight refusal to dial, is classified into one of ten dispositions (see
[Dispositions](#5-dispositions)) so a downstream step can branch on
`is_actionable` instead of parsing free-text status strings - or on the
three-value [`lead_state`](#lead-state) projection if ten is more than your
workflow needs.

The organising idea is that most of the work is knowing when *not* to call,
and when not to believe the answer:

- It won't dial outside a legal calling window, or a number on a do-not-call
  list, or the same person too many times in a day.
- It won't call an ambiguous outcome a success - including the case where
  CALL-E itself reports high confidence, because it is confident that nobody
  answered the question.
- It won't let a call where the recipient asked to be left alone advance an
  outreach sequence.
- It won't accept a callback it cannot verify.

Two ways to wire it into a Zap:

- **One-Zap shape.** Use `Place Call and Wait for Outcome`. The single Zap
  run places the call, waits for CALL-E to report a terminal outcome (or up
  to 30 days, whichever comes first), and continues with the disposition and
  result already attached. Simplest option when the rest of the Zap only
  needs to react to the outcome.
- **Two-Zap shape.** Zap 1 uses `Start Call (No Wait)` and returns
  immediately with a `call_id`. A separate Zap (for example, on a Schedule by
  Zapier trigger) later calls `Find Call Result` with that `call_id` to
  reconcile the outcome. Use this when the call and the reconciliation logic
  belong in different Zaps, or when a single long-waiting step is not a good
  fit for the rest of the workflow.
- **Trigger-driven shape.** Use the `Call Completed` trigger to start a Zap
  from any CALL-E call reaching a terminal state, including calls placed
  outside Zapier entirely - from CALL-E's CLI, its MCP tools, or another
  client. This is the only shape that reacts to those calls; the two shapes
  above only see calls that a Zap itself placed. See
  [Call Completed trigger](#call-completed-trigger) below.

## 2. Why the callback pattern

The CALL-E Developer API has no endpoint that lists calls, so a *polling*
trigger is not possible - there is nothing for Zapier to poll. That is why
`Place Call and Wait for Outcome` and `Start Call (No Wait)` use the
callback pattern described below instead of a trigger. A *push-based*
(webhook) trigger has no such limitation, since CALL-E delivers the event
directly rather than being polled for it - see
[Call Completed trigger](#call-completed-trigger). Zapier create actions
must also return in roughly 30 seconds, which is far shorter than a phone
call takes to resolve.

`Place Call and Wait for Outcome` works around both limits with the Zapier
Platform CLI's callback pattern: `perform` calls `z.generateCallbackUrl()` to
mint a one-time webhook URL, sends it to CALL-E as `webhook_url`, and returns
immediately. The Zap step then holds open for up to 30 days. When CALL-E
posts the terminal event to that URL, the Zapier platform invokes this
integration's `performResume` with the callback body and the output from the
original `perform` call, and `performResume` produces the final result.

`z.generateCallbackUrl()` and `performResume` are a Zapier Platform CLI
feature - they are not available to integrations built with the legacy
Zapier web app editor, which is why this integration ships as a CLI app
rather than a set of visual-builder actions.

## 3. Actions, search, and trigger

| Name | Type | Key inputs |
| --- | --- | --- |
| `Place Call and Wait for Outcome` | Create | Call Task, Recipient Phone Number, Region (optional), Locale (optional), Recipient Timezone (optional, see [Calling windows](#calling-windows)), Do Not Call List (optional, see [Suppression list](#suppression-list)), Result Schema (optional), Correlation ID (optional), Dry Run |
| `Start Call (No Wait)` | Create | Same inputs as above |
| `Find Call Result` | Search | Call ID |
| `Call Completed` | Trigger (static webhook) | None - a URL you paste into CALL-E, see [Call Completed trigger](#call-completed-trigger) |

All input fields for the two create actions:

| Field | Required | Notes |
| --- | --- | --- |
| `task` (Call Task) | Yes | What CALL-E should accomplish on the call. |
| `phone` (Recipient Phone Number) | Yes | Must be E.164, for example `+15550123456`. |
| `region` (Region) | No | Optional ISO country code. Never inferred from the number. |
| `locale` (Locale) | No | Optional locale such as `en-US`. Never inferred from the number. |

**Region and language:** CALL-E may reject a call task with HTTP 422
`call_not_ready` and a clarifying question when the destination region
implies a language requirement (observed live for a Vietnamese number).
Setting `Region` and `Locale` explicitly avoids this. The integration never
infers either from the phone number.
| `calling_window_timezone` (Recipient Timezone (IANA)) | No | IANA name such as `America/New_York`. Opts into calling-window enforcement. Never inferred. See [Calling windows](#calling-windows). |
| `calling_window_earliest_hour` (Earliest Local Hour) | No | Defaults to `8`. Only applies when Recipient Timezone is set. |
| `calling_window_latest_hour` (Latest Local Hour) | No | Defaults to `21`. Only applies when Recipient Timezone is set. |
| `calling_window_block_sunday` (Block Sunday Calls) | No | Defaults to `false`. Only applies when Recipient Timezone is set. |
| `suppression_list` (Do Not Call List) | No | Numbers that must never be dialled, separated by commas or newlines. Matching is digits-only. See [Suppression list](#suppression-list). |
| `result_schema` (Result Schema (JSON)) | No | JSON Schema for the structured result. See the allowlist in [Result schema support](#result-schema-support). |
| `correlation_id` (Correlation ID) | No | Your own record id, echoed back on the result as `correlation_id`. |
| `dry_run` (Dry Run) | No | Defaults to `true`, and a blank or unset value is also a dry run. Placing a real call takes an explicit `false`. See [Dry run](#8-dry-run). |

`Find Call Result` takes a single required `Call ID` input - the `call_id`
returned by either create action - and returns the same output shape as the
create actions.

**Not-found behavior:** when the supplied Call ID does not exist, CALL-E
returns HTTP 404 and the integration raises an error reading `CALL-E request
failed with status 404. Call not found.` It does not return an empty result
set. This is a deliberate deviation from the usual Zapier search convention
of returning no results when nothing is found. This search exists to
reconcile a call that may already have happened, and silently returning
nothing for a mistyped or stale Call ID would let a workflow conclude that
no call took place - the same failure mode the rest of this integration is
built to prevent. An error is louder and safer than a false negative.
Supply a Call ID captured from `Start Call (No Wait)` or from a
`Place Call and Wait for Outcome` step, rather than a hand-typed value.

### Call Completed trigger

`Call Completed` fires when any CALL-E call in your project reaches a
terminal state - `call.completed`, `call.failed`, or
`call.result_validation_failed` - and returns the same flattened output
shape as the two create actions and the search, run through the same
disposition classifier. Unlike every other entry point in this
integration, it catches calls started **anywhere**, not just calls a Zap
itself placed: a call started from CALL-E's CLI, one of CALL-E's MCP
tools, or any other client all reach this trigger the same way a
Zap-placed call does.

CALL-E has no webhook subscription API for Zapier to call on your behalf,
so `Call Completed` is a **static webhook trigger**: after you add it to a
Zap, Zapier shows you a URL instead of registering one automatically.
Setup is manual, one time, per CALL-E project:

1. Copy the webhook URL Zapier shows for this trigger.
2. In CALL-E, open your project's webhook settings.
3. Paste the URL into the project's webhook URL field and save.

From then on, every terminal call event in that CALL-E project is
delivered to this Zap - the trigger does not filter by `disposition`, so
branch on that field inside your Zap rather than assuming every event
means success.

**The webhook endpoint is unauthenticated.** CALL-E signs nothing and
Zapier verifies nothing about who posts to a static webhook URL. The
trigger therefore treats the delivered body as a notification rather than
as data: it takes the call id the body names, reads that call back from
CALL-E over your own connection, and reports what CALL-E says. A delivery
naming a call your connection cannot see does not fire the Zap at all. See
[Webhook verification](#webhook-verification) for the full table, including
what happens when CALL-E cannot be reached. Static webhook triggers like
this one are only permitted on private Zapier integrations, which this one
is.

### Result schema support

`result_schema` is validated against an allowlist, not a blacklist. Only
these JSON Schema keywords are accepted: `type`, `properties`, `required`,
`enum`, `items`, `description`, and `additionalProperties` (which must be
exactly `false`). Anything else - `patternProperties`, `dependentSchemas`,
`if`/`then`/`else`, `not`, `const`, `format`, `$ref`, `$defs`, `oneOf`,
`anyOf`, `allOf` - is rejected with a validation error rather than silently
ignored. Nesting is capped at 20 levels, so a schema built from a cyclic
object reference produces a validation error instead of hanging or
overflowing the stack.

### Calling windows

The CALL-E `CreateCallRequest` has no scheduling or quiet-hours controls of
its own, so a Zap on a schedule trigger has nothing stopping it from dialing
someone at 3am. Setting `Recipient Timezone (IANA)` opts a call into a
calling-window guard: before either create action sends a request to CALL-E,
it checks whether the current time in that timezone falls inside
`Earliest Local Hour` through `Latest Local Hour`, and optionally blocks
Sunday. If the call is outside the window, no request is sent to CALL-E and
`Place Call and Wait for Outcome` never generates a Zapier callback URL -
the call is refused before either would happen.

**The timezone is never inferred** from the phone number, region, locale, or
any other input - per this project's [design
principles](../../docs/design-principles.md), guessing a timezone is not
allowed. Supplying `Recipient Timezone (IANA)` is the opt-in: leaving it
blank disables enforcement entirely and preserves the integration's prior
behavior. A raw UTC offset (`+07:00`, `UTC-5`) is rejected rather than
accepted, because an offset does not shift for daylight saving the way an
IANA name such as `America/New_York` does.

The default window, 8am-9pm, matches the US federal TCPA (47 U.S.C. 227,
implementing rules at 47 CFR 64.1200), which restricts telephone
solicitation calls to 8:00am-9:00pm in the **called party's** local time.
Some states are stricter: Florida and Oklahoma cut the window off at 8:00pm
(set `Latest Local Hour` to `20`), and Florida additionally prohibits
solicitation calls on Sunday (set `Block Sunday Calls` to `true`).

**This is a guard rail, not legal advice.** It enforces only the hours and
day you configure; it does not know which of your calls are "solicitation"
calls, does not track state-by-state rules beyond what you configure, and
does not know which state the recipient is actually in. The operator
configuring this integration is responsible for determining which rules
apply to their calls and configuring the fields accordingly.

### Suppression list

The CALL-E `CreateCallRequest` has no do-not-call support of its own, so
setting `Do Not Call List` opts a call into a suppression guard: before
either create action sends a request to CALL-E, it checks the recipient
number against the list and refuses to dial a match. Like the calling
window, this is **stateless** - the list is supplied fresh on every call,
not stored anywhere by this integration, because a Zapier action has no
durable storage available to it. Leaving the field blank disables the
guard entirely and preserves the integration's prior behavior.

Paste or map any mix of numbers separated by commas, semicolons, or
newlines. Matching compares **digits only**, so `+1 (555) 012-3456`,
`+15550123456`, and `15550123456` all match each other regardless of which
form is on the list and which form was mapped into Recipient Phone Number.
An entry also matches as a suffix of the target (or the target as a suffix
of the entry) once both have at least 7 digits, so a national-format entry
still catches an E.164 target and vice versa, without letting a very short
entry suppress an unrelated number. A list that cannot be read as text (for
example a mapped field carrying an object instead of a string) fails
closed: the call is refused rather than risking a dial an unreadable list
might have blocked.

**Dry-run asymmetry, deliberate:** a dry run still previews outside the
calling window, but a dry run does **not** preview for a suppressed number.
The calling window is about timing, and a preview has no timing, so showing
what the window would have decided is harmless at any hour. Suppression is
about the number itself, not about when the call would happen - echoing
back a preview for a number you have been told never to contact is not a
harmless preview, it is the wrong behavior wearing a preview's clothes. Both
create actions refuse a suppressed number the same way whether or not
`Dry Run` is set, and `Place Call and Wait for Outcome` never generates a
Zapier callback URL for a call it refused this way.

## 4. Outputs

Every action, the search, and the `Call Completed` trigger return this
shape. `structured_result` fields are also
flattened onto the top level with a `result_` prefix (for example, a
structured result field named `acknowledged` also appears as
`result_acknowledged`) so they can be mapped individually into later Zap
steps.

| Field | Description |
| --- | --- |
| `disposition` | One of the ten values in [Dispositions](#5-dispositions). |
| `disposition_reason` | Human-readable reason the disposition was chosen. |
| `is_actionable` | `true` only when `disposition` is `confirmed`. |
| `lead_state` | Coarse projection for branching: `qualified`, `needs_human`, or `blocked_compliance`. See [Lead state](#lead-state). |
| `verified` | `true` when the fields above were read back from CALL-E over your own API key rather than taken from a webhook body. See [Webhook verification](#webhook-verification). |
| `event_id` | The CALL-E webhook event id, when available. |
| `event_type` | The CALL-E webhook event type, when available. |
| `call_id` | The CALL-E call id. |
| `status` | The CALL-E call status (see [Status vocabulary](#6-status-vocabulary-note)). |
| `task_completed` | Whether CALL-E considered the task completed. |
| `confidence_label` | CALL-E's completion-confidence label, or `null`. |
| `confidence_score` | CALL-E's completion-confidence score, or `null`. |
| `summary` | CALL-E's call summary, or `null`. |
| `evidence` | Supporting evidence array from CALL-E, or `[]`. |
| `failure_code` | Failure code when the call failed, or `null`. |
| `failure_message` | Failure message when the call failed, or `null`. |
| `correlation_id` | The correlation id you supplied, echoed back, or `null`. |
| `completed_at` | Completion timestamp, or `null`. |
| `recipients_total` | Number of recipients on the call. |
| `recipients_completed` | Number of recipients whose status is `completed`. |
| `recipients_failed` | Number of recipients whose status is `failed`. |
| `transcript_text` | Full transcript, turns joined as `speaker: text` lines. |
| `review_excerpt` | The recipient's last spoken turn, when the disposition is not `confirmed`; `null` otherwise. The line a human should read first. |
| `review_excerpt_offset_seconds` | Seconds from the start of the attempt at which that line was spoken, or `null`. |
| `opt_out_requested` | `true` when the recipient asked not to be called again (see [Opt-out capture](#opt-out-capture)). |
| `opt_out_excerpt` | The quoted request, or `null`. |
| `opt_out_offset_seconds` | Where in the call it was said, or `null`. |
| `structured_result` | The raw structured result object, or `null`. |
| `recipients` | The raw per-recipient array from CALL-E. |
| `result_*` | Each key of `structured_result`, flattened to the top level. |

`Start Call (No Wait)` additionally returns `dry_run` and
`idempotency_key`; `Place Call and Wait for Outcome` returns a `preview`
field instead of a `call_id` when run as a dry run. `Find Call Result` also
returns `reconciliation_timed_out` (see
[Reconciliation limit](#reconciliation-limit)).

Phone numbers are masked in every output and error message before they leave
the integration, including in `review_excerpt` and `opt_out_excerpt`.

### Lead state

Ten dispositions is the right vocabulary for auditing a call and the wrong
one for building a Zapier Path. `lead_state` is the same information
collapsed to the three branches a workflow actually needs:

| `lead_state` | Dispositions | What to do |
| --- | --- | --- |
| `qualified` | `confirmed` | Write the result through. This is the only state that is safe to act on unattended. |
| `blocked_compliance` | `outside_calling_window`, `suppressed`, `retry_policy_blocked`, and any call where `opt_out_requested` is `true` | Record why the call must not happen. Do not retry on the next run. |
| `needs_human` | everything else, including any disposition this integration does not recognize | Send it to a person. |

Nothing is lost - `disposition` and `disposition_reason` are still on the
output. An unrecognized disposition maps to `needs_human`, never to
`qualified`.

## 5. Dispositions

| Disposition | `is_actionable` | When it applies |
| --- | --- | --- |
| `confirmed` | `true` | Call completed, `task_completed` was `true`, the confidence label was `high` **and** its numeric score cleared the configured floor, and every field the caller declared required came back with a usable value. |
| `review_required` | `false` | Call completed but `task_completed` was not `true`, the confidence label was not `high` or its score was below the floor, or the structured result was missing, empty, or carried no usable answer (see [Usable results](#usable-results)). |
| `result_invalid` | `false` | CALL-E could not validate the structured result against the supplied `result_schema`. |
| `failed` | `false` | The call failed (status `failed` or a `call.failed` event). |
| `canceled` | `false` | The call was canceled before completion. |
| `outcome_unknown` | `false` | The call is still `queued` or `in_progress`, or the webhook payload itself was unreadable. Deliberately distinct from `failed` - treating an ambiguous result as a failure is how a workflow ends up dialing someone twice. |
| `needs_human` | `false` | Default, fail-closed branch: a malformed event, an unrecognized event type, a missing or unrecognized call status, or a callback that fails id verification (see [Callback verification](#callback-verification)). |
| `outside_calling_window` | `false` | The call was refused before dialing because the current time in the recipient's configured timezone fell outside the calling window (see [Calling windows](#calling-windows)). Produced only by the create action before a request is sent to CALL-E - the webhook classifier never returns it. |
| `suppressed` | `false` | The call was refused before dialing because the recipient number matched an entry on the supplied `Do Not Call List` (see [Suppression list](#suppression-list)). Produced only by the create action before a request is sent to CALL-E - the webhook classifier never returns it. |
| `retry_policy_blocked` | `false` | The call was refused before dialing because the supplied attempt history would exceed the per-day cap or the minimum interval between attempts (see [Retry policy](#retry-policy)). Produced only by the create action before a request is sent to CALL-E - the webhook classifier never returns it. |

Only `confirmed` sets `is_actionable` to `true`. An unrecognized status or
event type is never treated as a success - it always resolves to
`needs_human`.

### Usable results

A structured result being *present* is not the same as it carrying an
*answer*, and the difference is where an automated call quietly goes wrong.

CALL-E's schema guidance tells you to *"prefer string enums over booleans
for business decisions that may be unclear, and include an `unknown` enum
value when the call may not provide enough evidence."* The
[`calle-script-advisor`](../../skills/calle-script-advisor) skill in this
repository lints for exactly that. Follow the advice, and a call where
nobody answered the question comes back looking like this:

```json
{
  "status": "completed",
  "task_completed": true,
  "completion_confidence": { "score": 0.88, "label": "high" },
  "structured_result": { "confirmed": "unknown" }
}
```

Every field says success. CALL-E is not wrong - it is confident in its
judgment, and its judgment is that there was no answer. An integration that
checks only whether `structured_result` exists writes "confirmed" into a
CRM for a person who hung up.

So this integration checks the values:

- A required field carrying `unknown`, `unclear`, `not_stated` or
  `undetermined` (any case, trimmed) is not an answer.
- Nor is one that is `null`, `""`, `[]` or `{}`. But `false` and `0` **are**
  answers and are treated as such.
- A field your `result_schema` declares `required` that never came back at
  all fails the same way, including inside nested required objects.
- A field you did **not** require is ignored - you said it was optional.

Both create actions check against the `result_schema` you supplied. The
`Call Completed` trigger and `Find Call Result` reconcile calls that may
have been placed anywhere - from CALL-E's CLI, its MCP tools, or another
Zap - so they have no declared contract to compare against. They still check
the values they can see, but they cannot detect a field that is missing,
because nothing told them it was expected. Use `Place Call and Wait for
Outcome` when you want the contract enforced.

### Confidence score floor

CALL-E returns both `completion_confidence.label` and a 0-1
`completion_confidence.score`. The API declares the score required and
bounded; the label is documented only by example ("for example `low`,
`medium`, or `high`"). The label is therefore the looser field, and checking
it alone accepts a `high` carrying a score of 0.05.

`Minimum Confidence Score` defaults to **0.6** and is available on both
create actions, the trigger, and the search. That number is a policy default
chosen for this integration, not a threshold CALL-E publishes - raise it if
your workflow acts on the result without review, lower it if you are seeing
good calls sent to review. Set it to `0` to classify on the label alone.

An unparseable value falls back to 0.6 rather than turning the check off, so
a typo cannot silently loosen it.

### Opt-out capture

The `Do Not Call List` input can only stop a number you already knew about.
The moment a person actually says *"stop calling me"* is inside a transcript
nobody reads - and the call may otherwise be a complete success, with every
required field answered.

When the recipient asks not to be called again, this integration sets
`opt_out_requested`, quotes the request in `opt_out_excerpt` with its offset
into the call, forces `is_actionable` to `false` and `disposition` to
`needs_human`, and routes `lead_state` to `blocked_compliance` - **whatever
the business result was**. The extracted result stays on the output for
whoever handles it. Wire that branch to append the number to the
`Do Not Call List` your other Zaps read from, and the loop closes.

The FCC's revocation rule accepts a request made by any reasonable means,
including saying so on the call, and requires it to be honored within 10
days.

Only the recipient's own turns are scanned. State bot-disclosure laws push
callers to read an opt-out offer aloud, so the agent's script routinely
contains the phrases being matched; scanning both speakers would flag every
compliant call.

**Its ceiling, stated plainly:** this is a phrase list over English text, not
intent classification. It will miss a revocation phrased in another language
or in a form not on the list, and it can fire on a conditional request
("don't call me before five"). A miss leaves prior behavior unchanged and a
false positive only asks a human, which is why a list is acceptable here at
all. The stronger version is to add an `opt_out_requested` enum field with an
`unknown` member to your `result_schema`, which puts the judgment in CALL-E's
extraction model; the phrase list then backs it up.

### Retry policy

Redialling someone who did not answer is the easiest way to turn a useful
automation into harassment, and it is what a Zap does by default - the
trigger fires again, the action runs again.

Supplying `Previous Attempt Times` (ISO 8601 timestamps, comma or newline
separated) enables enforcement: the call is refused with
`retry_policy_blocked` if it would exceed `Max Attempts Per Day` (default 2)
or fall inside `Minimum Hours Between Attempts` (default 4). Those defaults
are the conservative end of common practice, not a single citable federal
number, which is why they are inputs.

The history is **stateless** - supplied fresh on every call, never stored by
this integration, because a Zapier action has no durable storage. It comes
from the same spreadsheet row or CRM record your Zap is already reading,
exactly like the `Do Not Call List`. An unparseable timestamp, a
future-dated one, or a history that cannot be read as text fails closed and
refuses to dial.

Like the calling-window guard and unlike suppression, a dry run previews the
verdict rather than being blocked by it.

### Reconciliation limit

Zapier holds a waiting callback step for up to 30 days and offers no timeout
hook: if CALL-E never posts back, `performResume` is simply never invoked.
`Place Call and Wait for Outcome` therefore **cannot** time itself out from
the inside, and no amount of configuration will change that.

Build the timeout from the outside instead: `Start Call (No Wait)` → a
Zapier **Delay** step → `Find Call Result` with `Reconciliation Limit
(minutes)` set. A call still `queued` or `in_progress` that many minutes
after CALL-E created it is reported as `needs_human` with
`reconciliation_timed_out: true`, rather than sitting at `outcome_unknown`
forever. Age is measured from CALL-E's own `created_at`, so a delayed or
re-run step still measures the real age of the call. A call whose age cannot
be read is escalated rather than assumed healthy.

### Webhook verification

Both webhook surfaces - the resumable callback behind
`Place Call and Wait for Outcome` and the `Call Completed` trigger - receive
an unsigned body on an unauthenticated URL. CALL-E publishes no signing
secret and no subscription handshake, so nothing in the request itself
proves it came from CALL-E.

Matching the call id does not fix that, and it is worth being precise about
why: the id arrives inside the same untrusted body. An attacker who knows
the URL and the id can echo the id back, and an id-matching check waves the
payload through. Everything after it - `task_completed`, the confidence, the
structured result, and therefore `disposition: confirmed` and
`is_actionable: true` - would then be whatever the sender chose to type.

So a delivered body is treated as a notification, never as evidence. It says
"call X may be finished". The integration then asks CALL-E directly, over
the connection's own API key, what actually happened to call X, and
classifies **that** response. Every field a Zap acts on comes from an
authenticated read.

The two surfaces differ only in what they can do when the lookup does not
succeed:

| Situation | `Place Call and Wait for Outcome` | `Call Completed` |
| --- | --- | --- |
| Body does not name the call this step started | `needs_human`, no lookup made | n/a - the trigger has no prior call |
| CALL-E has no such call on this connection | `needs_human` | Ignored: no Zap run at all |
| CALL-E unreachable, rate limited, or erroring | `needs_human`, `verified: false` | `needs_human`, `verified: false` |
| CALL-E returns the call | Classified from CALL-E's record, `verified: true` | Classified from CALL-E's record, `verified: true` |

A call the connection cannot see is not the Zap's call - a forged post, a
stale delivery, or a webhook wired to another CALL-E project - so the
trigger declines to fire at all rather than manufacture a run. A lookup that
merely *failed*, though, is the opposite problem: CALL-E being briefly
unreachable must not silently swallow a real outcome, so that case comes
through marked unverified and never actionable, where a human sees it.

The id checks in `performResume` still run first. They are a cheap filter,
not authentication - they reject a callback that is not even claiming to be
about this step's call before spending an API request on it.

`verified` is on the output of every entry point. `Find Call Result` reports
`verified: true` unconditionally: it reads the call from CALL-E itself and
never had a webhook to distrust in the first place.

An attacker who floods a discovered callback URL can therefore cause extra
authenticated lookups of calls the account can already see. They cannot
manufacture a result.

## 6. Status vocabulary note

This integration consumes the CALL-E **Developer API**, whose `status`
field uses five lowercase values: `queued`, `in_progress`, `completed`,
`failed`, `canceled`. The CALL-E **CLI and MCP surface** documented
elsewhere in this repository uses a different, uppercase vocabulary that
includes values such as `NO_ANSWER` and `VOICEMAIL`. The two vocabularies do
not map one-to-one. If you build a status mapping by reading the CLI
reference first, it will not match what this integration (or the Developer
API) actually returns.

## 7. Setup

1. In Zapier, create a connection for this integration and enter your CALL-E
   API key. The key is stored as a password-typed field and is sent only as
   an `Authorization: Bearer` header.
2. CALL-E places real phone calls. Only connect an API key and supply phone
   numbers you are authorized to call.
3. Add `Place Call and Wait for Outcome`, `Start Call (No Wait)`, or
   `Find Call Result` to a Zap and map in the Call Task and Recipient Phone
   Number.

## 8. Dry run

Dry Run is on by default, so an action that has just been added to a Zap
previews instead of calling anyone. A dry run never calls
`z.generateCallbackUrl()` and sends no request to CALL-E - it returns a
masked preview of the endpoint, idempotency key, and payload instead.

Only an explicit negative places a real call: `false`, `'false'` in any
letter case, `0`, or `'0'`. Every other value is a dry run - `true`, any
other string, a number other than `0`, an unrecognized input, and, most
importantly, **nothing at all**: unset, `null`, or an empty string.

That last part is the whole point. A field nobody ever set, a field a Zap
mapped from an upstream value that turned out to be blank, and a field that
did not exist when the Zap was built all arrive the same way, and none of
them is a person deciding to dial a real phone number. Going live is an
explicit act, so it takes an explicit value; everything short of that
previews. An integration that cannot confidently tell a value means "no"
refuses to place the call rather than guess.

Example dry-run preview payload uses `+15550123456` as the recipient number.

## 9. Side effects and cancellation

- With Dry Run `false`, each Zap run of `Place Call and Wait for Outcome` or
  `Start Call (No Wait)` places exactly one outbound phone call.
- To stop future calls, turn the Zap off. A call that has already been
  placed cannot be recalled.
- If a `Place Call and Wait for Outcome` step is interrupted, or a webhook
  from CALL-E is missed, use `Find Call Result` with the recorded `call_id`
  to reconcile the outcome afterward.
- This integration derives a stable `Idempotency-Key` for each call: a
  SHA-256 digest of the task, recipients, result schema, recipient result
  schema, and metadata, computed before the per-run `webhook_url` is
  attached so the key stays constant across retries of the same logical
  call. Per CALL-E's documented `Idempotency-Key` contract, reusing the
  same key with the same request returns the original call instead of
  creating a duplicate. A changed payload - a different phone number, task
  text, or schema - produces a different key and is therefore correctly
  treated as a new call. This project has not exercised that behavior
  against a live CALL-E instance.

## 10. Testing

`npm install && npm test` runs 303 tests across 22 files against a bundled
fake CALL-E server. No credentials are required and no real calls are
placed. `test/fixtures/` holds three committed payloads - a clean success, a
provider-reported success that carries no answer, and a call carrying a
revocation of consent - which `test/fixtures.test.js` drives through the
real classifier, so they are executable evidence rather than documentation.
`test/e2e-app.test.js` additionally drives the real app definition
(`index.js`) through `zapier-platform-core`'s `createAppTester`, exercising
the actual `beforeRequest`/`afterResponse` middleware chain rather than
calling `operation.perform` in isolation.

**`package.json` must declare both `"type": "module"` and an `"exports"`
map.** Without `"type": "module"`, Zapier's Lambda loads this ESM source as
CommonJS and the app fails at load with `Cannot use import statement outside
a module`. Without `"exports"`, Zapier's build wrapper cannot self-resolve
`import('zapier-calle')` (a package self-reference, which Node only permits
via `exports`) and `zapier push` fails. Both fields are required together -
removing either one breaks the app in production, in different ways.

**Known limitation:** under `createAppTester`, `z.generateCallbackUrl()`
returns a fixed Zapier-hosted URL rather than one that routes back to the
fake server, so the automated tests cannot drive an actual HTTP delivery of
the CALL-E webhook to that URL. The tests do verify that `perform` requests a
callback URL and sends it to CALL-E as `webhook_url`, and that `performResume`
runs correctly through the real platform once it receives a callback body -
just not the live HTTP delivery leg in between.

**Live verification:** performed 2026-08-02 against `https://api.heycall-e.com`
with `zapier-platform-core` 19.1.0. Three real outbound calls were placed to a
phone number the tester owns. The number itself is not recorded here.

Preflight, no calls consumed:

- Authentication: `GET /v1/goals` returned HTTP 200.
- Dry run with real credentials pointed at the production base URL: zero
  network requests issued, zero Zapier callback URLs generated, and the
  recipient number masked in the preview with no raw digits present.
- E.164 validation and masking confirmed against the real number.

Call 1 - recipient declined:

- `POST /v1/calls` returned HTTP 201; the handset rang.
- The recipient hung up without answering. CALL-E retried, then the call
  task reached terminal `status: failed` with `failure_code` reporting
  `DECLINED (Hangup by: user)`.
- CALL-E still returned an extracted `structured_result` of
  `{"heard_clearly": "unknown"}`, but `task_completed` was `false`.
- The integration classified this as `disposition: failed`,
  `is_actionable: false`. It did not treat the presence of a structured
  result as success. No raw digits appeared anywhere in the flattened
  output.

Call 2 - recipient answered:

- `POST /v1/calls` returned HTTP 201. The call rang, connected, CALL-E held
  the conversation in Vietnamese, and the recipient confirmed.
- Terminal `status: completed` was reached about 50 seconds after creation.
- `task_completed: true`, `completion_confidence` `high` at 0.95, and
  `structured_result` of `{"heard_clearly": "yes"}` matching the schema
  supplied on the request.
- Six transcript turns were returned.
- The integration classified this as `disposition: confirmed`,
  `is_actionable: true`. No raw digits appeared anywhere in the flattened
  output.

**Clarification path - no call consumed.** A `POST /v1/calls` for a Vietnamese
number submitted with `Region` set but `Locale` omitted returned HTTP 422
with error code `call_not_ready`, carrying a `details.questions` array.
CALL-E asks before dialing rather than guessing, and spends no call doing
so. Running that real response through the integration's `checkForErrors`
produced the user-facing message:

> CALL-E needs more information before it will place this call
> (clarification requested): For this Vietnam number, the supported call
> language is Vietnamese. Should the call be placed in Vietnamese? Answer
> the question directly in the Call Task text, and set the Region and
> Locale input fields explicitly - this integration never infers them from
> the phone number.

Note that the API key was not present anywhere in that message, confirming
the redaction path holds on a real error response.

**Reconciliation path - no call consumed.** `Find Call Result` was run
against the production API for both previously recorded calls. For the
declined call it returned a single result with `disposition: failed` and
`is_actionable: false`; for the answered call, a single result with
`disposition: confirmed` and `is_actionable: true`. Both matched the
disposition the live callback path produced for the same calls, confirming
that a reconciled call and a live call cannot disagree - they share one
classifier. No raw phone digits appeared in either output.

Call 3 - recipient declined, started without waiting:

- `Start Call (No Wait)` returned immediately with a `call_id`,
  `status: queued`, and `disposition: outcome_unknown` - correct, since this
  action does not wait for the call to finish. The `Idempotency-Key` it sent
  was a 64-character hex digest.
- `Find Call Result` was then polled against that `call_id`. It reported
  `outcome_unknown` while the call was non-terminal, and reached a terminal
  state at about 55 seconds.
- The recipient declined the call, and CALL-E reported the call task as
  `status: completed`, not `failed`.
- The integration classified this as `disposition: review_required`,
  `is_actionable: false`, with the reason "Call completed but no structured
  result was extracted."
- The `correlation_id` supplied on the request round-tripped back through
  CALL-E's `metadata` and was present on the reconciled result.
- No raw phone digits appeared in the output.

**Re-verified after the usable-result and confidence-score checks were
added.** All three live payloads were replayed through the current
classifier and produced the same dispositions recorded above - `failed`,
`confirmed`, `review_required` - so nothing in this section is stale. Call
2's confidence score was 0.95, comfortably above the 0.6 floor.

Call 1's payload is also the production evidence behind the
[usable-results check](#usable-results): CALL-E's extracted result for a
call the recipient hung up on was literally `{"heard_clearly": "unknown"}`.
On that call `task_completed` was `false`, so the classifier already caught
it. Had CALL-E judged the task complete - which it does, as fixture
`test/fixtures/fixture-user-hung-up.json` models - only the value check
would have stood between that payload and a `confirmed`.

**Why this call matters:** a declined call was reported by the platform with
`status: completed`. An integration that branches on `status === 'completed'`
- the obvious and common thing to write - would have treated a call the
recipient refused as a success and let a workflow act on it. This integration
did not, because `completed` alone is not sufficient: it also requires
`task_completed`, a high confidence label, and a structured result that
validates.

**What this demonstrates:** the success path, a real non-success path, the
clarification path, the reconciliation path, and a declined call started
without waiting have all now been exercised against production, and the
integration produced the correct outcome for each. Of the three call
records, Call 3 is now the most important: the platform reported a declined
call as `status: completed`, and the integration still refused to mark it
actionable because `task_completed`, the confidence label, and the
structured result did not clear the bar `confirmed` requires. Call 1 remains
the next most important: CALL-E returned a structured result, and the
integration still refused to mark the call actionable because
`task_completed` was false. The clarification path adds a data point of its
own: CALL-E can reject a call before dialing rather than guessing, this
integration surfaces that as a fail-closed clarification request rather than
a generic failure, and no call is consumed doing so. The reconciliation path
shows that looking a call up after the fact through `Find Call Result`
produces the same disposition the live callback path already produced for
that same call, and doing so consumes no additional call. Between the four
records, all three operations this integration exposes - both create
actions and the search - have now been exercised against production.

**Observed platform behavior worth knowing:**

- A call task's top-level `status` from `GET /v1/calls/{id}` read `queued`
  while the call was in flight, whereas `GET /v1/calls/{id}/events` reported
  the real progression: `call.started`, `call.in_progress`, `Call is
  ringing`, `Call connected`, `Bot is speaking`, `Callee said`, `Call ended`.
  Use the events endpoint when you need live progress; do not infer failure
  from a non-terminal `status`.
- CALL-E retries after a declined call, so a declined call takes materially
  longer to reach a terminal state than an answered one.
- A call task for a Vietnamese number was rejected at creation with HTTP 422
  and error code `call_not_ready`, carrying a `details.questions` array
  asking whether the call should be placed in Vietnamese. Setting `Region`
  and `Locale` explicitly avoids this. This integration surfaces those
  questions rather than reporting a generic failure.

**Not covered by automated tests:** `z.generateCallbackUrl()` under
`createAppTester` targets a fixed Zapier-hosted URL that cannot be
redirected to the local fake server, so the live HTTP delivery leg of the
webhook is exercised only by Zapier itself in production, not by this
repository's test suite.
