# Architecture

## The load-bearing idea

Dial is the orchestrator. CALL-E is the phone-work execution engine.

CALL-E holds a conversation with one recipient and returns a structured result.
It does not search the internet, discover businesses, or decide which of five
quotes is the best answer to what the user asked. Dial does all of that, and
treats CALL-E as one step inside a longer pipeline.

Getting this boundary wrong is the main way a product like this becomes a demo:
it works for restaurants because someone hard-coded restaurants.

## Pipeline

Each stage is a durable job. A job reads the task's current state from the
database, does one thing, records the outcome, and schedules what comes next.
Nothing is held in memory between stages, so a worker restart resumes.

| Stage | Job | Reads | Writes |
| --- | --- | --- | --- |
| Interpret | `task.interpret` | instruction, user settings | `tasks.interpreted`, `call_family` |
| Research | `task.research` | DialTask, location | `business_candidates`, `discovered_count` |
| Plan | `task.plan_calls` | candidates, policy | `calls` rows (intent), maybe an authorization request |
| Dispatch | `task.dispatch_wave` | pending calls in wave N | `provider_call_id`, `dispatched_at` |
| Poll | `task.poll_call` | provider snapshot | disposition, structured result, attempts |
| Compare | `task.compare` | all call outcomes | `tasks.result`, headline, terminal state |
| Timeout | `task.timeout` | stuck calls | forces completion rather than hanging |

`maybeAdvance()` decides after each call whether to dispatch the next wave or
stop and compare. Two useful answers is usually enough; calling twenty
businesses to improve a comparison marginally is a real-world cost, not a
free optimisation.

## The generalisation seam

Adding a domain is configuration, not code:

- **`packages/schemas/src/call-families.ts`** — what to ask on the call and the
  shape of the answer.
- **`packages/search/src/categories.ts`** — how the domain maps to OSM tags and
  Google Places types.

Everything above those two tables — ranking, dispatch, evidence validation,
comparison, the UI — is domain-agnostic and already handles the new vertical.
A phone-repair task and a plumber task run the identical code path with
different family and category rows.

## Processes

```
apps/api      HTTP, auth, SSE, webhook receiver.  Stateless.  Scales horizontally.
apps/worker   The job loop.  All phone work.  Scales horizontally.
apps/web      Next.js SSR + a same-origin BFF proxy.  Holds no secret.
apps/mobile   Expo / React Native.  Bearer token in the platform keychain.
```

API and worker are separate deliberately: a web deploy must not abandon calls in
flight, and the two have completely different scaling and restart profiles.

They communicate only through Postgres — the `jobs` table for work and the
`task_events` table for progress. There is no direct channel between them, which
is why the SSE endpoint tails a table rather than an in-process bus.

## Trust boundaries

```
 user input ──────────► validated (Zod) ────► never authoritative
 model output ────────► schema-constrained ─► never authoritative
 business listings ───► sanitised + wrapped ► never authoritative
 call transcripts ────► sanitised + wrapped ► never authoritative
 webhook deliveries ──► structure-checked ──► never authoritative
                                              (re-fetched before use)

 user policy rows ────► authoritative
 server config ───────► authoritative
```

Everything on the left is data. Only the two on the bottom right decide what
Dial is permitted to do, and both are read in plain TypeScript from the
database. An LLM that becomes convinced a purchase would be helpful still has no
mechanism to make one.

## Data model

`users`, `sessions`, `user_settings`, `push_tokens` · `tasks`, `task_events` ·
`business_candidates`, `candidate_sources` · `calls`, `call_attempts` ·
`authorization_requests` · `processed_webhook_events` · `audit_events`,
`notifications`, `usage_counters` · `jobs`

Constraints that carry real weight:

| Index | Prevents |
| --- | --- |
| `calls_idempotency_key` (unique) | dialling the same business twice on a retry |
| `tasks_user_idempotency_key` (unique) | a double-tap creating two tasks |
| `business_candidates_task_phone_key` (unique) | re-running discovery duplicating rows |
| `processed_webhook_events` (PK on event id) | a replayed webhook being applied twice |
| `jobs_dedupe_key` (unique) | a retried scheduler queueing the same work twice |

## Realtime

The worker writes `task_events`. `/api/events` tails that table per user, filtered
to the requested task, and emits SSE frames. Every line the user sees corresponds
to a persisted state change — there is no timer producing motion.

A client that reconnects passes `since` and resumes from the durable record.

## Failure philosophy

Partial completion is a legitimate outcome, not an error:

> "Dial contacted 4 repair shops. Two answered and gave a price. Here are the two
> verified options."

Every failure mode in §28 maps to a distinct user-facing state with its own
wording. The two that matter most:

- **A directory outage and an empty area are different stories.** One says try
  again shortly; the other says nothing like that exists nearby.
- **A null structured result is never a "no".** It becomes `needs_review`, and
  the comparison engine excludes it from the ranking rather than treating a
  missing price as zero.

---

## Two orchestration modes

Dial runs one engine for two kinds of caller. Both share the CALL-E provider
abstraction, the durable Postgres queue, the webhook boundary, idempotency
discipline and the trust-boundary rules. They differ in domain entities, not
in infrastructure.

### Consumer tasks (the original mode)

```
User instruction -> interpreter -> discovery -> ranking -> CALL-E -> comparison
```

Dial discovers businesses for a person and calls them. Entities: `tasks`,
`business_candidates` (discovered businesses -- nothing to do with business
accounts), `calls`.

### Business workflows (the second mode)

```
Business -> workflow -> contacts -> runs -> recipients -> CALL-E -> structured outcomes
```

A business account uses CALL-E as phone automation staff: appointment
reminders, customer callbacks, custom phone jobs. Entities: `businesses`,
`business_members`, `business_workflows`, `business_contacts`,
`business_runs`, `business_run_recipients`, `business_call_attempts`.

The model is domain-agnostic by construction: a dental clinic and a plumbing
company differ only in which declarative template they picked
(`packages/schemas/src/business.ts`) and what context they attach to a run.
No application code branches on industry.

Scheduling is durable: a run becomes a `biz.dispatch_run` queue job with a
deterministic dedupe key; the worker dispatches recipients through the same
provider abstraction with per-recipient idempotency keys
(`biz:<recipientId>:a<attempt>`), respects the workflow's calling hours in
the business's timezone, never dials an opted-out contact, and retries
no-answers under the workflow's retry policy. The webhook boundary applies
terminal results to both modes (consumer calls first, business recipients
second), re-fetching from CALL-E before writing anything.

Outbound only, and deliberately so. An inbound "AI front desk" was modelled
here once (`direction: 'inbound'`, a `front_desk` template shown greyed out).
It has been removed rather than left disabled: CALL-E's API is eight
endpoints, every one of which begins from a recipient Dial supplies, and it
exposes no way to provision a number, bind one to an agent, or receive an
incoming call. A product should not advertise a capability its provider does
not have, even behind a "coming soon" label.
