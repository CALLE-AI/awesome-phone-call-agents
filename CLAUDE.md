# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

[AGENTS.md](./AGENTS.md) is the authoritative contribution contract for this repository (scope, directory rules, skill/app/plugin design rules, phone-call safety rules). This file covers commands and architecture; it does not restate AGENTS.md.

Two rules from it are worth repeating because they are easy to violate accidentally:

- **English-only.** All repository-facing content must be English. The validator enforces this and will fail CI on non-English prose.
- **Recurrence belongs to the host scheduler**, not the call provider. The provider places exactly one call per scheduled run. Do not make provider-side recurrence mandatory.

## Repository-wide commands

```bash
python3 scripts/validate_repository.py
```

Run this after **any** edit. It is the entire CI job ([.github/workflows/validate.yml](.github/workflows/validate.yml)) and the only gate on `main`.

Branch names are validated by a pre-push hook. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

Create branches through the helper so the name is checked before the branch exists:

```bash
python3 scripts/create_branch.py <type>/<short-kebab-summary>
```

Branch/commit/tag/PR formats live in [docs/git-naming-conventions.md](docs/git-naming-conventions.md). Commits follow Conventional Commits with a directory-derived scope, e.g. `feat(agent-gallery): ...`.

### The validator is not a linter

`scripts/validate_repository.py` is ~9,000 lines of bespoke, content-level assertions, not a style checker. It asserts on exact strings and orderings inside specific files — README table rows must match the skills and apps that exist, `SKILL.md` frontmatter shape, referenced local paths inside skills must resolve, app/plugin documentation requirements, and literal code snippets inside `plugins/dify-template/`. Editing those files without running the validator will break CI in ways that are not obvious from the diff. Read the relevant `validate_*` function before restructuring anything under `skills/`, `plugins/`, `apps/README.md`, or the root `README.md`.

## Repository layout

| Directory | Contents |
| --- | --- |
| `skills/` | Installable Agent Skills (`SKILL.md` + `references/`, `scripts/`, `assets/`) |
| `apps/` | Runnable apps and integration demos, grouped `apps/<language>/<app-name>/` |
| `plugins/` | No-code / low-code workflow platform nodes and templates (n8n, HubSpot, Dify) |
| `docs/` | Long-form guidance; per-feature subdirectories |
| `scripts/` | Repository validation and branch-name tooling |

There is no workspace root package manager. Each app under `apps/` is self-contained with its own `package.json` or `pyproject.toml`; run commands from inside the app directory.

## Per-app commands

Script names are **not** uniform across apps — check the app's `package.json` before assuming. Common shapes:

- TypeScript apps: `npm run check` (tsc --noEmit) and `npm test`
- Broker/OAuth login clients: `npm run test:e2e` against [apps/shared/fake-mcp-broker-server.mjs](apps/shared/fake-mcp-broker-server.mjs)
- Python apps: `uv run pytest` (or `python -m pytest -q`) from the app directory

### agent-gallery (the actively developed app)

From `apps/typescript/agent-gallery/`:

```bash
npm run verify
```

That is `check && test && build` — the standard pre-commit gate for this app.

```bash
npm run dev
```

Individual tests use the Node test runner via `tsx`:

```bash
npx tsx --test test/call-queue.test.ts
```

```bash
npx tsx --test --test-name-pattern="rejects an empty window list" test/schedules.test.ts
```

Tests never require credentials and never place calls. Keep it that way — see the app design rules in AGENTS.md.

```bash
npm run preflight
```

Preflight reads the protected readiness endpoint of a **deployed** environment. It requires `CARECALL_PUBLIC_BASE_URL` and `CRON_SECRET` injected from the deployment secret store, places no call, and returns no secret values.

## agent-gallery architecture

The app is the CareCall SG operator workspace: caregiver-authorized reminders and check-ins for seniors in Singapore, across five routine kinds (medication, meal, hydration, wellbeing, appointment). It is a Vite + React SPA with Vercel serverless functions, backed by Upstash Redis and QStash.

`npm run dev` is Vite only — it does **not** serve `/api`, and there are no local CareCall credentials. Anything behind operator sign-in (the Calls console) cannot be exercised by running the dev server; stub `window.fetch` in the page to drive those components, or deploy.

### Layering rule (enforced by tests)

`src/calle/` is a reusable, workflow-agnostic CALL-E adapter. [test/layering.test.ts](apps/typescript/agent-gallery/test/layering.test.ts) fails the build if:

- anything in `src/calle/` imports from `workflows`
- anything in `src/calle/` even *names* a workflow domain concept (`appointment`, `reschedul`, `salon`, `recovery`, …) outside comments
- anything in `src/workflows/` imports `calle/client`, `calle/status`, or `calle/mask` directly instead of the `../../calle` barrel

Workflow-specific logic belongs in `src/workflows/<workflow>/`.

### Client state versus durable state

This split is not obvious from the file tree and is the thing most likely to mislead:

- **Seniors and routines have no server-side store.** They live in demo-session React context — [senior-directory-context.tsx](apps/typescript/agent-gallery/src/carecall/senior-directory-context.tsx) and [routine-directory-context.tsx](apps/typescript/agent-gallery/src/carecall/routine-directory-context.tsx), seeded from `fixtures.ts`. Nothing is persisted or sent to the server. A senior also exists as an ID in `CARECALL_OPERATORS_JSON` (the authorization scope) and as a denormalized snapshot inside each schedule/job.
- **Schedules, jobs, leases, cases, and audits are durable** in Redis.

Six modules read seniors and five read routines. Always go through the context hooks, never `import { seniors } from "./fixtures"` — a direct fixture import silently ignores edits, withdrawals, and newly created routines. The pure transition logic sits beside each context in `senior-directory.ts` and `routine-directory.ts`, which is what the tests exercise (there is no DOM test setup).

