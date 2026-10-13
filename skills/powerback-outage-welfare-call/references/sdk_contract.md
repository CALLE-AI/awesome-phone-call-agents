# Pinned SDK contract

The live path targets exactly one published SDK version:

```bash
pip install calle-ai==1.0.1   # imported as `calle`
```

`CALLE_SDK_VERSION` in `scripts/adapters.py` carries the same string, so the pin is
visible from the code rather than only from documentation.

## The request

Transcribed from `CalleCalls.create` in calle-ai 1.0.1
(`CALLE-AI/server-sdk-python`, tag `v1.0.1`, `src/calle/calls.py`).
`create_and_wait(**kwargs)` forwards everything except `interval_seconds` and
`timeout_seconds` to it.

```python
create(
    *,
    task: str,
    phone: str,                 # single flat destination; replaces recipient/recipients
    region: str | None = None,
    locale: str | None = None,
    idempotency_key: str,       # required; a blank string raises ValueError
    result_schema: JsonObject,  # required
    metadata: JsonObject | None = None,
    webhook_url: str | None = None,
) -> JsonObject                 # POST /v2/calls
```

What this skill sends, built by `RealAdapter.build_request()`:

| Field | Value |
|---|---|
| `task` | The consent task text, disclosure opening first. See `safety.md`. |
| `phone` | The roster number, after `authorise_destination()` — strict ASCII E.164 and on `PB_ALLOWED_DESTINATIONS`. |
| `idempotency_key` | `powerback:<PB_BATCH_ID>:<case_id>:v1`. Durable: a retry of the same case in the same batch cannot place a second call. |
| `result_schema` | The scalar-object schema below. |
| `metadata` | `{"skill": ..., "case_id": ...}` — no phone number, no transcript. |
| `region`, `locale` | Only when the roster row carries them. |

## The result schema

SDK 1.0 requires the `calle.result.scalar-object.v1` profile: scalar properties only,
at most 32 of them, `additionalProperties: false`, **no arrays and no nulls**.

The pre-1.0 schema in `call_result.schema.json` cannot be sent as-is. Two fields had to
change shape:

| Internal shape | Sent to CALL-E | Why |
|---|---|---|
| `needs: ["generator", ...]` | `needs_generator`, `needs_oxygen_refill`, `needs_evacuation`, `needs_medical` — four booleans | arrays are not expressible |
| `battery_hours_left: number \| null` | `battery_hours_left: number`, **optional** | null is not expressible; an absent property means unknown |

`RealAdapter.normalise()` maps the response back onto the internal shape, so
`engine.py`, `triage.py` and the board are unchanged by the SDK version.

## The response

SDK 1.0 removed `structured_result`, the confidence score, the summary and the
provider attempt fields. What remains:

| Field | Used for |
|---|---|
| `error` | Non-null means a technical failure — fail closed. |
| `call_outcome` | `no_answer` / `busy` / `voicemail` / `declined` are ordinary outcomes, each mapped to its own terminal code. |
| `result_status` | Anything other than `ready` fails closed; the engine turns it into `insufficient_data`. |
| `result` | The schema-bound business result. Only this may drive routing. |
| `transcript` | Array of `{speaker, offset_seconds, text}`. Only `user` turns are kept as evidence. |

## Verifying it without placing a call

```bash
python scripts/check_sdk_contract.py
```

Offline: no API key, no network, no SDK import, no call placed. It binds the request
against the published signature and checks the schema against the profile limits.

**What it establishes**: a live request would be accepted by the SDK rather than
raising `TypeError`, and the result schema is within the documented profile.

**What it does not establish**: that a call connects, that the transcript is accurate,
or that the provider behaves as documented. **No live call has been placed from this
skill.** Everything shipped here runs against `FakeAdapter`.

## Legacy versions

`calle-ai` 0.7.x used `recipient` / `recipients`, an optional idempotency key and
`POST /v1/calls`. This skill does not support it. The SDK README states the backend
continues serving legacy integrations until their planned retirement at the end of
2026; pinning 1.0.1 avoids depending on that window.
