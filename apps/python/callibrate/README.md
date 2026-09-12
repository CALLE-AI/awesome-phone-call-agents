# Callibrate

**Call the source. Calibrate the record.**

Callibrate phones the authoritative source with CALL-E, reads the transcript by
rule, and corrects the record only when the evidence is in the words that were
said. Everything else goes to a person.

Every operational record drifts away from the world it describes. A food pantry
changes its hours in June and the directory finds out in October, when somebody
takes two buses to a locked door. Callibrate closes that loop by making a phone
call the way a database makes a write: a contract stated in advance, a
transcript as the record of what happened, and a deterministic policy deciding
what the conversation was allowed to change.

```
 trigger ──▶ Verification Contract ──▶ CALL-E ──▶ Call Evidence ──▶ policy ──┬──▶ record
 stale                what must be      the real     the transcript,   4 rules │
 report               established,      call         read by rule              └──▶ a person
 request              what may change
```

The reference application here is a community resource directory (Open Referral
HSDS 3.2). The primitive underneath it is not.

Full repository, demonstration film and deployment notes:
<https://github.com/Marc-Dvci/Callibrate>

---

## No call by default

`CBR_CALLER_MODE=pilot` is the default and dials nothing. It replays seven
scripted conversations through the same normaliser, the same readback
corroborator, the same reconciler and the same policy as a real CALL-E run. It
is labelled `pilot-line` in the ledger and in the console, and two of its
scripts exist in order to fail.

```bash
uv venv && uv pip install -e ".[dev]"
callibrate serve            # http://localhost:8000, judge / callibrate-demo-2026
```

Print exactly what CALL-E would be told for a queued record, without calling
anybody:

```bash
callibrate contract task_food
```

## Turning on real calls

```bash
npm install -g @call-e/cli
callibrate calle login                  # brokered browser login
callibrate calle status                 # confirms the token and lists the three tools

export CBR_CALLER_MODE=calle
export CBR_CALL_ALLOWLIST=+15550101101  # the only numbers this deployment can ring
export CBR_DEMO_PROVIDER_PHONE=+15550101101
callibrate serve
```

`CBR_CALL_ALLOWLIST` is empty by default, which means **no live call can be
placed at all**. It is the first gate, checked before a plan is created.

## How CALL-E is used

`src/callibrate/calling/` is the only place that knows CALL-E exists.

- `mcp.py` is an MCP client for `/mcp/openagent_oauth` over Streamable HTTP:
  brokered login with a local token cache, `initialize`, `tools/list`, and
  `tools/call` for `plan_call`, `run_call` and `get_call_run`. Callibrate is a
  server rather than an agent host, so it speaks the protocol directly.
  `structuredContent` is preferred, and a JSON object in any text block of
  `content` is the documented fallback.
- `calle.py` renders a Verification Contract into the call goal, plans, runs,
  and follows the run to a terminal status. The `run_id` is persisted before the
  first poll, so a crash between starting a call and reading it resumes
  `get_call_run` instead of dialling anybody twice. A `run_call` that returns no
  `run_id` is escalated for operator recovery and never retried.
- `pilot.py` is the no-call path, and it gets no shortcuts.

## Side effects

| Action | Effect |
| --- | --- |
| `callibrate serve` with `CBR_CALLER_MODE=pilot` | None. No network call to CALL-E, no telephone. |
| `callibrate serve` with `CBR_CALLER_MODE=calle` | Pressing *Verify* places **one real outbound call** to an allowlisted number. |
| `callibrate verify <task>` | The same, from the command line. |
| A verification | Writes a run, claims, any applied diff, and ledger rows in one SQLite transaction. |
| A stop request on a call | Sets `do_not_call` on the organization permanently. No automatic path clears it. |

**Cancellation.** There is no recurring job and no scheduler. Every call is one
task, claimed once. A task that is not claimed is never called. Stopping the
process stops all calling; a run that was already started keeps its `run_id` in
`call_runs`, and the correct recovery is to read that run with
`calle call status`, never to place another.

**Credentials.** The CALL-E token is read from the `calle` CLI cache or
`CBR_CALLE_ACCESS_TOKEN`. It is never logged, never passed to a model, and every
error this code raises is run through `redact()` first.

## Safety gates, in the order they are checked

1. **Destination allowlist**, empty by default.
2. **Permanent suppression** after one "stop calling", covering every service
   that organization runs.
3. **Recorded consent**, with a validity window, a day set, and a local-time
   window in the organization's own timezone.
4. **A call cap**, decremented in the same transaction that reserves the call.
5. **Spacing**, so a busy queue cannot phone one small charity twice in a day.

On the call: disclosure in the first sentence, no invented values, a full
readback before any change is accepted, and four immediate endings (a stop
request, a service user answering, distress or a wrong number, or a closure).
Transcripts are redacted before storage and no audio is kept.

See [ETHICS.md](ETHICS.md).

## Verifying it

```bash
pytest -q                        # 117 tests
python evals/run_evaluation.py   # 19 labelled conversations
ruff check .
python tools/ui_smoke.py         # drives the real console in Chromium
```

`tests/test_calle_adapter.py` runs the real MCP client and the real adapter
against a stand-in CALL-E: a genuine JSON-RPC handshake, `plan_call` before
`run_call` every time, a run still `PREPARING` when `run_call` returns, a result
that arrives only as a text block, and a `run_call` with no `run_id`.

The invariant the suite defends: **no failed, ambiguous or unsupported call may
leave the record less trustworthy than it was before the call.**

## Notes

The console plays each transcript line as audio during the guided walkthrough.
Those clips are generated and are not committed here; run
`python tools/build_call_audio.py` (needs `edge-tts` and `ffmpeg`) to create
them, or skip it and the walkthrough runs silently.

Documentation: [ARCHITECTURE.md](ARCHITECTURE.md), [ETHICS.md](ETHICS.md),
[EVALUATION.md](EVALUATION.md), [OPERATIONS.md](OPERATIONS.md).

MIT.
