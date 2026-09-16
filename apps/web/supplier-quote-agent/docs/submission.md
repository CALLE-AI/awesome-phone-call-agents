# Devpost submission — Supplier Quote Agent

Prepared copy for <https://call-e.devpost.com/>. Everything here is text to paste; the
act of submitting is the owner's (tracked on issue #9).

**Deadline: 14 September 2026, 11:45 pm SGT.**

---

## 1. Fields the CALL-E rules actually require

Taken from the hackathon rules page, not assumed.

| Required field | Status | Notes |
|---|---|---|
| A pull request to [`CALLE-AI/awesome-phone-call-agents`](https://github.com/CALLE-AI/awesome-phone-call-agents) following that repo's contribution conventions | **owner** | Body pre-written in [`pr-body.md`](pr-body.md), including the branch name, PR title and commit message that pass their `scripts/check_branch_name.py`. |
| The pull request URL, on the Devpost form | **done** | <https://github.com/CALLE-AI/awesome-phone-call-agents/pull/524> |
| A ~3-minute demo video, public, on YouTube or Vimeo | **done** — <https://youtu.be/3MOBu8sBQvE> (2:39) | Script, shot list and timings in [`video-script.md`](video-script.md); see §5. |
| CALL-E account email address | **owner** | The email on the owner's CALL-E account. |

| Optional field | Status | Notes |
|---|---|---|
| URL to a functional demo application | **owner — likely "not applicable"** | The app runs locally (`npm start` → `localhost:3000`) and is not deployed. Deploying is out of scope for the entry; leave blank or link the repository. |
| CALL-E feedback survey | **owner** | Separately eligible for the Most Valuable Feedback prizes ($200 + 10,000 credits, 5 winners). Worth doing. |

Devpost's own story fields (Inspiration / What it does / How we built it / Challenges /
Accomplishments / What we learned / What's next) are the platform's standard template
rather than a CALL-E requirement; copy for each is in §3.

## 2. Judging criteria, and where each one is answered

The rules page names four criteria. The write-up below is arranged to hit them in order.

| Criterion | The strongest thing to point at |
|---|---|
| **Real World Impact** | Procurement teams genuinely do phone three vendors for the same three numbers. The entry automates the calling and refuses to automate the buying. |
| **Quality of the Idea** | Most call agents put "ask a human first" in a prompt. This one makes approval structurally unreachable from the tool surface — and proves it with tests that try to break in four different ways. |
| **Technical Implementation** | One `invoke()` chokepoint shared by UI and agent; four independent enforcement layers; a provider adapter that makes the real integration unit-testable with zero network. 103 tests, and one real billed call placed end to end (docs/real-call.md). |
| **Product Experience & Demo** | The demo shows an agent *being refused* three different ways before a person clicks Approve — the refusal is the product. |

## 3. Text to paste

### Project name

`Supplier Quote Agent`

### Tagline (Devpost elevator pitch, ~200 characters)

> An outbound-call procurement agent that plans, dials, cancels and re-plans supplier
> calls — and structurally cannot approve one. Approval is a button a person presses, and
> four tests prove no tool can fake it.

### Inspiration

Procurement teams spend hours on the phone asking three vendors the same three questions:
unit price, lead time, minimum order quantity. It is textbook agent work.

It is also work where one over-eager autonomous decision is expensive in a way software
bugs usually are not — a call is a real phone ringing on a real supplier's desk, billed to
a real account, and it cannot be un-rung. Most agent demos handle that by *asking* the
model to check with a human first. We wanted to know what it looks like when the model
cannot do otherwise, no matter how it is prompted.

### What it does

A dashboard holds quote requests. An agent can plan a call against one, dial it, cancel it
mid-ring, and re-plan it after it fails. The call moves through `dialing → connected →
wrapping up → done`, each transition recorded on the task. Results land on the task as a
structured outcome, beside a quote table sorted by price.

The agent cannot approve a call. Between "planned" and "dialing" sits a button only a
person can press. If the agent tries to dial anyway, it is refused and told exactly what
to do instead. If it tries to write the approval through the generic update path, it is
refused. If it calls the approval function directly, bypassing the tool registry
altogether, it is refused.

And a single approval is not a standing licence: re-planning a finished call returns the
task to "planned", so calling that supplier a second time needs a second human press.

### How we built it

Node 20+, Express, React, Jest, ESLint. About 1,250 lines under `src/`, and 950 lines of
tests.

The design rule is that the agent gets no private code path. Every mutation — the
dashboard's button clicks and the agent's tool calls alike — goes through one function,
`invoke(tool, args, actor)`, over one endpoint, `POST /api/invoke`. Each registered tool's
`execute()` body is a single delegating line, so a tool physically cannot reach the data
store without passing the same guards a button passes. Every invocation, refusals
included, is appended to an activity log with the actor's name, which is what makes the
run auditable after the fact.

The approval gate is three mechanisms rather than one:

1. `approve_task` and `reject_task` are never added to the tool registry, so tool
   discovery cannot surface them;
2. both refuse any actor but the owner even when called directly on `invoke()`;
3. the generic `update_task` path is blocked from setting those statuses at all.

Calls go through a small `CallProvider` adapter. The default `FakeCallProvider` is
deterministic — no network, no real timers, canned outcomes from a JSON file — which is
why the whole demo and the whole test suite run with no credentials and place no calls.
`CallEProvider` is the real integration; it takes its `fetch` by injection, so its request
shape and response parsing are unit-tested against fixtures without ever opening a socket.

### Challenges we ran into

Cancelling a call that is genuinely stuck. An abort check between steps only cancels a
call that was going to progress anyway; a call left ringing forever sails straight past
it. The fake provider ended up racing its own pacing delay against the abort signal, so a
`wait` that never resolves on its own is still interrupted — and the test stands in a
promise that never settles, so it fails if that race is ever removed.

The subtler one was realising that the approval gate had a back door. `update_task` took a
free-form `updates` object, so an agent could simply write `{status: "approved"}` and walk
around the whole design. Closing it meant accepting that the generic write path needed a
specific exception — and testing for that exception by name.

The most instructive one came last. Our "real" CALL-E integration had passed its unit
tests against fixtures for days, and was completely non-functional: it POSTed an invented
request body to CALL-E's MCP host, which rejects a static API key because it wants OAuth.
Fixtures had only ever confirmed that our code agreed with itself. Rewriting it against
the documented Calls API — `POST /v1/calls`, then polling until terminal — and then
actually dialing turned up two more things no fixture could have: a real call takes
minutes, not milliseconds, so the poll loop is load-bearing; and `cancel_call` cannot hang
up a real call at all, because the Calls API exposes no client cancellation. The README
says so now rather than implying a Cancel button does more than it does.

### Accomplishments that we're proud of

The refusals are the demo. Watching an agent get told *no* three different ways, then
watching a person click one button and the same agent immediately succeed, communicates
the architecture better than any diagram.

Also: `tests/approval-gate.test.js` asserts against the actual exported registry rather
than reading the source, and checks that no tool matches approve/reject under any
spelling — so the guarantee survives someone adding a tool later without reading this
paragraph.

### What we learned

"The model is instructed not to" and "the model cannot" are different products. The second
one is barely more work than the first if you decide on it early, and it is the difference
between a demo and something a procurement team could actually be handed.

### What's next

Persistence (state is in memory today), a real session-backed identity instead of an
`actor` string in the request body, and an approval queue for teams where the approver is
not the person who set up the request. Validating `CallEProvider` against the live service
was on this list until we did it — see "Challenges", and `docs/real-call.md`.

### Built with

From `package.json`, not from memory:

`node.js` · `javascript` · `express` · `react` · `jest` · `eslint` · `babel` ·
`call-e` · `mcp` · `rest-api`

### Try it out

- Pull request: <https://github.com/CALLE-AI/awesome-phone-call-agents/pull/524>
- Demo video: <https://youtu.be/3MOBu8sBQvE>
- No hosted demo: `npm install && npm start` → <http://localhost:3000>, no credentials
  needed, no calls placed

## 4. What a judge should look at first

1. [`docs/architecture.md`](architecture.md) — the three-layer gate, with diagrams.
2. `tests/approval-gate.test.js` — the four independent break-in attempts.
3. The demo walkthrough in [`../README.md`](../README.md) — real captured output of an
   agent being refused and then succeeding.

## 5. Video

Must be public on YouTube or Vimeo and approximately three minutes.

**The script is [`video-script.md`](video-script.md)** — narration, shot list, timings,
and the exact seeded state to start recording from. It is the authority; do not improvise
a different shot list from this file.

Two things from that script worth knowing before you plan the recording, because both
were found by actually running the app rather than reading the code:

- **Scripted length is ~2:15, hard ceiling 2:42.** "Approximately 3 minutes" in the rules
  is a target, not a licence to overrun.
- **There is no in-flight animation to film.** With the fake provider's default pacing,
  `place_call` jumps from `approved` straight to `completed`; the `Dialing… / Connected /
  Wrapping up…` strip and the Cancel Call button never render. Cut from the click to the
  outcome card.

Record with `CALL_PROVIDER` unset so the fake provider is in use and no call is placed.

## 6. Before the owner submits

- [ ] Fill in the CALL-E account email
- [x] Decide the `LICENSE` copyright holder — it currently reads `Copyright (c) 2026` with
      no name (see [`submission-checklist.md`](submission-checklist.md))
- [x] Decide `package.json`'s `"author"` field, currently `"Claude Code"`
- [x] Record and publish the video following [`video-script.md`](video-script.md), then paste the URL — <https://youtu.be/3MOBu8sBQvE>, public, 2:39
- [x] Open the PR (see [`pr-body.md`](pr-body.md)) and paste its URL — <https://github.com/CALLE-AI/awesome-phone-call-agents/pull/524>
- [ ] Consider the feedback survey — a separate prize category
