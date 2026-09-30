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
- **Contact details are redacted at ingest, before anything reaches disk** (`crc/sanitize.py`), in every written form: E.164, `(555) 010-0123`, `555.010.0777`, email addresses, card-shaped and government-id-shaped runs. Masking only at render time left the raw values sitting in the stored snapshot. Timestamps, clock times, dates and decimals are protected before redaction and restored after, so `created_at` survives and the timing analysis still works. The compliance signal is computed *before* the digits are removed and recorded on `metadata.pii`, so "the agent read a card number back" is still reported without keeping the number.
- **Phone numbers are masked again on the way out** (`+1********23`), in the recipient records and in every string anywhere in the payload, so the render path does not depend on redaction having caught everything.
- **Nothing is served anonymously.** Every `/api/*` route requires the console token. The server mints an ephemeral one per process and prints it at startup; set `CRC_CONSOLE_TOKEN` for a stable one.
- **The webhook fails closed.** `POST /calle/webhook` requires `CRC_WEBHOOK_TOKEN` in an `X-CRC-Token` header, and with no token configured it refuses every delivery with a 503 rather than storing payloads from whoever finds the URL. CALL-E deliveries are unsigned as of SDK 0.7, so there is nothing else to authenticate them by.
- **Call ids are allow-listed** (`^[A-Za-z0-9._-]{1,128}$`) before one becomes a filename or reaches the browser. An id arrives from the URL and from unsigned webhook deliveries, so it may not contain a path separator, a parent-directory hop, or a quote.
- **The API key only leaves for an allow-listed host, over https** — `api.heycall-e.com` by default, `CALLE_ALLOWED_HOSTS` to override for a private deployment.
- No recurring jobs, no schedules, nothing to cancel.

## Run

```bash
cd apps/web/call-review-console
uv venv && uv pip install -e ".[dev]"      # or: pip install -e ".[dev]"
uvicorn crc.app:app --port 8080            # http://localhost:8080 — fixtures only, no key needed
# The server prints a console token for the run. Paste it when the page asks.
# Set CRC_CONSOLE_TOKEN to keep a stable one; the console is never anonymous.
pytest -q                                  # 62 tests: timing, compliance, evidence, verdicts, webhook ingest,
                                           # SDK-backed fetch, redaction, path and origin guards
```

## Environment

| Variable | Effect |
|---|---|
| *(none)* | fixtures only, no key, ephemeral console token printed at startup |
| `CRC_CONSOLE_TOKEN` | stable console token instead of the per-process one |
| `CRC_WEBHOOK_TOKEN` | **required** for `POST /calle/webhook`; unset means every delivery is refused |
| `CRC_DEMO` | marks a **published fixtures-only demo**: `/api/ping` then publishes the console token so a hosted link is usable. Needs `CRC_CONSOLE_TOKEN` set explicitly (the random per-process token is never published) and no `CALLE_API_KEY` (a deployment that can reach real calls is not a demo). It does not weaken the routes: a request without the token is still refused. |
| `CALLE_API_KEY` | enables opt-in read-only fetch of your own calls by id |
| `CALLE_ALLOWED_HOSTS` | hosts the key may be sent to (default `api.heycall-e.com`, https only) |
| `CALLE_BASE_URL` | API origin, checked against the allow-list above |
| `CRC_DATA_DIR` | where redacted snapshots and review notes are written |
| `CRC_USE_LLM`, `CRC_MODEL` | turn on the optional Gemini evidence pass and pick the model |
| `GOOGLE_API_KEY` *or* `GOOGLE_GENAI_USE_VERTEXAI` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` | credentials for that pass |

Opt-in live review of your own calls:

```bash
export CALLE_API_KEY=iams_...              # read-only use
curl -X POST localhost:8080/api/fetch -H "X-CRC-Console: $CRC_CONSOLE_TOKEN" \
     -H 'content-type: application/json' -d '{"call_id":"call_..."}'
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
crc/sanitize.py    ingest-time redaction of contact details, with timestamps preserved
crc/security.py    call-id allow-list, API egress allow-list, console and webhook tokens
crc/store.py       snapshot and review-note persistence, under CRC_DATA_DIR
crc/app.py         FastAPI: /api/calls, /api/calls/{id}, /api/calls/{id}/note, /api/fetch,
                   /api/benchmark, /api/health, /api/ping, /calle/webhook
static/index.html  the console
fixtures/          fictional call tasks
tests/             test_review.py (rules), test_security.py (redaction, guards, tokens)
```

MIT (same as the repository).
