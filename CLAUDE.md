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

The app is the CareCall SG operator workspace: caregiver-authorized medication reminders and meal check-ins for seniors in Singapore. It is a Vite + React SPA with Vercel serverless functions, backed by Upstash Redis and QStash.

### Layering rule (enforced by tests)

`src/calle/` is a reusable, workflow-agnostic CALL-E adapter. [test/layering.test.ts](apps/typescript/agent-gallery/test/layering.test.ts) fails the build if:

- anything in `src/calle/` imports from `workflows`
- anything in `src/calle/` even *names* a workflow domain concept (`appointment`, `reschedul`, `salon`, `recovery`, …) outside comments
- anything in `src/workflows/` imports `calle/client`, `calle/status`, or `calle/mask` directly instead of the `../../calle` barrel

Workflow-specific logic belongs in `src/workflows/<workflow>/`.

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

- Provider completion is never treated as proof that medication was taken or a meal was eaten; outcomes are conservative and `Self-reported`.
- The operational list endpoint and the Calls console must never return or render full phone numbers, encrypted phone data, operator access codes, caregiver instructions, or transcripts.
- The readiness response returns only booleans, counts, states, ages, and grouped reasons — no job, senior, operator, or phone identifiers.
- Non-English live calls are blocked until quality is verified.

### Phase gating

Work is tracked in numbered phases in [docs/agent-gallery/carecall-sg-ui-plan.md](docs/agent-gallery/carecall-sg-ui-plan.md). Two documents are the source of truth for what is actually proven versus implemented:

- [carecall-pilot-runbook.md](docs/agent-gallery/carecall-pilot-runbook.md) — deployment readiness, queue acceptance matrix, accessibility gate, controlled live-call procedure, stop conditions
- [carecall-phase6-verification.md](docs/agent-gallery/carecall-phase6-verification.md) — completed evidence versus remaining credentialed evidence

Do not mark a phase complete or check a PR checkbox based on implemented code. These records distinguish "implemented locally" from "verified against a credentialed deployment with consenting participants", and that distinction is the point. The PR stays in draft until live-call evidence is recorded.

Environment variables are documented in [carecall-environment-variables.md](docs/agent-gallery/carecall-environment-variables.md) with consumers, setup, renewal triggers, and rotation — and deliberately no values.
