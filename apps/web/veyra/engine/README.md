# Veyra Engine

The workflow-authoring half of Veyra, as a standalone Python/FastAPI service instead of
Next.js API routes. It owns **generation, validation, natural-language editing, and
compilation** of the `Workflow` graph described in `web/types/workflow.ts` and
`TECHNICAL_ARCH.md`.

It deliberately does **not** own:

- Dispatching calls to CALL-E, or holding `CALLE_API_KEY` — that stays in
  `web/lib/calle/client.ts` and `web/scripts/dispatch-worker.ts` in the Next.js app.
- Persistence — no database, no Supabase client. Every endpoint is a pure function of
  its request body; nothing here survives a restart. Whoever calls the engine (the
  Next.js routes under `web/app/api/workflows/`) is responsible for saving the result.
- Auth, campaigns, contacts, webhooks — all Next.js/Supabase concerns.

This mirrors the "workflow authoring" vs. "campaign execution" split: authoring produces
a `Workflow`, then a compiled `{ task, result_schema }`; execution (a separate concern,
in the Next.js app) takes that compiled request and actually places the call.

## Why a separate service

Two reasons to reach for FastAPI here instead of another Next.js API route:

1. Gemini's JSON mode plus `response_json_schema` (real JSON Schema, `$defs`/`$ref`
   included) is a clean fit for "the model must emit a `Workflow` matching this exact
   schema, or emit a full corrected one from an edit instruction" — including the one
   recursive part of the schema (`OutcomeField.items` / `properties`), which Gemini's
   stricter OpenAPI-subset `response_schema` mode can't express.
2. Keeping the engine credential-free (only `GEMINI_API_KEY`, nothing CALL-E- or
   Supabase-related) and stateless makes it trivially safe to run, test, and redeploy
   independently of the Next.js app.

## Running it

```bash
cd engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in GEMINI_API_KEY
uvicorn main:app --reload --port 8008
```

`main.py` at the top of `engine/` is a one-line re-export of the real app in
`app/main.py`, so the run command doesn't need the `app.` package prefix. Without
activating the venv, the equivalent is `./.venv/bin/uvicorn main:app --reload --port
8008`.

