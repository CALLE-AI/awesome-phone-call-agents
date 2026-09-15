# Live CALL-E Integration Pitfalls

Discovered during live +27 and +1 testing of phone-scout and call-e-booking.
These are baked into the scripts — this doc explains *why*.

## 1. Task validation requires specific context

CALL-E's task validator rejects generic tasks. Must include concrete *what*,
*when*, and *where*. Generic "research availability" fails; specific queries
with service, date, budget, and location pass.

The phone-scout `call-one` subcommand accepts `--context` for this purpose.
**Always pass it for live mode.** Without it CALL-E returns validation errors.

## 2. Disclosure pattern evolution (live-tested, 4 iterations)

CALL-E's validator requires upfront transparency about the research nature
of the call, while recipients need the specific question first to stay
engaged:

| Attempt | Approach | Result |
|---|---|---|
| #1 | Disclosure-first, no question | Recipient hung up immediately |
| #2 | Question-first, no disclosure | CALL-E rejected — wants transparency |
| #3 | Disclosure burying the question | Recipient disengaged |
| #4 (current) | "Hi, I'm calling to ask about [service] on [day] — this is just for research, I'm not making a booking today. Could you help me?" | Both CALL-E and recipients accept |

**Rule**: Be transparent per CALL-E's requirement, but lead with the *specific
question* (not the disclaimer) so the person stays engaged. The script encodes
this pattern.

## 3. Persona preference

"assistant" or "personal assistant" — **never** "AI assistant" or "bot."
Businesses respond better to human-sounding callers.

## 4. SDK data paths (CORRECT paths — these are non-obvious)

| What | Wrong path (doesn't exist) | Correct path |
|---|---|---|
| Evidence | `call['attempts'][].summary` | `call['evidence']` (top-level list of strings) |
| Attempts | `call['attempts'][]` | `call['recipients'][0]['attempts'][]` |
| Transcript | `call['attempts'][].transcript` | `call['recipients'][0]['attempts'][].transcript` |
| Structured result | — | `call['structured_result']` |
| Confidence | — | `call['completion_confidence']['score']` |

Verified through live testing: early calls returned null evidence/transcript
because code read from `call['attempts']` (does not exist). Fixed by reading
from correct paths.

## 5. Schema strictness

If only `contacted` is `required` in the result_schema, CALL-E short-circuits
after the first answer — returns `{contacted: true, availability: true}` and
stops. All research fields must be in `required`:

```python
# WRONG
{"type": "object", "required": ["contacted"], "properties": {...}}

# CORRECT
{"type": "object", "required": ["contacted", "availability", "price_min",
 "price_max", "booking_requirements"], "properties": {...}}
```

## 6. +1 (US) support — reliable, but shared-line concurrency blocks parallel calls

US numbers connect reliably, but parallelism fails because of a **shared-line
concurrency limit**, not a code bug. The free shared line allows only ONE
active outbound call at a time (shared across API, MCP, and Dashboard).
N parallel calls → N-1 fail instantly.

**Fix:** Complete identity verification (KYC) and purchase a dedicated phone number
at the CALL-E dashboard → unlocks up to 10 concurrent calls. Until then,
serialize calls (one `call-one` at a time).

**Google Places data freshness:** Some listings are stale. Expect ~25% stale
numbers in any batch discovery. The agent should note this and not retry
stale numbers more than once.

## 7. +27 (South Africa) support — PREFIX-DEPENDENT (not intermittent)

CALL-E added +27 support but it's **carrier-by-carrier per prefix**, not a
region-wide on/off switch. Successful connections confirmed for select
prefixes; others return "not currently supported." The rollout is ongoing.

**Rule:** Before a multi-call SA research run, **test one number first** with
a single `call-one`. If it connects, proceed. If it returns a region-block
error, the prefix/number isn't live yet — don't burn the batch. Stop and
report to the user rather than retrying with fresh keys or next-call logic.

## 8. Discovery data quality

| Source | Phone coverage | Rate limit | Key needed? | International? |
|---|---|---|---|---|
| OpenStreetMap Overpass | ~30% (author-reported) | ~1 query / 15s | No | Partial |
| Google Places | ~90% (author-reported) | 600 QPM | Yes | Yes |
| DuckDuckGo Lite | Scraped | Blocked by CAPTCHA | No | — |

The `web_search.py` script auto-selects Google Places if
`GOOGLE_PLACES_API_KEY` is set, falling back to OSM Overpass. Backend is
pluggable — add new backends by registering a function in `_BACKENDS`.

**Location resolution is zero-hardcoded-data:**
- **Google Places** uses the **Text Search** endpoint, which resolves location natively.
- **OSM Overpass** fallback geocodes via the free **Nominatim** API.
- The orchestrator extracts a location from the objective via preposition match
  ("in Cape Town") or by stripping business-type keywords from the remainder.
- No location in the objective → falls back to the configured default city.

## 9. Architecture — live-only, stateless

- **No mock mode.** All calls are live. Preview with `--plan-only`.
- **No disk persistence.** `search` prints JSON to stdout only. Session dies
  → data gone; the agent's chat response is the record.
- **Four subcommands:** `search`, `call-one`, `verify --results-file`,
  `rank --results-file`.
- **Confirm gate.** Both `search` and `call-one` require `--confirm` to dial.
  Without it, they show a dry-run preview and exit.
- **E.164 required.** All phone numbers must be in E.164 format (validated).
- **Output masking.** Phone numbers in results are partially masked.
- **Two env keys:** `CALLE_API_KEY` (required) and `GOOGLE_PLACES_API_KEY`
  (optional). Everything else has sensible defaults.

## 10. +1 US research calls: connect patterns

Live testing of ~10 US businesses across multiple verticals showed:

| Metric | Observed |
|---|---|
| Call placed (connected) | ~100% |
| Live human answered | ~60-80% |
| Returned useful structured data | ~20-30% |

The research framing causes some recipients to disengage quickly. For
medical/dental calls, a direct booking approach (using `call-e-booking`'s
`book --confirm` mode) may work better — staff engage more readily with
genuine booking inquiries. Consider using `phone-scout` for discovery
(`--plan-only`) and switching to `call-e-booking` for the actual call.

## 11. Sequential calling pattern (shared line, 1 concurrent)

When the account has a 1-call concurrency limit:

**Do:** Serialize via background + wait, one at a time.
**Don't:** Batch inside execute_code — 5 calls × 2 min > 300s timeout.

## 12. phone-scout `--plan-only` returns empty constraints

The planner parses the objective for required_fields but does NOT auto-extract
structured constraints. Agents must build the `constraints` dict manually and
pass it to `verify` and `rank` explicitly.

## 13. No automatic retry or next-call guidance

After an ambiguous or failed submission, the agent MUST stop and report the
result to the user. Do NOT automatically retry, switch credentials, or
move to the next candidate without explicit user instruction. The `--confirm`
gate prevents automatic dialing; retry behavior is a user decision.