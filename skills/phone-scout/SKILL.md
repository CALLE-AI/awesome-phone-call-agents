---
name: phone-scout
description: "Research real-world businesses by phone. Use when the user needs to compare places by real-time availability, pricing, or features that only a phone call can verify."
version: 2.1.0
author: Hermes Agent
license: MIT
platforms: [macos, linux]
tags: [research, phone, call, multi-agent, calle-ai]
related_skills: [call-e-booking]
---

# PhoneScout — Multi-Agent Phone Research

Research the real world by phone. Give PhoneScout a research objective like
"find a restaurant for 8 tonight with vegetarian options under R500" and it
discovers businesses, calls them through CALL-E, extracts structured results,
verifies against your constraints, and returns an evidence-backed ranked
recommendation.

PhoneScout thinks in terms of **research objectives**, not phone calls.
Phone calls are the execution mechanism underneath the research workflow.
When the user asks "find me…", "compare…", "research…" — NOT "call…" —
this is the skill.

## When to use

- "Find me a restaurant in [city] for [N] people with [requirements]"
- "Compare dentists near me that can see me this week for under R[amount]"
- "Research hotels that have [feature] and check availability"
- "Which [business type] in [area] can do [thing] before [deadline]?"

## When NOT to use

- Making a booking/reservation → use `call-e-booking` skill
- Just looking up a phone number → web search / maps
- One simple question about one business → direct CALL-E call via `call-e-booking`
- General web research with no phone verification needed → web search

## Interactive gathering (ask before calling)

The user rarely gives every detail upfront. **Never guess or assume missing
information.** Ask follow-up questions until you have enough to build a
well-scoped research plan. Use `clarify()` for any missing fields below.

### First-run setup (once per user, saves to memory)

