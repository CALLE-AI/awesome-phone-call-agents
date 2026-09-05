# Call Review Console

**Review a CALL-E call before you act on it.** A terminal call task says `task_completed: true` with a structured result. Before that result books an appointment, closes a ticket or updates a CRM, someone — or an agent — should check that the transcript actually supports it, that the callee was told they were talking to an AI, that a "stop calling me" was honoured, and that the conversation was not a wall of six-second silences. This console does that, per call and across every call on file.

Live demo (fixtures only, no key, no calls): https://call-review-console-q62ufgdryq-uc.a.run.app

Roadmap item: `apps/web/call-review-console` ("Review call results, summaries, recordings, transcripts, and follow-up status").

## What it checks

| Check | How | Source |
|---|---|---|
| **Structured result vs. transcript** | every leaf field is matched against the transcript text (numbers spoken, value tokens present); enum/boolean fields are marked *needs reading*; an optional Gemini pass cites the supporting turn for each field | deterministic + optional LLM |
| **Schema validity** | `structured_result` validated against `metadata.result_schema` when present | `jsonschema` |
| **Response latency** | agent turn start − previous callee turn start, from `transcript_turns[].offset_seconds`: p50 / p95, silences > 4 s, overlaps (a turn that starts before the previous one) | arithmetic only |
| **Compliance** | AI disclosure in the agent's turns (and whether it was the first turn), stop/opt-out request detected and honoured, card/ID-like numbers read aloud | regex |
| **Verdict** | `approve` / `needs_human` / `reject` with written reasons; a human disposition and note are recorded per call | rules |
| **Benchmark** | across every call on file: completion, unsupported-claim count, median p50 latency, verdict mix — fixtures are fictional and labelled | aggregate |

## Safety and side effects

- **The console never places a call.** There is no code path that calls `POST /v1/calls`; `crc/live.py` only reads `GET /v1/calls/{id}` and `/events`, and only when `CALLE_API_KEY` is set and a reviewer asks for a specific id.
- **No-call path is the default.** With no key it runs entirely on the fictional fixtures in `fixtures/` (reserved `+1 555 01xx` numbers).
- **Phone numbers are masked** everywhere they render (`+1********23`), including inside the task text.
- **Webhook receiver** (`POST /calle/webhook`) stores terminal events only (`call.completed`, `call.failed`, `call.result_validation_failed`); put it behind your proxy's signature check or a secret path. It never acknowledges anything to CALL-E other than `{ok: true}`.
- No recurring jobs, no schedules, nothing to cancel.

## Run

```bash
cd apps/web/call-review-console
uv venv && uv pip install -e ".[dev]"      # or: pip install -e ".[dev]"
uvicorn crc.app:app --port 8080            # http://localhost:8080 — fixtures only, no key needed
pytest -q                                  # 6 tests: timing, compliance, evidence, verdicts, webhook ingest
```

Opt-in live review of your own calls:

```bash
export CALLE_API_KEY=iams_...              # read-only use
curl -X POST localhost:8080/api/fetch -H 'content-type: application/json' -d '{"call_id":"call_..."}'
```

Optional model-assisted evidence check (cites turns per field): `pip install -e ".[llm]"`, set `GOOGLE_API_KEY` (or Vertex: `GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT=...`) and open a call with `?llm=true` or set `CRC_USE_LLM=true`.

## How this differs from CallProof

[`apps/web/callproof`](../callproof/) verifies one call against an immutable, typed `CallContract` you write before the call (Rails + analyzer service + PostgreSQL/Redis). This console needs no contract and no stack: it reads the shape CALL-E already returns (`structured_result`, `transcript_turns`, `completion_confidence`), so it works on any call you have ever made, adds the transcript-derived latency and compliance metrics nobody gets from the API today, and benchmarks across calls. Use CallProof to gate a high-stakes call before you act; use this to review every call after the fact and see how your scripts perform over time.

## Fixtures

Five fictional terminal snapshots in the `GET /v1/calls/{call_id}` shape: a clean confirmation (`approve`), a result that claims a reschedule the transcript never mentions (`reject`: unsupported claim), a call that ignores "don't call this number again" with no AI disclosure (`reject`), a `no_answer` failure (`reject`), and an overlap-heavy but supported call (`needs_human`).

## Layout

```
crc/timing.py      transcript-derived latency, silences, overlaps
crc/compliance.py  disclosure, stop requests, sensitive readback, phone masking
crc/evidence.py    structured result vs transcript (deterministic + optional Gemini)
crc/review.py      scorecard and verdict rules
crc/live.py        read-only Calls API access
crc/app.py         FastAPI: /api/calls, /api/calls/{id}, /api/calls/{id}/note, /calle/webhook, /api/fetch, /api/benchmark
static/index.html  the console
fixtures/          fictional call tasks
tests/             pytest
```

MIT (same as the repository).
