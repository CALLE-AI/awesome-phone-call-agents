# Live CALL-E Integration Pitfalls

Discovered during live +27 and +1 testing of phone-scout and call-e-booking (Aug–Sep 2026).
These are baked into the scripts — this doc explains *why*.

## 1. Task validation requires specific context

CALL-E's task validator rejects generic tasks. Must include concrete *what*,
*when*, and *where*. Generic "research availability" fails; "men's haircut
this Friday, budget R400, Sandton City" passes.

The phone-scout `call-one` subcommand accepts `--context` for this purpose.
**Always pass it for live mode.** Without it CALL-E returns:
> "Call task creation was rejected: What specific salon service/request and requested date/time should the bot ask about?"

With `--context "The customer wants a men's haircut this Friday, budget R400..."` the task passes.

## 2. Disclosure pattern evolution (live-tested, 4 iterations)

CALL-E's validator changed preferences during our testing:

| Attempt | Approach | Result |
|---|---|---|
| #1 (early) | "I am not making a booking today — just gathering info…" | **CALL-E rejected** — validator wanted transparency about the research nature |
| #2 | "Hi, just a few quick questions…" (no disclosure) | **CALL-E rejected** — validator demanded upfront transparency |
| #3 | "I am not making a booking today…" upfront | **Hung up instantly** — person heard "you don't need to stay on the line" and left |
| #4 (current winner) | "Hi, I'm calling to ask about [service] on [day] — this is just for research, I'm not making a booking today. Could you help me with a few quick questions?" | ✅ **CALL-E accepted + person engaged** |

**Proof** (Sorbet Man Sandton City, +27 11 784 8650): Attempt #4 produced a 15-turn conversation, full structured result: price R510, Friday from 9:00 AM, booking requires name + phone number, 90% confidence.

**Rule**: Be transparent per CALL-E's requirement, but lead with the *specific question* (not the disclaimer) so the person stays engaged. The script now encodes this.

## 3. Persona preference

"assistant" or "personal assistant" — **never** "AI assistant" or "bot."
The user specifically requested this. Businesses respond better when the
caller sounds human.

## 4. SDK data paths (CORRECT paths — these are non-obvious)

