# Run and inspect CallOps

All bundled fixtures describe a fictional bicycle repair inquiry. They contain no
real phone destination, person, recording, or provider transcript. No credentials
are required. Commands below run from the repository root with Python 3.10+.

## 1. Prepare the bounded inquiry

```bash
python3 skills/znak-callops/scripts/callops.py prepare-goal --request skills/znak-callops/assets/synthetic_request.json
```

Input keys: `task_id`, `service`, `requested_window`, all nonempty strings.
Expected: `dispatch_status: NOT_SUBMITTED`, an information-only goal, and requested
fields `availability`, `quoted_price`, `follow_up`. The packet does not contain a
destination or call authorization. The host supplies those separately.

## 2. Execute the synthetic evidence review

```bash
python3 skills/znak-callops/scripts/callops.py demo
```

Expected: source `SYNTHETIC_FIXTURE`; availability `QUOTED`; price `DISPUTED` with
both complete source statements preserved; follow-up `UNKNOWN`. Nothing is booked.
Inspect the fixture alongside the output to verify every evidence pointer.

## 3. Check an input packet

```bash
python3 skills/znak-callops/scripts/callops.py validate-result skills/znak-callops/assets/synthetic_inquiry.json
```

The local packet format is:

```json
{
  "task_id": "synthetic-example",
  "source_mode": "synthetic",
  "call_status": "COMPLETED",
  "transcript": [{"id":"turn-1","speaker":"provider","text":"I cannot confirm availability."}],
  "candidates": [{"field":"availability","quote":"I cannot confirm availability.","evidence":{"turn_id":"turn-1","start":0,"end":30}}]
}
```

`end` is the Python character length of the complete turn; both offsets must be
integers. Allowed speakers are `provider`, `agent`, and `unknown`. Only exact
complete provider turns can support quotes. Candidate keys must be exactly
`field`, `quote`, and `evidence`; generated `value` fields are rejected. Do not
pre-trim the transcript to make a clipped quote look complete.

`QUOTED` here preserves a refusal to confirm. It does not mean "available". The
checker deliberately does not interpret the statement's meaning. It also treats
distinct statements as unresolved even when a human could recognize a correction.

Exit status: `0` for a well-formed review without rejected candidates (including
UNKNOWN or DISPUTED fields), `1` for rejected candidate evidence, `2` for malformed
input. Always read field statuses; exit code zero is not business success.

## 4. Verify failure cases

```bash
python3 -m unittest discover -s skills/znak-callops/scripts -p 'test_*.py'
python3 scripts/validate_repository.py
```

Focused tests cover fabricated text, clipped negation, missing source turns,
agent statements, duplicate turn IDs, extra generated values, missing answers
despite a completed call, and synthetic/live provenance labels. These are local
checks only. They do not verify provider behavior or the quality of AI extraction.

## Optional live verification

Install the skill in an authenticated MCP host and follow
[call-e.md](call-e.md). Supply your own authorized test recipient; no test number is
bundled. Ask that recipient in advance to provide a price correction and leave one
answer unresolved. Authorize one inquiry and no booking. After the run, compare the
private raw transcript to the normalized packet and checked quotes. Record the
actual result, including missing transcript data or any boundary breach. Never
present the synthetic fixture as the output of that live call.
