# CALL-E Demo Video — Script & Shot List

Deliverable for issue #8. The owner records the final video (issue #9); this document
is everything they need to do it without improvising: narration text, shot list, the
exact seeded state to start from, and the timing budget.

## Target runtime

**Scripted length: ~2:15. Hard ceiling: 2:42** (Devpost asks for "approximately 3
minutes"; the issue's DoD asks for under 3:00 with 10% headroom, i.e. 2:42). Scene 5 is
the one segment with real, unscripted duration (an actual phone call) — see "Timing
contingency" below for what to trim if it runs long.

## Recording setup — exact seeded state

Do this once, then start recording immediately — the opening shot **is** the untouched
seeded state:

```bash
cd entries/call-e
npm install
CALL_PROVIDER=fake npm start   # http://localhost:3000, fake provider is already the default
```

Open two windows side by side before hitting record:
1. **Browser**, `http://localhost:3000`, scrolled to the top.
2. **Terminal**, cwd `entries/call-e`, font large enough to read on screen.

Do not click anything before recording starts. The seeded state that must be on screen
at 0:00 is:
- Task card "Widget-42 Quote Request" — status **pending**, SKU `WIDGET-42`, qty `100`,
  deadline `2026-09-15`, suppliers `Acme Corp, TechVend Inc, Global Parts Ltd`, a single
  "Plan Call" button.
- Quotes table — one seeded row, Acme Corp / WIDGET-42 / $12.50 / 5 days / completed.
  This row is historical sample data the app ships with; the demo does not touch it and
  no new row appears during the run (see "What this script does not show" below).
- Activity Log — "No activity yet".

## Findings from the dry run that shaped this script

Confirmed by actually running the app (fake provider) and walking the path end to end
before writing a single line of narration:

- **`place_call` resolves in one HTTP round trip, not several seconds.** The fake
  provider's default pacing (`wait: () => Promise.resolve()`) means clicking "Place
  Call" on an approved task jumps straight from `approved` to `completed` with the
  outcome card already populated — there is no on-screen "Dialing… / Connected /
  Wrapping up" interval to film. That in-flight strip and the "Cancel Call" button exist
  in the code but are only reachable in tests that inject a `providerOptions.wait`
  override the dashboard never sends. **Do not wait for an animation that isn't
  coming — cut straight from the click to the outcome.**
- **`place_call` never adds a row to the Quotes table.** The outcome lands on the task
  itself (an Outcome card: `outcome` / `summary` / `next_action`), not as a new
  supplier row — `store_quote_result` was removed from the agent-facing tool registry
  in issue #6. Narrate the Outcome card and the Activity Log, not the Quotes table.
- **There is no dashboard button that can trigger the refusal.** "Place Call" is only
  rendered once a task is already `approved`, so the refusal has to be shown by calling
  the same API the dashboard and the agent both use, from the terminal.
- Exact text confirmed live against a freshly started server (2026-09-08):
  - Refusal error: `Task task_1 must be approved by the owner before calling (status:
    "pending"). Ask the owner to approve it from the dashboard — no tool call can
    approve a task.`
  - Plan Call's auto-filled goal (shown on the card as "Plan: …"): `Get a quote for
    WIDGET-42 (qty 100)`
  - Outcome card, fake provider's `default` scenario: Outcome `quoted`, Summary
    `Supplier answered and provided pricing, lead time, and payment terms.`, Next
    action `review_quote`.

## Shot list & narration

| # | Time | Visual | Action | Narration (verbatim) |
|---|------|--------|--------|------------------------|
| 1 | 0:00–0:08 | Browser, seeded dashboard, task card status **pending** | No action — hold on the seeded state | "This is CALL-E: an agent that calls suppliers for quotes. It can never dial without a human's yes. Watch it try anyway." |
| 2 | 0:08–0:30 | Cut to terminal | Run: `curl -s -X POST localhost:3000/api/invoke -H 'Content-Type: application/json' -d '{"tool":"place_call","args":{"id":"task_1"},"actor":"agent"}'` — zoom/highlight the `"error"` field in the response | "The agent asks to dial task one right now. Refused: 'must be approved by the owner before calling... no tool call can approve a task.' That's not a UI restriction — it's enforced in the same function every call goes through." |
| 3 | 0:30–0:50 | Cut to browser | Click **Plan Call** on the pending task card | "So it plans the call first. The plan — goal, what counts as success — lands on the task, and status moves to 'planned'. Now it's the owner's move." |
| 4 | 0:50–1:05 | Browser, same task card | Click **Approve** | "The owner reviews the plan and approves it. `approve_task` only runs for the owner — it isn't a tool the agent has access to at all, so this is the only door into 'approved'." |
| 5 | 1:05–1:35 (flexible, see below) | **[OWNER RECORDS LIVE]** — real outbound call via the real CALL-E provider, per README.md "The one real call" | Owner runs the real-provider command (`CALL_PROVIDER=calle …`) once, off-camera setup, on-camera dial | Suggested line, record fresh: "The owner clicks Place Call. The agent dials a real supplier line, asks for price, lead time, and minimum order quantity, and hangs up. It never places an order — it only listens and reports back." |
| 6 | 1:35–1:58 | Browser, task card now **completed** | Scroll to show the Outcome card, then the Activity Log | "The outcome lands the moment the call ends — structured, not a transcript dump: outcome, summary, next action. The log underneath shows exactly who did what: the agent planned and dialed, the owner approved. Nobody else touched this task." |
| 7 | 1:58–2:15 | Browser, pull back to the full dashboard | Hold on the completed card | "One button the agent can never press: Approve. That's the whole safety story, and it just ran end to end." |

## Timing contingency

Scene 5 is the only segment without a scripted duration — it's a real phone call. Budget
30 seconds nominal; up to 45 seconds is still safely inside the 2:42 ceiling. If it runs
longer than that, cut Scene 7 to its first sentence only ("One button the agent can
never press: Approve.") rather than rushing Scenes 3–4 — the approval gate is the
thesis of the entry and needs to read clearly.

## Rehearsal fallback for Scene 5

Until the owner records the real call (issue #9), rehearse Scene 5 on the fake provider
so the rest of the script's timing can be validated: click **Place Call** on the
approved task. It resolves to the same Outcome card in well under a second — narrate
"On the fake provider used for testing, this same click resolves instantly to the same
structured outcome" instead of the real-call line, and move on to Scene 6. Do not use
this fallback in the submitted video; Scene 5 must be the real call, clearly labeled as
such if any placeholder frame is ever visible in an intermediate cut.

## What this script does not show

- The "Dialing… / Connected / Wrapping up" in-flight strip and the "Cancel Call"
  button — not reachable from the dashboard with the default fake provider (see
  "Findings" above). Not part of this script.
- A new row appearing in the Quotes table — `place_call`'s outcome lands on the task,
  not the Quotes table. Don't imply otherwise in narration or captions.
- Reject / Retry-with-plan — real features, exercised by `tests/demo-script.test.js`,
  but outside this issue's four required beats (plan approved, a real call, the
  structured outcome landing, the agent refused without approval) and cut here to keep
  runtime well under the ceiling.

## Dry-run verification (this goal)

Walked the full path above against a freshly started server before writing the shot
list, once via direct API calls (`curl` against `/api/invoke`, matching exactly what
the dashboard and the agent both call) and once by clicking through the live dashboard
in a browser: pending → refused `place_call` → `plan_call` → `planned` → `approve_task`
→ `approved` → `place_call` → `completed` with the outcome card populated exactly as
scripted above. No step required improvisation; no on-screen claim above goes beyond
what that run produced.