### Derive operator-facing text from the enforcing code

The interface must not describe behaviour the workflow does not implement. Two places already follow this and should not be turned into hand-written prose:

- the conversation plan and per-kind boundary come from [routine-kinds.ts](apps/typescript/agent-gallery/src/carecall/routine-kinds.ts), so the preview matches what the agent is instructed to do
- the safety policy assembles its per-kind boundaries, permitted outcomes, flag meanings, and urgency levels from the enforcing modules ([safety-policy.ts](apps/typescript/agent-gallery/src/carecall/safety-policy.ts)), with `test/safety-policy.test.ts` failing on drift

### Server-side modules

`api/_lib/` holds the durable core, and it is where the safety-critical logic lives:

- `call-queue.ts` — the durable job queue, the single global active-call lease, and `queueOperationalSnapshot` (the only live Redis read behind readiness)
- `calls.ts` — CALL-E provider calls, env shape, daily call limits, durable request claims
- `durable-store.ts` — Upstash Redis REST access
- `operator-auth.ts` — signed operator sessions, senior-scoped authorization
- `schedules.ts` — recurring schedules with Singapore wall-clock validation
- `readiness.ts` — the protected preflight endpoint

`api/carecall/` exposes the HTTP routes: `worker.ts` (QStash-delivered job execution), `scheduler.ts` (cron reconciliation), `schedules.ts`, `jobs/`, `cases.ts`, `readiness.ts`.

### Execution model

Exact-time execution comes from **QStash delayed delivery**, not the cron. QStash delivers a signed message containing only a job ID to `/api/carecall/worker`, which verifies both current and next signing keys before reading the encrypted job from Redis. Phone numbers stay encrypted at rest and never enter queue messages.

The queue permits **one ongoing call at a time** via a renewable durable lease. Later jobs stay queued with a visible position. Manual authorization expires after 30 minutes rather than waiting indefinitely.

Immediately before dialing, the worker re-checks operator/senior scope, schedule state and review period, the senior's permitted Singapore call window, daily limits and durable idempotency, and cancellation. Uncertain provider creation, lost leases, missed occurrences, and revoked access all route to `needs_review` — never to a blind redial.

The Vercel cron in [vercel.json](apps/typescript/agent-gallery/vercel.json) runs **once daily** (Hobby plan constraint) and is a reconciliation safety net only. It repairs state and never places a late call.

### Safety invariants to preserve

- **CareCall is the only workflow, and every server entry point requires a signed operator session** scoped to the senior being called. `handleCreateCall` and `handleGetCallStatus` have no unauthenticated branch and no second payload shape. They were previously dual-mode, carrying an appointment-recovery workflow behind a shared `OPERATOR_ACCESS_CODE`; that workflow and its gate are gone. Do not reintroduce a `careCall ? … : …` split here — a handler that serves two request shapes is where an unauthenticated path gets in.
- Provider completion is never treated as proof that anything was taken, eaten, drunk, or attended; outcomes are conservative and `Self-reported`.
- **Each routine kind may only report outcomes from its own vocabulary.** `OUTCOMES_BY_KIND` in [result.ts](apps/typescript/agent-gallery/src/workflows/carecall/result.ts) is a complete `Record<CareCallRoutineKind, …>`, so adding a kind without a vocabulary is a type error. It was previously a two-way branch that silently gave any new kind the *meal* outcomes — do not reintroduce a fallback. An outcome outside the kind's list becomes `uncertain`.
- A wellbeing check-in records only what the senior said. It does not assess mood or screen for anything, and a reported low mood escalates for human contact rather than being interpreted. An appointment reminder repeats only caregiver-confirmed details and never books, moves, or cancels.
- Safety flags are advisory: they record that wording appeared, not who said it or that it is true. Any flag other than `possible_immediate_danger` forces the outcome to `uncertain`. Every flag needs a label, meaning, and operator response in [safety.ts](apps/typescript/agent-gallery/src/workflows/carecall/safety.ts) — never surface a bare identifier.
- The operational list endpoint and the Calls console must never return or render full phone numbers, encrypted phone data, operator access codes, caregiver instructions, or transcripts. A senior record stores only a masked number; the E.164 number is supplied at authorization time.
- The readiness response returns only booleans, counts, states, ages, and grouped reasons — no job, senior, operator, or phone identifiers.
- Non-English live calls are blocked until quality is verified.
- The permitted call window is stored in a 12-hour form that a strict regex parses, and an unparsable window fails **closed** — silently blocking every call for that senior. Anything that writes a window must validate it with `isPermittedCallWindowFormat` first.

### Phase gating

Work is tracked in numbered phases in [docs/agent-gallery/carecall-sg-ui-plan.md](docs/agent-gallery/carecall-sg-ui-plan.md). Two documents are the source of truth for what is actually proven versus implemented:

- [carecall-pilot-runbook.md](docs/agent-gallery/carecall-pilot-runbook.md) — deployment readiness, queue acceptance matrix, accessibility gate, controlled live-call procedure, stop conditions
- [carecall-phase6-verification.md](docs/agent-gallery/carecall-phase6-verification.md) — completed evidence versus remaining credentialed evidence

Do not mark a phase complete or check a PR checkbox based on implemented code. These records distinguish "implemented locally" from "verified against a credentialed deployment with consenting participants", and that distinction is the point. The PR stays in draft until live-call evidence is recorded.

Environment variables are documented in [carecall-environment-variables.md](docs/agent-gallery/carecall-environment-variables.md) with consumers, setup, renewal triggers, and rotation — and deliberately no values.
