# Supplier Quote Agent

An outbound-call procurement agent that can plan a supplier call, dial it, cancel it
mid-ring, and re-plan it after it fails — but **cannot approve it**. A person presses
Approve, and the code is built so that no tool call can substitute for that press.

Built for the [CALL-E hackathon](https://call-e.devpost.com/). Runs entirely on a
deterministic fake call provider by default: cloning this and running `npm start` places
no calls and needs no credentials.

- Product definition, demo script and submission checklist: [`SPEC.md`](SPEC.md)
- Architecture, diagrams and the three-layer approval gate: [`docs/architecture.md`](docs/architecture.md)
- Licence: [`LICENSE`](LICENSE) (MIT)

---

## The problem

Procurement teams burn hours phoning vendors for the same three numbers — unit price,
lead time, minimum order quantity — then reconcile the answers in a spreadsheet. It is
exactly the shape of work an agent should do.

It is also exactly the shape of work where an agent making one autonomous decision too
many is expensive. A call placed to the wrong supplier is a real phone ringing on a real
desk, billed to a real account. So the split here is deliberate: **the agent does the
dialing and the note-taking; the human does the deciding.**

## Safety model — read this first

| | |
|---|---|
| **Default mode** | `FakeCallProvider`. No network, no timers, no credentials, no calls. |
| **How a real call becomes possible** | Only with `CALL_PROVIDER=calle` **and** `CALLE_API_KEY` set in the environment. Both. Missing either one, the provider refuses to dial. |
| **What the agent can do** | Plan a call, dial an already-approved task, cancel a call in flight, re-plan a finished one, read state. |
| **What the agent can never do** | Approve or reject a task. Not through a tool, not through `update_task`, not by calling `invoke()` directly. |
| **Cancellation** | `cancel_call` aborts a call that is currently ringing or connected. See [Cancelling and rolling back](#cancelling-and-rolling-back). |
| **Recurring jobs** | None. There is no scheduler, no cron, no retry daemon. Every call is placed by an explicit `place_call` against a task a human approved. |
| **Phone numbers** | Every number in this repository is in the NANP block reserved for fiction (`+1-555-0100` … `+1-555-0199`). No real contact information. |
| **Secrets** | None committed. Credentials are read from environment variables at construction time and never written to disk or logs. |

## Stack

| | |
|---|---|
| Runtime | Node.js — `package.json` pins `>=20.0.0`; verified on v26.1.0 |
| Package manager | npm (11.13.0) |
| Backend | Express 4 |
| Frontend | React 18, loaded from CDN in `public/index.html` — no build step |
| Tests | Jest 29 |
| Lint | ESLint 8 |

## Setup

```bash
npm install
```

No credentials, no `.env`, no external service. From a clean clone:

```
added 746 packages, and audited 747 packages in 1s
```

## Run

```bash
npm start
```

```
CALL-E dashboard server listening on http://localhost:3000
```

Open <http://localhost:3000>. `PORT` overrides the port. The dashboard loads with one
seeded quote request (WIDGET-42, qty 100, three suppliers) and one seeded quote.

## Test

```bash
npm test
```

```
> call-e-supplier-quote-agent@0.1.0 test
> jest --passWithNoTests

PASS tests/store.test.js
PASS tests/call-flow.test.js
PASS tests/demo-script.test.js
PASS tests/invoke.test.js
PASS tests/providers.test.js
PASS tests/approval-gate.test.js

Test Suites: 6 passed, 6 total
Tests:       57 passed, 57 total
Snapshots:   0 total
Time:        0.459 s
Ran all test suites.
```

| Suite | What it holds down |
|---|---|
| `tests/approval-gate.test.js` | The thesis. Pins the tool registry to an exact allow-list; asserts no registered tool matches approve/reject under any spelling; asserts every tool description states the rule; asserts `approve_task`/`reject_task` refuse a non-owner even when called directly on `invoke()`; asserts `update_task` cannot sneak a task to `approved`. |
| `tests/demo-script.test.js` | Runs `SPEC.md`'s demo script end to end — three suppliers, one rejected outright, one cancelled mid-dial and retried. |
| `tests/call-flow.test.js` | `plan_call → approve_task → place_call → outcome`, and the three ways `place_call` refuses an unapproved task. |
| `tests/providers.test.js` | `FakeCallProvider`'s status sequence and its handling of an abort that interrupts a wait which never resolves on its own; `CallEProvider`'s request shape and response parsing, against fixtures only. |
| `tests/invoke.test.js` | The `invoke()` chokepoint itself. |
| `tests/store.test.js` | Seeded state and quote upsert by supplier+SKU. |

No test opens a socket, sets a real API key, or constructs `CallEProvider` with the real
`fetch`.

## Lint

```bash
npm run lint
```

```
> call-e-supplier-quote-agent@0.1.0 lint
> eslint src/ tests/ --ext .js,.jsx --fix

/…/src/dashboard.jsx
  223:7  warning  Unexpected console statement  no-console
  240:7  warning  Unexpected console statement  no-console

✖ 2 problems (0 errors, 2 warnings)
```

Two intentional `console.error` calls in the dashboard's fetch error handlers. Note the
script runs with `--fix`, so it repairs auto-fixable problems in place rather than
failing on them.

## Verify everything

```bash
bash verify.sh
```

Checks the documentation set is present, installs `node_modules` if missing (via
`npm ci`, from the committed lockfile), then runs `npm test` and `npm run lint:check`,
exiting non-zero on the first failure.

---

## Demo walkthrough

`SPEC.md`'s demo script, driven against a running server over the same HTTP endpoint the
dashboard's buttons use. This is real captured output, not an illustration — the only
edits are eliding the `curl` boilerplate and truncating the response to the interesting
fields.

**1 — the agent plans the seeded task.** Allowed: planning is not dialing.

```
plan_call        actor: agent   -> {"id": "task_1", "status": "planned"}
```

**2 — the agent tries to dial it.** Refused, and told what to do instead.

```
place_call       actor: agent
  -> REFUSED: Task task_1 must be approved by the owner before calling (status:
     "planned"). Ask the owner to approve it from the dashboard — no tool call can
     approve a task.
```

**3 — the agent tries the generic write path.** Refused.

```
update_task {"updates":{"status":"approved"}}   actor: agent
  -> REFUSED: update_task cannot set status to "approved" — use approve_task/reject_task
     (owner-only, never a registered tool) instead.
```

**4 — the agent calls `approve_task` directly**, bypassing the tool registry entirely.
Refused.

```
approve_task     actor: agent
  -> REFUSED: approve_task is an owner-only action; no agent tool can approve a task.
```

**5 — the owner presses Approve in the dashboard.** Same endpoint, different actor.

```
approve_task     actor: owner   -> {"id": "task_1", "status": "approved"}
```

**6 — now the agent may dial**, and the outcome lands on the task.

```
place_call       actor: agent
  -> {"id": "task_1", "status": "completed",
      "outcome": {"outcome": "quoted",
                  "summary": "Supplier answered and provided pricing, lead time, and
                              payment terms.",
                  "next_action": "review_quote"},
      "call": {"status": "done", "updatedAt": "2026-09-08T04:01:54.288Z"}}
```

**7 — the agent re-plans for a follow-up call.** Note the status: `planned`, *not*
`approved`. One approval does not authorise a second call.

```
retry_with_plan  actor: agent   -> {"id": "task_1", "status": "planned"}
```

**8 — the owner rejects the follow-up.** The supplier is never contacted again.

```
reject_task      actor: owner   -> {"id": "task_1", "status": "rejected"}
```

**The activity log, which is what makes the whole thing auditable** — one surface, both
actors, refusals recorded alongside successes:

```
ok      agent plan_call
REFUSED agent place_call
REFUSED agent update_task
REFUSED agent approve_task
ok      owner approve_task
ok      agent place_call
ok      agent retry_with_plan
ok      owner reject_task
```

### The same thing in the browser

`npm start`, then at <http://localhost:3000>:

1. The seeded task shows **Status: pending** with a single **Plan Call** button.
2. Pressing it moves the task to **planned** — and only then do **Approve** and
   **Reject** appear. They are the only two buttons in the app that call
   `approve_task`/`reject_task`, and they exist nowhere in the tool registry.
3. Pressing **Approve** moves the task to **approved** and reveals **Place Call**.
4. Pressing **Place Call** goes straight to **completed**, with an outcome card showing
   outcome, summary and next action.
5. The Activity Log at the bottom of the page names the actor behind every call,
   refusals included.

**What you will not see, and why.** The card also has an in-flight strip (`Dialing…` →
`Connected` → `Wrapping up…`) and a **Cancel Call** button, but they do not appear during
a normal run: the fake provider's default pacing is `wait: () => Promise.resolve()`, so
all four status transitions complete inside a single HTTP round trip, well before the
dashboard's next 1-second poll. Those controls are reachable only when the provider is
given a slower `wait`, which the dashboard never sends and the tests do — see
`tests/approval-gate.test.js` → *"cancels a genuinely in-flight fake call"*. Against the
real CALL-E provider they do appear — confirmed on the live call in
[`docs/real-call.md`](docs/real-call.md), which took ~2m50s to reach a terminal state,
far longer than the dashboard's 1-second poll. (The **Cancel Call** button is the
exception even there: it renders, but CALL-E exposes no client cancel operation, so it
ends the *task* and not the phone call — see "Cancelling and rolling back".)

For recording a demo video, follow [`docs/video-script.md`](docs/video-script.md), which
has the exact narration, timings and seeded state.

## Agent surface

`GET /api/tools` returns the registry a model would discover. Nine tools:

| Tool | Does | Does **not** |
|---|---|---|
| `plan_call` | Attach a plan brief (goal, script points, success criteria, fallback) and set status `planned` | Approve, or dial |
| `place_call` | Dial a task that is **already** `approved`; record `{outcome, summary, next_action}` | Approve; act on an unapproved task; auto-retry |
| `cancel_call` | Abort a call that is currently in flight; task becomes `cancelled` | Approve, reject, retry; silently succeed when nothing is dialing |
| `retry_with_plan` | Replace the plan on a finished/failed/cancelled/rejected task and reset it to `planned` | Set `approved` — re-approval is required |
| `get_task`, `list_tasks` | Read tasks, statuses, plans, outcomes | Change anything |
| `get_quote_status`, `list_pending_quotes` | Read quotes | Predict pricing or recommend vendors |
| `request_human_approval` | Gather the top quotes and transcripts for a person to look at | Approve anything itself |

Every one of these descriptions ends with the same sentence, so a model reading any
single tool sees the rule:

> Approve and Reject are owner-only dashboard actions; no registered tool, including this
> one, can move a task to "approved" or "rejected".

`approve_task` and `reject_task` are deliberately **absent** from that list. They exist
only inside `src/invoke.js` and refuse any actor but `owner`.

## HTTP API

| Route | Purpose |
|---|---|
| `POST /api/invoke` | `{tool, args, actor}` — the single mutating endpoint, shared by the UI and the agent |
| `GET /api/state` | Tasks + quotes |
| `GET /api/activity-log` | Every invocation with its actor, args and result |
| `GET /api/tools` | The agent-facing tool registry |

## Credentials and real calls

Four environment variables, none of which has a value in this repository:

| Variable | Meaning |
|---|---|
| `CALL_PROVIDER` | `fake` (default) or `calle`. Only `calle` touches the network. |
| `CALLE_API_KEY` | Required by the real provider. Without it, `place_call` refuses to dial. Get one from https://dashboard.heycall-e.com/ — no CLI or local install needed. |
| `CALLE_BASE_URL` | Optional override; defaults to `https://api.heycall-e.com` (CALL-E's documented REST API). |
| `DEMO_SUPPLIER_PHONE` | Optional. Dials `task_1`'s first supplier at a number you own instead of its fictional seed. |

`CALL_PROVIDER`, `CALLE_API_KEY` and `CALLE_BASE_URL` are read as constructor defaults in
`src/providers/calle-provider.js`, evaluated at construction rather than at import, so
merely importing the module has no effect. `CallEProvider` calls `POST /v1/calls` and
polls `GET /v1/calls/:id` until the call reaches one of `completed`/`failed`/`canceled` —
a real call is not synchronous.

**Running a real call places a real phone call and is billed to the CALL-E account behind
the key.** It is a manual, deliberate act, and `npm start` can never do it: the default
provider is the fake one, and the real key lives only in an untracked `.env`.

`task_1`'s seeded suppliers use fictional `+1-555-01xx` numbers (required — see
"Additional Requirements" in `SPEC.md`), so **there is no real number for a real call to
reach** until you supply one. `DEMO_SUPPLIER_PHONE` does that without the number ever
touching a tracked file:

```bash
cp .env.example .env     # then fill in CALLE_API_KEY and DEMO_SUPPLIER_PHONE
npm run start:real       # node --env-file=.env; .env is gitignored
```

Place the call from the dashboard (`http://localhost:3000` → Plan Call → Approve →
Place Call). Repeat runs need no re-typing — the key stays in `.env`. Or run the whole
path headless:

```bash
CALL_PROVIDER=calle CALLE_API_KEY=<your-key> node -e "
const { invoke } = require('./src/invoke');
(async () => {
  await invoke('plan_call', { id: 'task_1', goal: 'Get a quote for WIDGET-42' }, 'owner');
  await invoke('approve_task', { id: 'task_1' }, 'owner');
  console.log(JSON.stringify(await invoke('place_call', { id: 'task_1' }, 'owner'), null, 2));
})();
"
```

## Cancelling and rolling back

There are no recurring or scheduled workflows to cancel — no cron, no queue, no retry
daemon. A call happens only when someone or something explicitly invokes `place_call` on
a task a human has approved.

For a call that is already in flight:

- **`cancel_call`** aborts it. The provider races its own pacing against the abort
  signal, so a call stuck ringing is genuinely interrupted rather than cancelled at the
  next checkpoint. The task lands on `cancelled` and the cancellation is written to the
  activity log with the stage it was interrupted at.
  **With the real provider this cancels the *task*, not the phone call.** CALL-E's Calls
  API "does not expose an operation for clients to cancel a call after it has been
  created", so a call already dialing rings and bills to completion whatever the
  dashboard says. `cancel_call` stops this process waiting for it and nothing more —
  the honest boundary of the abstraction, stated here rather than discovered live.
- **In the dashboard**, that is the **Cancel Call** button on the in-flight strip.
- **After the fact**, `retry_with_plan` clears the outcome, call record and approval
  metadata and returns the task to `planned` — which means it needs a human approval
  again before anything can dial.
- **`reject_task`** refuses to run while a call is in flight, so it cannot race the call's
  own status write. Cancel first, then reject.

State is in memory, so restarting the process is itself a full rollback to the seeded
state.

## Known limitations

- **No persistence.** `src/store.js` is a module-level object; restarting the server
  loses every task and quote and returns to the seeded pair. There is no database.
- **`public/index.html` and `src/dashboard.jsx` are kept in sync by hand.** The HTML file
  (plain `React.createElement`, React from a CDN) is what is actually served; the JSX is
  the readable source of the same component tree. There is no bundler, so an edit to one
  needs the same edit in the other.
- **The real CALL-E integration is a stub, and untested against the live service.**
  `CallEProvider` implements the request/response shape from the spec and is unit-tested
  against fixtures, but no test — and no part of this repository's development — has ever
  called the live endpoint.
- **No authentication.** `actor` is a string in the request body. This is a local demo:
  anything internet-facing would need the owner identity to come from a real session, not
  from the caller's own claim.
- **The activity log grows without bound** for the life of the process.
- **`npm run lint` runs with `--fix`**, so it repairs auto-fixable problems rather than
  failing on them.
- **No agent runner is included.** The agent surface is the HTTP tool registry; wiring it
  to a specific model runtime is left to the caller.
- **`request_human_approval` is a read**, despite the name. It gathers quotes for a person
  to look at and approves nothing.

## Licence

MIT — see [`LICENSE`](LICENSE) at the root of this directory.