| What | Wrong path (doesn't exist) | Correct path |
|---|---|---|
| Evidence | `call['attempts'][].summary` | `call['evidence']` (top-level list of strings) |
| Attempts | `call['attempts'][]` | `call['recipients'][0]['attempts'][]` |
| Transcript | `call['attempts'][].transcript` | `call['recipients'][0]['attempts'][].transcript` |
| Structured result | — | `call['structured_result']` |
| Confidence | — | `call['completion_confidence']['score']` |
| Call ID | — | `call['id']` |

Verified: our first 3 live calls returned null evidence/transcript because code
read `call['attempts']` (does not exist). Fixed by reading from correct paths.

## 5. Schema strictness

If only `contacted` is `required` in the result_schema, CALL-E short-circuits
after the first answer — returns `{contacted: true, availability: true}` and
stops. All research fields must be in `required`:

```python
# WRONG
{"type": "object", "required": ["contacted"], "properties": {...}}

# CORRECT
{"type": "object", "required": ["contacted", "availability", "price_min", "price_max", "booking_requirements"], "properties": {...}}
```

## 6. +1 (US) support — reliable, but shared-line concurrency blocks parallel calls

US numbers connect far more reliably than +27, but parallelism fails because of
a **shared-line concurrency limit**, not a code bug:

- ✅ **AL Dental Studio** (+1 212 430 3888) — connected, 60+ turn conversation, confirmed availability Mon-Fri Sep 7-11, 9AM-5PM, 86% confidence
- ❌ **3 parallel Manhattan dentist calls** — all failed identically: *"The call plan could not be prepared."*
- ❌ **3 parallel Cape Town calls** — 2 of 3 failed: *"Your default shared line is at its account concurrency limit of 1."*

**Root cause (confirmed Sep 2026):** CALL-E's free shared line allows only ONE
active outbound call at a time (shared across API, MCP, and Dashboard). Firing
N parallel calls makes N-1 fail instantly. The earlier "call plan could not be
prepared" errors were the same underlying concurrency rejection — the error
message varies depending on timing but the cause is identical.

**Fix:** Complete identity verification (KYC) and purchase a dedicated phone number
at https://dashboard.heycall-e.com/account/numbers/buy → unlocks up to 10
concurrent calls. Until then, serialize calls (one `call-one` at a time).

**Google Places data freshness:** Some listings are stale (Cohen-Brown was a hospital, not
a dentist). Expect ~25% stale numbers in any batch discovery.

## 7. +27 (South Africa) support — PREFIX-DEPENDENT (not intermittent)

CALL-E added +27 support but it's **carrier-by-carrier per prefix**, not a
region-wide on/off switch:

| Prefix | Area | Tested | Result |
|---|---|---|---|
| +27 11 | JHB landline | **Sorbet Man Sandton City (+27 11 784 8650)** | ✅ *Connected — full 15-turn conversation* |
| +27 11 | JHB landline | Taste of India (+27 11 234 1727) | ❌ Blocked minutes after the successful call |
| +27 87 | Sandton mobile | Wimpy Campus Square (+27 87 265 3449) | ❌ Blocked — "not currently supported" |
| +27 78 | Sandton mobile | Turkish Mens Grooming Lounge (+27 78 352 6508) | ❌ Carrier blocked |
| +27 21 | Cape Town landline | The Capital 15 On Orange (+27 21 469 8000) | ❌ Blocked — "not currently supported" |

**Pattern:** Only **+27 11 (Sorbet Man specifically)** has successfully connected
with a full transcript. The same prefix failed for a different +27 11 number
minutes later, so it's NOT purely prefix-based — there may be carrier routing
or per-number whitelisting. CALL-E is clearly in active +27 rollout.

**Rule:** Before a multi-call SA research run, **test one number first** with
a single `call-one`. If it connects, proceed. If it returns *"Calls to South
Africa in English aren't currently supported"*, the prefix/number isn't
live yet — don't burn the batch.

## 8. Discovery data quality

| Source | Phone coverage | Rate limit | Key needed? | International? |
|---|---|---|---|---|
| OpenStreetMap Overpass | ~30% | ~1 query / 15s | No | Partial (NYC timeouts) |
| Google Places | ~90% | 600 QPM | Yes (free tier: $200/mo credit) | Yes |
| DuckDuckGo Lite | Scraped | Blocked by CAPTCHA | No | — |

The `web_search.py` script (in phone-scout's `scripts/`) auto-selects Google Places
if `GOOGLE_PLACES_API_KEY` is set in `~/.hermes/.env`, falling back to OSM Overpass.
Backend is pluggable — add new backends by registering a function in `_BACKENDS`.

**Location resolution is zero-hardcoded-data** (removed the old city-centroids dict
Sep 2026 — it was a maintenance liability for a shareable skill):
- **Google Places** uses the **Text Search** endpoint (`/textsearch/json?query=<full natural-language query>`),
  which resolves location natively — no geocoding step at all. The full query
  ("restaurant Cape Town") goes straight through.
- **OSM Overpass** fallback geocodes via the free **Nominatim** API
  (`nominatim.openstreetmap.org/search?q=<location>`) to get lat/lon before the
  Overpass radius query.
- The orchestrator extracts a location from the objective two ways: a preposition
  match ("restaurant **in Cape Town**") or, failing that, strips business-type
  keywords from the objective and passes the remainder ("dentist **Manhattan New York**").
- No location in the objective → falls back to `PHONE_SCOUT_DEFAULT_LOCATION`.

## 9. Architecture (as of Sep 2026) — live-only, stateless

phone-scout was stripped down during hardening for sharing with other users:

- **No mock mode.** `PHONE_MODE=mock`, `mock_restaurants.py`, and the `PRESETS`
  dict are all removed. `calle_booking.py` remains the only script; phone-scout
  is research-only, live-only.
- **No disk persistence.** `search` prints JSON to stdout and nothing else.
  The `show`/`list` subcommands and `~/.hermes/phone_scout_results/` are gone.
  Session dies → data gone; the agent's chat response IS the record.
- **Four subcommands:** `search`, `call-one`, `verify --results-file`, `rank --results-file`.
- **Two env keys only:** `CALLE_API_KEY` (required) and `GOOGLE_PLACES_API_KEY`
  (optional, adds phone coverage). Everything else has defaults.

## 10. +1 US research calls: high connect rate, low data yield (verified 2026-09-11)

5 Manhattan dental clinics called for teeth cleaning availability research:

| Metric | Result |
|---|---|
| Connected (call placed) | 5/5 (100%) |
| Live human answered | 4/5 (80%) |
| IVR only (no human) | 1/5 (20%) |
| Returned useful data | 1/5 (20%) |

**Why calls dropped**: the research framing ("this is just for research, I'm
not making a booking today") appears to cause staff to hang up. At 3/4 clinics
where a human answered, the call ended within seconds of the bot's opening
disclosure. Only **Morningside Dental Care** (Manny at +1 718 504 1473)
engaged past the intro: confirmed availability Sept 15-16, asked new/existing
patient status, and was mid-conversation when the call dropped.

CALL-E transcripts showed the pattern clearly:
- "209 NYC Dental" — bot delivered opening, no human response captured
- "172 NYC Dental" — staff said "Hello?", bot repeated opening, staff put phone down
- "Manhattan Dental Care" — Lynn identified herself, call ended after <5s
- "Village Dental NYC" — automated IVR recording only

**Implication**: for US medical/dental calls, a direct booking approach (using
`call-e-booking`'s `book --confirm` mode) may work better than research-mode
calls. Staff are more likely to engage with a genuine booking inquiry than
"just research." Consider using `phone-scout` only for discovery (--plan-only)
and switching to `call-e-booking` for the actual call.

## 11. Sequential calling pattern (shared line, 1 concurrent)

When the account has a 1-call concurrency limit, do NOT batch calls inside
`execute_code` — it times out at 300s. Each call takes 1-3 min; 5 calls
exceed the limit. Working pattern:

**Golden pattern** — background + notify_on_complete + wait, one at a time:

```
# Step 1: Start call in background
terminal(background=true, notify_on_complete=true, timeout=300):
  $V_ENV_PY $SCOUT call-one --candidate-id "..." --name "..." --phone "..." ...

# Step 2: Wait for it to finish (blocks until done or timeout)
process(action='wait', session_id='proc_xxx', timeout=180)

# Step 3: Read output
process(action='poll', session_id='proc_xxx')
# or process(action='log', session_id='proc_xxx')

# Step 4: Start next call ONLY after previous one finishes
```

**Concurrency-limit retry loop**: a stale call from a previous timed-out
attempt may still occupy the shared line. The error is `"recoverable": true`
with "concurrency limit of 1". Retry strategy:

```bash
for i in 1 2 3 4 5 6; do
  RESULT=$($V_ENV_PY $SCOUT call-one ...)
  if echo "$RESULT" | grep -q '"contacted": true'; then break; fi
  if echo "$RESULT" | grep -q '"recoverable": true'; then sleep 30; continue; fi
  break  # non-recoverable, stop retrying
done
```

The lock usually clears within 1-2 minutes as the stale call's polling times
out at CALL-E's end.

**Anti-pattern — do NOT use `execute_code` for sequential calls:**
```python
# BAD: 5 calls × 2 min = 10 min > 300s execute_code timeout
execute_code("""
for c in candidates:
    terminal(f"call-one ...", timeout=120)
""")
```

## 12. phone-scout `--plan-only` returns empty constraints

When running `phone_scout.py search --plan-only`, the planner parses the
objective for required_fields but does NOT auto-extract structured constraints:

```json
// Input: --objective "dentist Manhattan teeth cleaning budget 500"
// Output:
{"constraints": {}, "required_fields": [...]}
```

Agents must build the `constraints` dict manually and pass it to `verify` and
`rank` explicitly. The planner identifies what to ask about, not what the
acceptance criteria are. Example:

```bash
$PY $SCOUT verify --results-file /tmp/r.json \
  --constraints '{"max_price_per_person": 500, "time_after": "2026-09-14"}'
$PY $SCOUT rank   --results-file /tmp/r.json \
  --constraints '{"max_price_per_person": 500, "time_after": "2026-09-14"}'
```