On every task, check memory for these three keys. If any are missing, ask
the user ONE question at a time (don't dump a form). Save answers to memory
immediately — they persist across sessions:

| Memory key | Question if missing | Why |
|---|---|---|
| `currency` | "What currency do you usually use? R, $, €, £?" | Budget prompts say $500 instead of R500 |
| `home_city` | "Which city are you in? (or where do you search most?)" | Becomes the default when you don't mention a city |
| `timezone` | "What timezone are you in? e.g. Africa/Johannesburg, America/New_York" | Log timestamps match your local time |

Once saved, the agent loads them from memory and they behave as if
`PHONE_SCOUT_CURRENCY` / `PHONE_SCOUT_DEFAULT_LOCATION` / `PHONE_SCOUT_TZ`
env vars were set. The env vars take precedence if both exist.

### Mandatory fields before discovery

These MUST be known before calling `web_search.py` or `discover_candidates()`.
If any are missing, ask the user with `clarify()` before proceeding.

| Field | Question | Why it matters |
|---|---|---|
| **Location** | "Which city or area?" | Required — without it, search defaults and may return irrelevant results |
| **Business type** | "What kind of business? Restaurant, dentist, salon…?" | Determines which tags/place-types to search for |
| **Max calls** | "How many places should I contact?" | Caps call budget (default 3, override with `--max-calls`) |

### ⏰ Timezone check (before ANY call)

Before placing a call, check the current local time at the destination.
If it's outside business hours (roughly 8 AM – 8 PM local), warn the user:

*"It's currently [time] in [city] — businesses are likely closed. Should I wait until [next reasonable window] or proceed anyway?"*

Use the `maps` skill for quick timezone lookups:

```bash
python3 ~/.hermes/skills/productivity/maps/scripts/maps_client.py timezone <lat> <lon>
```

Do NOT silently dial a closed business — anonymous rings waste CALL-E credits.

### What happens when location is missing

`web_search.py` checks whether a location was found. If not, it prints a
warning: *"Warning: could not geocode the location…"*. Google Places Text
Search handles location natively (no geocoding needed); the OSM fallback
uses the free Nominatim API.

The agent MUST:
- Check if `meta.location_geocoded` is `false`
- Warn the user: *"I wasn't sure which city you meant — please include a city name."*
- Offer `clarify()` to narrow the location

### Mandatory fields for a restaurant search

| Field | Question if missing | Default / fill from |
|---|---|---|
| **Location** (city, area) | "Which area or city?" | Memory: user's location |
| **Party size** | "How many people?" | None — must ask |
| **Date / when** | "Tonight? A specific date? This week?" | "Tonight" is a reasonable default to suggest |
| **Time preference** | "After what time? Or any specific time?" | "After now" for tonight; "anytime" otherwise |
| **Budget ceiling** | "What's your max budget per person?" | None — must ask (budget is a hard constraint) |
| **Dietary needs** | "Any dietary requirements? Vegetarian, vegan, halal?" | None — but "no dietary restrictions" is an answer |
| **Max calls budget** | "How many places should I call? (default 3)" | Default 3, overridable |

### Mandatory fields for a medical / dentist search

| Field | Question if missing | Default / fill from |
|---|---|---|
| **Location** (city, area) | "Which area?" | Memory: user's location |
| **Type** (GP, dentist, specialist) | "What kind of doctor or clinic?" | None — must ask |
| **When** (date range) | "When do you need the appointment?" | "This week" is a reasonable default |
| **Budget ceiling** | "Max budget per appointment?" | None — must ask if constrained |
| **Medical aid / insurance** | "Do you need a specific medical aid accepted?" | "No preference" if not mentioned |

### Escalation rules

1. If the user's request is **missing 3+ fields**, ask one question at a time
   — don't dump a checklist.
2. If the user's request has **all mandatory fields**, proceed to the plan
   immediately — don't nag for optional details.
3. If the user pushes back ("just find me something"), **default to broad
   constraints**: tonight, any time, no dietary filter, wider location, no
   budget cap — and tell them what you defaulted so they can tighten it next
   time.
4. If the user provides **identity details on the fly** (name, callback
   number), save them to memory for future sessions.

## Error handling & recovery

Errors happen — nobody answers, networks drop, API keys expire. The skill
must never crash silently or present a blank result. Every error has a
predefined recovery path.

### Error taxonomy

The `call-one` subcommand and `search` pipeline return errors in a standard
shape: `{"error": "<code>", "recoverable": <bool>, "user_action": "<what to tell>"}`.

| Error code | Meaning | Recoverable? | Agent action |
|---|---|---|---|
| `no_candidates_found` | Discovery returned zero matching businesses | ✅ Yes | "No businesses matched [location/constraints]. Should I widen the search area or relax constraints?" Offer `clarify()` with "Widen location", "Drop budget cap", "Drop dietary filter" |
| `no_answer` | Business rang but nobody picked up | ✅ Yes | "Nobody answered at [name]. Retry in 10 min or skip?" Offer retry / skip |
| `concurrency_limit` | Shared line already has an active call | ✅ Yes | Wait 30-60s for the active call to finish, then retry. If persistent, check for a stale call from a killed/timed-out process. Do NOT fire more calls — they'll all hit the same limit. |
| `voicemail` | Call went to voicemail | �️ Maybe | "Reached voicemail at [name]. I can retry once more, or we can skip. A live person is needed for research." Offer retry once, then skip |
| `call_blocked` | Carrier/region rejected the call | ❌ No | "[Name]'s number was blocked by the carrier. This is usually a regional restriction. I'll mark it as unreachable and continue with other candidates." |
| `timeout` | Call created but never left `queued` or `in_progress` | �️ Maybe | "The call to [name] timed out before anyone answered. This can happen with busy lines. I'll hold the partial result. Retry or skip?" Offer retry / skip |
| `no_api_key` | `CALLE_API_KEY` missing from `.env` | ❌ No | "Cannot place live calls — CALLE_API_KEY is missing. Add it to ~/hermes/.env." |
| `calle_ai_not_installed` | `calle-ai` package not in venv | ❌ No | "The calle-ai SDK is not installed. Run: pip install calle-ai into the skill's .venv." |
| `all_calls_failed` | Every candidate returned an error — zero contacts | ✅ Yes | "None of the [N] businesses answered. This is unusual. Possible causes: wrong numbers, region block, or network outage. Options: retry all, try different candidates, or check the phone numbers." |
| `all_constraints_failed` | We contacted businesses but none passed the constraints | ✅ Yes | "[N] businesses answered but none met your constraints. #1 [name] was closest — [price/vegetarian/etc] was just outside. Should I show the near-misses anyway, or relax constraints?" |
| `subagent_died` | A delegated `call-one` sub-agent crashed or was killed | �️ Maybe | "One of the research calls crashed. [N-1]/[N] completed. I can show results from those that succeeded, or retry the failed one." |

### Recovery rules (agent must follow these)

1. **Partial results are results.** If 3 of 5 calls succeeded, present the 3.
   Don't discard everything because of 2 failures.

2. **Retry once, then move on.** If a business didn't answer, offer to retry
   *once* (after a 10-minute cooldown). If it fails again, mark it unreachable
   and proceed with remaining candidates.

3. **Don't burn the call budget.** Each retry costs a CALLE credit. If the
   user's `max_calls` is 3 and 2 failed, don't retry both — pick the most
   promising 1 and retry that one.

4. **Escalate at 50%+ failure rate.** If more than half the calls fail
   (everyone's closed, wrong region, network down), stop and tell the user:
   "Something is wrong — [X]/[Y] calls failed. This many failures suggests a
   systemic issue (wrong region, bad numbers, API problem). What should I do?"

5. **Always show what worked.** Even if the recommendation is "no perfect
   match," show the best near-miss with its actual score. A user might relax
   a constraint when they see "R550/person, everything else perfect."

### Exit codes

`call-one` exits:

| Exit | Meaning |
|---|---|
| 0 | Call completed (contacted or not — both are valid results) |
| 1 | Fatal error (no API key, SDK missing, network unreachable) |

The parent agent interprets exit codes. Exit 0 with `"error": "no_answer"`
means "nothing went wrong, they just didn't pick up" — proceed with next
candidate. Exit 1 means "stop everything, something is broken."

### Delegation error survival

When using `delegate_task(tasks=[...])` for parallel research:

- If a sub-agent's `call-one` returns exit 0 (with any error code), the
  sub-agent result is valid — include it in the parent's ranking.
- If a sub-agent crashes (exit 1, or Hermes kills it), that candidate is
  `unreachable`. The parent counts it as `contacted: false`.
- **The parent never cancels the entire batch because one child failed.**
  Collect N-1 results, rank them, and present the best.

## Quick-start (the agent runs this for you)

```bash
PY="python3"
SCOUT="$HERMES_HOME/skills/phone-scout/scripts/phone_scout.py"
V_ENV_PY="$HERMES_HOME/skills/productivity/call-e-booking/.venv/bin/python3"

# Full pipeline (discover → call → verify → rank)
$V_ENV_PY $SCOUT search \
  --objective "Find me a restaurant in Johannesburg for 8 people tonight after 7pm. It needs vegetarian options and should cost less than R500 per person." \
  --max-calls 3

# Plan only (discovery only, no calls)
$PY $SCOUT search \
  --objective "dentist Manhattan New York teeth cleaning 7-13 September budget 500" \
  --plan-only

# Inspect a completed research session
$PY $SCOUT show --research-id <id>
$PY $SCOUT show --research-id <id> --events
```

## Architecture

```
User Request (natural language)
        ↓
Research Planner   → required fields, constraints, max_calls
        ↓
Candidate Discovery → Google Places or OSM Overpass
        ↓
Candidate Selector → rank by likelihood, cap at --max-calls (default: top 3)
        ↓
Phone Research Agents (serial, one at a time)
        │  → CALLE in live mode
        ↓
Structured Extraction → JSON per business
        ↓
Verification Agent → checks each result against constraints
        ↓                detects conflicts, computes confidence
Ranking Agent → scored & ranked recommendation
        ↓
Evidence-backed result
```

Full JSON includes per-business `structured_result`, `verification`
(check-by-check), `ranking` (score + reasons), `recommendation` (#1 match),
and `events` (full timeline).

## Generic by design (works for any vertical)

PhoneScout is **not** restaurant-specific. It treats a research task as a
generic *constraints → phone research → verify → rank* pipeline:

- **Any constraint** becomes a check. `verify_result()` dispatches each key in
  `constraints` to a checker. Built-in checkers cover `party_size`,
  `vegetarian`, `vegan`, `halal`, `max_price_per_person`, `time_after`,
  `min_rating` — and any *unknown* key falls back to a direct field match.
- **Required fields derive from constraints.** `plan_research()` maps each
  constraint to the result field it needs (via `CONSTRAINT_FIELD_MAP`), so the
  live CALLE task and result schema are generated per-research, not hardcoded.
- **Result schema is auto-generated** from the required fields.

Example: a dentist search

```bash
python3 phone_scout.py search \
  --objective "Find a dentist in Manhattan New York who can see me this week for under $500 and accepts my insurance" \
  --max-calls 4
```

The planner would derive fields for `max_price_per_person` (→ price),
`accepts_medical_aid`, and `time_after`; the verifier would check each; the
ranker would score against whatever constraints were supplied.

## Important principles

1. **Research-first design.** The skill asks "what do I need to know?" not
   "who do I call?" Phone calls are an execution detail.
2. **Call the top 3 only.** Discovery may return more candidates via Google Places,
   but only call the top 3 ranked by relevance (default `--max-calls 3`).
3. **Evidence over summary.** Every result carries `evidence` snippets from
   the actual call, and `verification` shows the exact constraint checks.
4. **Information gathering only.** Calls are read-only research. Do not book,
   reserve, or commit during a research call.
5. **Confidence over speed.** A low-confidence result is surfaced as such
   rather than hidden.

## Prerequisites

- Python 3.9+ (stdlib only for `phone_scout.py` and `web_search.py`)
- `pip install calle-ai` (into a venv for live calls)
- `CALLE_API_KEY` in `~/.hermes/.env`
- CALLE account with available credits
- `GOOGLE_PLACES_API_KEY` in `~/.hermes/.env` (optional — adds phone numbers to discovery; without it, OSM Overpass is used)

## Call execution (serial by default)

> **Default: shared line = 1 concurrent call.** CALL-E's shared line allows only ONE
> active call at a time (author-observed on free-tier accounts; dedicated numbers
> calls makes N-1 fail with *"account concurrency limit of 1"*. **Serialize all calls
> by default** — one `call-one` at a time.

### Serial execution (the default)

Run `call-one` sequentially for each candidate using `terminal(background=true)` +
`process(action='wait')`. This gives each call its own timeout, survives long hold times,
and doesn't leave stale calls occupying the line if something goes wrong:

```bash
V_ENV_PY="$HOME/.hermes/skills/productivity/call-e-booking/.venv/bin/python3"
SCOUT="$HOME/.hermes/skills/phone-scout/scripts/phone_scout.py"

for candidate in "${candidates[@]}"; do
  $V_ENV_PY $SCOUT call-one \
    --candidate-id "$id" --name "$name" --phone "$phone" \
    --research-questions "availability price booking_requirements" \
    --context "..." --pretty
  sleep 5  # small gap to ensure line is free
done
```

**Agent pattern:** use `terminal(background=true, notify_on_complete=true)` + `process(action='wait')`
for each call. Do NOT use `execute_code` for sequential calls — if a call hangs and the
script hits the 5-minute timeout, the CALLE call stays alive and blocks the shared line.

### Concurrency pitfall: execute_code timeouts

`execute_code` has a 300s timeout. If a `call-one` invocation inside it creates a CALLE call
that hangs (ringing, voicemail, hold queue), the script is killed but the CALLE call keeps
running — occupying the shared line. Every subsequent attempt hits the concurrency limit
until CALL-E's own timeout releases it (~2 minutes). **Never batch sequential `call-one`
calls inside `execute_code`.** Use individual `terminal(background=true)` calls instead.

### Future: parallel delegation (after KYC)

Once KYC is complete and a dedicated number is purchased at
https://dashboard.heycall-e.com/account/numbers/buy (unlocks up to 10 concurrent calls),
switch to parallel delegation:

```python
delegate_task(tasks=[
  {
    "goal": f"Research {candidates[i].name} at {candidates[i].phone}",
    "context": (
      f"$V_ENV_PY $SCOUT call-one --candidate-id \"{candidates[i].id}\" "
      f"--phone \"{candidates[i].phone}\" --name \"{candidates[i].name}\" "
      f"--research-questions ... --context \"...\" --pretty\n"
      "Return JSON as-is. Research only — no booking."
    ),
  }
  for i in range(len(candidates))
])
```

Bounded by `min(len(candidates), account_concurrency)` at a time.

## Full pipeline pattern the agent follows:

```
PHASE 1 — PLAN (parent, no delegation)
  $PY $SCOUT search --objective "..." --max-calls N --plan-only
  → returns the research plan + candidate list (no calls placed)
  Read candidates[].name, candidates[].phone, research_plan.required_fields

PHASE 2 — SERIAL PHONE CALLS (parent, one at a time)
  For each candidate, run `$V_ENV_PY $SCOUT call-one ...` sequentially:
    terminal(background=true, notify_on_complete=true)
    process(action='wait', timeout=180)
  Collect each result, then proceed to verification.
  Do NOT batch in execute_code — use individual background terminal calls.

PHASE 3 — VERIFY + RANK (parent, after all subagents finish)
  Save the collected results to a JSON file, then re-run verification + ranking
  over them and present the recommendation:

    $PY $SCOUT verify --results-file /tmp/results.json --constraints '{"party_size":8,"vegetarian":true,"max_price_per_person":500}'
    $PY $SCOUT rank   --results-file /tmp/results.json --constraints '{"party_size":8,"vegetarian":true,"max_price_per_person":500}'

  (Or, if the parent ran the one-shot `search` pipeline, just inspect the
   saved session: `$PY $SCOUT verify --research-id <id>` / `rank --research-id <id>`.)
```

Phase 2 serial execution (the agent builds this from the candidate list):

```
For each candidate in order:
  1. Start background call:
     terminal(background=true, notify_on_complete=true,
       command="$V_ENV_PY $SCOUT call-one
         --candidate-id \"<id>\" --phone \"<phone>\" --name \"<name>\"
         --research-questions availability price booking_requirements
         --context \"...\" --pretty")
  2. Wait for completion:
     process(action='wait', session_id=<id>, timeout=180)
  3. Parse JSON result, add to collected results
  4. Sleep 5s to ensure line is free, then next candidate
```

Rules:

- **One call at a time.** Never fire multiple `call-one` invocations concurrently
  on the shared line — each subsequent call fails with the concurrency limit error.
- **Discovery + selection happen BEFORE calling.** Run `--plan-only` first, then
  call only the selected candidates.
- **Each call is self-contained.** Pass the exact research questions and context
  so each call asks targeted questions.
- **Collect all results, then verify + rank.** Don't discard partial results.

## Related skills

- `call-e-booking` — book the restaurant/clinic that PhoneScout recommends
- `google-workspace` — write the recommendation to a Sheet or Doc

## Configuration (env vars)

PhoneScout is fully configurable via environment variables — no code changes
needed to run in a different city, country, or currency:

| Variable | Default | Purpose |
|---|---|---|
| `CALLE_API_KEY` | — | Required for all live calls |
| `GOOGLE_PLACES_API_KEY` | — | Optional — enables Google Places for discovery (author-reported ~90% phone coverage). Falls back to OSM Overpass (free). |
| `PHONE_SCOUT_CURRENCY` | `R` | Currency symbol prefix for budget prompts (e.g. `$`, `€`, `£`) |
| `PHONE_SCOUT_TZ` | `Africa/Johannesburg` | IANA timezone for log timestamps (e.g. `America/New_York`) |
| `PHONE_SCOUT_DEFAULT_LOCATION` | `Johannesburg` | Fallback city when none detected in objective |
| `PHONE_SCOUT_MAX_CALLS` | `3` | Default max businesses to contact |

Minimal config for a new user in NYC:

```bash
export PHONE_SCOUT_CURRENCY="$"
export PHONE_SCOUT_TZ="America/New_York"
export PHONE_SCOUT_DEFAULT_LOCATION="New York City"
export CALLE_API_KEY="..."
# Optional — adds phone numbers to discovery:
export GOOGLE_PLACES_API_KEY="..."
```

## Scripts

- `scripts/phone_scout.py` — main research orchestrator
  - `search` — full pipeline (discover → call → verify → rank)
  - `show` — inspect a completed research session
  - `call-one` — research ONE business (used by sub-agents)
  - `list` — browse past research sessions
  - `verify` — re-run constraint verification on a session or results file
  - `rank` — re-rank a session or results file
- `scripts/web_search.py` — keyless business discovery (Google Places if API key set, else OSM Overpass). Auto-detects `GOOGLE_PLACES_API_KEY` from `.env`.