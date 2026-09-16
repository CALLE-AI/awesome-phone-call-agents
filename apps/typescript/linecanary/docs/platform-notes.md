# CALL-E platform validation notes

Measured against production, 2026-08-02 evening (PDT), one live call via the
MCP/CLI path (run `j9sU6M5fJeU9701GTL_YRQ`, call `1b7e5472…`). Numbers are a
single sample, not a benchmark.

## Timeline (end to end 2m00s)

| Phase | Duration |
| --- | --- |
| `run_call` → bot provisioned + task created | ~23 s |
| task `pending` → `calling` (dial start) | ~11 s |
| dial → callee answered | ~43 s (includes human pickup time) |
| conversation (2 questions + disclosure) | 34 s |
| hangup → final result with outcome/evidence | ~8 s |

## Quality observations

- **Task compliance**: the scripted disclosure line was spoken verbatim as
  the first utterance; both questions asked; no keypresses; polite hangup.
- **Extraction**: `task_completed: true`, confidence 0.96/high, evidence
  array contained both facts correctly ("Saturday hours 9 AM to noon",
  "billing → menu option 3").
- **ASR fidelity**: caught the callee's improvised business name ("Sample
  Dental") and verbatim phrasing ("you should *type* option 3") accurately.
- **Turn-taking latency**: bot follow-up ~1–1.5 s after the callee finished.
- **Goal enrichment**: `plan_call` augments the goal with no-answer and
  voicemail fallback behavior automatically — plan `display_goal` is the
  authoritative text of what the agent will do, not the raw input.

## Contract differences that matter to LineCanary

- **MCP path transcript is a flat string** with `[mm:ss]` prefixes; the
  Developer API (`/v1/calls`, what the app uses via SDK) returns structured
  `transcript_turns` with `offset_seconds`. Do not mix the two shapes.
- **Real-time transcript streaming exists** on the MCP path: `activity`
  events (`callee_realtime`) deliver incremental ASR roughly per second,
  including partial utterances. This can power a live dashboard later —
  polling `get_call_run` mid-call returns the running transcript.
- **MCP `status` values**: `PREPARING` → `COMPLETED` (our runner's REST
  statuses `queued/in_progress/completed` come from the other contract).
- The `calling.calls[]` block carries `call_start_time`, `call_end_time`,
  `duration_seconds`, `reason_code` — useful timing ground truth alongside
  transcript offsets.

## Open questions (next validation steps)

- REST `/v1/calls` with `result_schema` end-to-end (needs `CALLE_API_KEY`):
  schema-validated extraction quality, `structured_result: null` behavior on
  unextractable answers, actual `transcript_turns` offsets.
- Answer-time semantics for cell phones: first user turn offset was 9 s in a
  34 s call; ringing time before connect is NOT in transcript offsets — it
  shows up as dial→connect in `calling.calls[]`. Checks against always-on
  IVRs should see much smaller offsets.
- Free-tier quota actually granted (docs conflict: 20 vs 200 calls).