Tests (no network, no Gemini key needed — they exercise the compiler, the graph
validator, and the CALL-E schema-subset check against the ported sample workflow, plus
the FastAPI routes that don't call Gemini):

```bash
./.venv/bin/pytest
```

The Makefile provides the normal development workflow. Ruff is resolved through `uv`,
so it does not need to be installed into the engine virtualenv:

```bash
make help          # list commands
make format        # fix lint/import ordering, then format
make lint          # lint and import-order check only
make format-check  # formatting check only
make test          # complete pytest suite
make check         # format-check + lint + tests, suitable for CI
make run           # start the engine on port 8008
```

## Endpoints

| Route | Method | Body | Does |
|---|---|---|---|
| `/health` | GET | — | liveness check |
| `/workflows/generate` | POST | `{ "prompt": string }` | Calls Gemini to produce a new `Workflow`, auto-assigns node `x`/`y` via a layered layout, runs graph validation, returns `{ workflow, errors, warnings }` |
| `/workflows/edit` | POST | `{ "workflow": Workflow, "instruction": string }` | Calls Gemini with the current workflow + a natural-language instruction, returns the full updated `Workflow` (same response shape as generate) |
| `/workflows/validate` | POST | `{ "workflow": Workflow }` | Structural (Pydantic) + semantic (graph) validation only, no Gemini call — `{ valid, errors, warnings }` |
| `/workflows/compile` | POST | `{ "workflow", "campaign_id", "contact", "webhook_url" }` | Flattens the graph into `{ task, result_schema, metadata, webhook_url }` — the same shape the compilation layer is specified to produce |

Every `/workflows/*` route is gated by the optional shared secret
(`ENGINE_SHARED_SECRET`, sent as `Authorization: Bearer <secret>`). When the secret is
unset, local development remains open. `/health` is always ungated.

## What each file does

- `app/models/workflow.py` — Pydantic mirror of `web/types/workflow.ts`. Same fields, same
  camelCase wire format (via aliases), same "treat this as the source of truth" rule:
  change the TS type, change this file too.
- `app/models/campaign.py` — mirror of the `Contact` and `CalleCallRequest` shapes from
  `web/types/campaign.ts` that the compiler needs.
- `app/calle_schema.py` — direct port of `web/lib/validation.ts`'s
  `assertCalleSchemaSubset` / reserved-recipient-field checks. Runs over every
  `result_schema` the compiler produces before it's returned.
- `app/graph_validation.py` — the semantic checks a JSON-schema check alone can't catch:
  exactly one start node, at least one terminal, no dangling edges, no unreachable
  nodes, no dead ends, qualification rules referencing fields nodes actually capture,
  outcome-schema field sanity. Errors block; warnings don't (hackathon-speed call,
  matching 5.4's "default rather than block" philosophy).
- `app/generator.py` — the Gemini call. Forces structured output via
  `response_mime_type: "application/json"` + `response_json_schema` instead of "return
  JSON only" + fence-stripping. Retries once with the validation error appended on a
  schema failure, matching TECHNICAL_ARCH 5.3. Also computes node layout (BFS depth from
  start) since the schema requires `x`/`y` and the model isn't asked to invent a layout.
- `app/compiler.py` — the flattening logic from TECHNICAL_ARCH section 7: walks nodes
  depth-first from start (so the main line of the conversation stays contiguous and a
  short-circuit branch like a "No" edge to a terminal doesn't get interleaved into the
  middle of it), presents authored node copy as required conversational intent rather
  than a verbatim script, renders conditional edges as "if X then continue to Y" clauses,
  folds qualification rules into a plain-language scoring paragraph, derives
  `result_schema` from `outcomeSchema` (including a `next_step` enum field so the
  permitted disposition values actually survive into what CALL-E is asked to extract),
  and runs the CALL-E schema-subset check before returning.
- `app/main.py` — the FastAPI routes above; thin, no business logic of its own.
- `app/sample_workflow.py` — Python port of `web/lib/sample-workflow.ts`, used by the tests
  so compiler/validator behavior can be checked against a known-good fixture without
  spending a Gemini call.
- `app/config.py` — env loading. Only `GEMINI_API_KEY`, `GEMINI_MODEL`, and the optional
  `ENGINE_SHARED_SECRET`.
- `main.py` (top-level, not under `app/`) — one-line re-export of `app.main:app`, so
  `uvicorn main:app --reload` works without the package prefix. Not where any logic
  lives.

## Wired into the Next.js app

The Next.js app lives in `web/` (a sibling of this directory) — see its own paths below
relative to `web/`, not to this README's location.

- `web/lib/engine-client.ts` — the only file allowed to call this service; every other
  file goes through it, following the same boundary `web/lib/calle/client.ts` provides
  for CALL-E.
- `web/app/api/workflows/generate/route.ts` — `requireUser()`, calls `/workflows/generate`,
  saves the result to `public.workflows` with `user_id: user.id`.
- `web/app/api/workflows/[id]/route.ts` — `GET` loads a saved workflow (RLS-scoped),
  `PATCH` saves graph edits made in the visual editor.
- `web/app/api/workflows/[id]/edit/route.ts` — `POST { instruction }`, calls
  `/workflows/edit` with the saved workflow, persists the result.
- `web/app/api/workflows/[id]/compile/route.ts` — saves and compiles the edited workflow,
  then creates the owned Phase 2 campaign/contact records.
- `web/app/api/campaigns/[id]/compile/route.ts` — recompiles the persisted workflow for
  the campaign's contacts before CALL-E preview approval.

The web application compiles up to ten contacts independently, reserves durable
call-result records, queues each approved call once, and captures terminal CALL-E webhook
results. Live mode requires every recipient to be explicitly authorized during preview.
The engine itself stays stateless and credential-free throughout.
