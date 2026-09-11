# CallProof Call Analyzer

The evaluation plane for CallProof. Rails submits a versioned call contract and
the provider transcript; this service evaluates the outcome asynchronously and
returns a signed webhook.

This first cut deliberately accepts transcripts instead of audio. It adapts the
useful boundaries from [altur](https://github.com/emezac/altur)—persisted states,
idempotent processing, evidence, and a replaceable evaluator—without duplicating
its speech-to-text pipeline.

## Verification boundary

The deterministic evaluator is an exact-protocol checker, not a natural-language
judge. Contract v2 binds each success claim to an expected structured value and a
closed protocol identifier that deterministically generates the agent statement.
Auto-verification requires that exact statement followed
immediately by an exact permitted recipient response. Required disclosures also use
exact positive statements; arbitrary questions, paraphrases, word lists, stemming,
and topical matches cannot open the gate.

Rules that require proving the absence of free-form behavior, such as a forbidden
commitment, are marked `semantic_only`. The deterministic evaluator reports them as
`unevaluated` and requires human review. A future semantic evaluator may resolve them
claim-by-claim, but must preserve the same `unknown`/HITL default.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn call_analyzer.main:app --reload --port 8001
```

Environment variables:

- `CALL_ANALYZER_DATABASE_PATH` — SQLite file; defaults to `call_analyzer.db`.
- `CALLPROOF_WEBHOOK_SECRET` — shared HMAC secret. **Required.** The service refuses to
  start without it unless you opt in to the development default below.
- `CALL_ANALYZER_ENV` — no default. Set it to `development` or `test` to accept the
  shared `development-secret` when `CALLPROOF_WEBHOOK_SECRET` is unset. It has no default
  precisely so that a deployment which sets neither variable fails loudly rather than
  signing callbacks with a constant published in this repository.
- `CALL_ANALYZER_DELIVER_WEBHOOKS` — set to `false` for isolated local runs.
- `CALL_ANALYZER_QUEUE_MODE` — `inline` for deterministic local runs or `rq` for a worker.
- `REDIS_URL` — required in `rq` mode.

The API is available at `POST /api/v1/analyses`, `GET /api/v1/analyses/{id}`
and `GET /health`.

## Run API and worker separately

```bash
export CALL_ANALYZER_QUEUE_MODE=rq
export REDIS_URL=redis://localhost:6379/0
uvicorn call_analyzer.main:app --port 8001
```

In a second process with the same database path and environment:

```bash
python -m call_analyzer.worker
```

From the repository root, `docker compose up --build` starts Redis, the API,
and the worker. Webhook delivery is disabled in that safe local stack unless
`CALL_ANALYZER_DELIVER_WEBHOOKS=true` is explicitly supplied.
