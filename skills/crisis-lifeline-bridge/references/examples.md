# Examples

All examples run in **dry-run** by default and place **no real call**. Sample numbers are fictional
reserved samples (`+1 555 01xx`) and are never dialed.

## 1. Find a candidate local agency (dry-run)

```bash
node scripts/find-local-agency.mjs --need housing --country US --region CO --city Denver
```

Returns a sample candidate plus the correct real national fallback (211 for housing):

```json
{
  "ok": true,
  "mode": "dry-run",
  "query": "emergency homeless shelter intake Denver, CO, US",
  "candidates": [
    { "name": "Sample City Shelter Intake", "phone_e164": "+15550101",
      "hours": "Mon-Sun 8:00-20:00", "url": "https://example.org/shelter", "source": "sample-dataset" }
  ],
  "national_fallback": { "name": "211 (United Way)", "phone_e164": "+1211", "hours": "24/7",
      "url": "https://www.211.org", "national": true }
}
```

## 2. Verify an agency by phone (dry-run — no call placed)

```bash
node scripts/verify-agency-call.mjs --need housing \
  --agency "Denver Rescue Mission Intake" --to-phone "+15550101"
```

Produces the exact call goal and a simulated verified result, with the number masked:

```json
{
  "ok": true,
  "mode": "dry-run",
  "would_call": "+15••••01",
  "plan_goal": "Verify that Denver Rescue Mission Intake is a real, currently in-service ...",
  "simulated_result": { "verified": true, "recommend_refer": true, "phone_masked": "+15••••01" }
}
```

## 3. Safety guard: live mode refuses sample numbers

```bash
node scripts/verify-agency-call.mjs --live --need housing --agency "X" --to-phone "+15550101"
```

```json
{ "ok": false, "error": "refusing to place a live call to a fictional sample number (+1 555 01xx)" }
```

## 4. Live verification (places ONE real outbound call to the agency)

Only with the `calle` CLI installed + authenticated (`calle auth status` -> usable) and a **real,
consented, non-sample** E.164 number:

```bash
export CALLE_SOURCE=skills_sh CALLE_INTEGRATION=skills_sh_skill CALLE_INTEGRATION_VERSION=0.1.0
node scripts/verify-agency-call.mjs --live --need housing \
  --agency "Denver Rescue Mission Intake" --to-phone "+1XXXXXXXXXX" \
  --region US --language en --timezone America/New_York
```

Flow: `plan_call` (goal via `user_input`) -> supply `to_phone` -> `run_call` -> `get_call_run`.
The call confirms the line is real/in service, asks intake hours and capacity, and returns a
structured result. Refer the person **only** if the line is confirmed real and able to help;
otherwise research another candidate or fall back to a verified national line.

## 5. Live research for a real local agency (opt-in)

Set a research endpoint that accepts `{ q, n }` and returns `{ ok, results:[...] }`:

```bash
export RESEARCH_URL="https://your-research-endpoint/news"
export RESEARCH_TOKEN="..."   # optional bearer
node scripts/find-local-agency.mjs --need dv --country US --region NY --city Buffalo --live
```

The host agent is responsible for confirming a result is a real service and extracting a phone
number before any verification call.
