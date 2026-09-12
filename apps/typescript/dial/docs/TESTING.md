# Testing

## What runs

| Suite | Count | What is real |
| --- | --- | --- |
| `packages/domain` | 57 | Pure logic. Phone normalisation, policy, ranking, comparison, injection defence. |
| `packages/schemas` | 25 | CALL-E schema subset, reserved fields, result parsing. |
| `packages/ai` | 17 | Gemini output mapping: key/value folding, enum rejection, null handling. |
| `packages/search` | 18 | Geocode precision and domain mapping: a country is too coarse to search; an unmapped domain never falls back to a name regex. |
| `packages/database` | 7 | **Real PostgreSQL** (PGlite). Migrations, dedupe, `SKIP LOCKED`, retry/park, stale reclaim. |
| `apps/api` | 60 | Real DB + real Fastify + real pipeline + real worker loop, incl. error presentation and provider-outage retry. |
| `scripts/e2e.mjs` | 24 | A **running** stack over real HTTP: network, BFF proxy, cookies, SSE. |
| **Total** | **208** | |

```bash
npm run lint          # clean
npm run typecheck     # clean, all 14 workspaces
npm test              # 184 unit + integration
npm run e2e           # 24, needs api + worker + web running
npm run build         # packages + api + worker + web
npm run build:mobile  # Expo bundle, both platforms
```

## What is substituted, and where

Mocks exist **only** inside `apps/api/src/__tests__/harness.ts`. Production
resolves all three of these from configuration and cannot reach that file.

| Substituted | Why | Production path |
| --- | --- | --- |
| Call provider | Tests must not ring a business | `resolveCallProvider()` → `CalleCallProvider` |
| Task interpreter | Tests must not spend model tokens | `resolveInterpreter()` → Gemini |
| Discovery | Determinism; the real one is verified separately | `DiscoveryService` → OSM / Google |

The database is **never** mocked. Neither is the HTTP layer, the job queue, the
state machine or the comparison engine.

---

## Definition of Done matrix

Status is one of **PASS** (actually exercised), **FAIL**, **BLOCKED** (cannot run
— what is missing is named), or **N/A**.

A successful build is not proof a feature works. Code inspection is not proof.
A mock test is not proof a production integration works. Only items actually
exercised are marked PASS.

### Core

| Requirement | Status | Evidence |
| --- | --- | --- |
| Natural-language task submission | PASS | `POST /api/tasks` accepted over real HTTP; e2e |
| Task *interpretation* by a model | PASS | Real Gemini call interpreted *"i want to call for someone to repair my iphone nearby"* into `quote_request`/`repair_quote`, `domain: phone_repair`, `information_only`, no clarification demanded |
| The Paris croissant query completes | PASS | 74 bakeries found, 22 callable, best verified option returned |
| A country-level request completes after one question | PASS | Saudi Arabia -> asks the city -> 40 found, 7 callable, 5 called in Riyadh |
| Search widens on too few *callable* businesses | PASS | Riyadh 14/1 -> 40/7 |
| Never-needed planned calls are not left "In progress" | PASS | marked `not_needed` at completion |
| An unmapped domain still finds businesses | PASS | 34 domains mapped; tag guess then Nominatim text search, never a name regex |
| A directory timeout retries instead of failing | PASS | Overpass mirror + queue backoff |
| A country is refused as too coarse to search | PASS | `finland` -> country/1181 km -> asks for a town instead of reporting no shops exist |
| Zero results widens the radius before giving up | PASS | 4x, capped at 50 km |
| The intended typeface actually loads | PASS | Self-hosted woff2 preloaded; variable chain resolves in the served CSS |
| Every text pair meets WCAG AA in both themes | PASS | Checked from the stylesheet's own token values, not a copy |
| Keyboard focus is visible on inputs | PASS | `outline: none` on :focus was outranking the global rule |
| The live indicator animates | PASS | Its keyframe did not exist |
| Touch targets reach 44px on touch devices | PASS | `@media (pointer: coarse)`, not on desktop |
| "We could not get an answer" is not filed as an answer | PASS | `question_answered: no` -> `answered_no_answer_to_question` |
| "This shop cannot help" is still a real answer | PASS | `can_repair: no` -> `answered_useful` |
| A non-answer never becomes the best verified option | PASS | `result.best` stays null |
| A non-answer does not count towards the comparison | PASS | Dial keeps calling instead of stopping on greetings |
| Each family declares which question its field asks | PASS | Asserted per family, not inferred |
| A stalled task is still given up on | PASS | Nothing happening is what the net measures |
| A task taking its turn is not given up on | PASS | Six businesses were once failed having never been dialled |
| Only one call is ever in flight | PASS | Peak concurrency 1 across a four-call task |
| The next business is rung only after the last finishes | PASS | One wave per business, none left pending |
| Call limits in tests do not come from a developer's .env | PASS | Harness pins them; Vitest loads .env into process.env |
| Dial keeps calling past two comparable answers | PASS | `COMPARABLE_TARGET`, not a hard-coded 2 |
| It stops the moment the goal is met | PASS | Target 3, exactly 3 calls |
| A request naming its own number wins | PASS | "ring five places" -> 5 comparable |
| Still bounded when the goal cannot be met | PASS | Stops at `MAX_CALLS_UNTIL_RESULT` |
| The comparison is shown even with one answer | PASS | And says there was nothing to weigh it against |
| The brief caps how often a question is repeated | PASS | At most twice, then thank and end |
| Being sent to a website ends the call | PASS | Recorded as a refusal, not rephrased and retried |
| A repeated reply is treated as a recording | PASS | Asking a recording again cannot work |
| Holding does not become a loop | PASS | Wait once, not twice |
| Ending with no answer is stated to be a good outcome | PASS | Otherwise every local decision favours trying once more |
| Any compared business can be acted on | PASS | Not only the one that came top |
| Dial rings past the ordinary ceiling when nothing is usable | PASS | Stops at `MAX_CALLS_UNTIL_RESULT`, not `MAX_CALLS_PER_TASK` |
| Persistence stops the moment something comparable arrives | PASS | It exists to get an answer, not to exhaust the list |
| Persistence is still bounded | PASS | 40 businesses available, 5 rung |
| The daily budget still binds while persisting | PASS | Real money, not judgement |
| The timeline distinguishes the two reasons for trying another | PASS | "Still nothing usable — trying X" |
| The best option can be rung back to act | PASS | New task carries the user's instruction and that business |
| An acted-on commitment is gated afresh | PASS | Appointment waits for confirmation |
| An empty instruction is refused | PASS | 400, never a call with nothing to say |
| Every CALL-E error code has a user-facing message | PASS | Eight were missing, including `call_not_ready` |
| No message key matches a non-existent code | PASS | `recipient_schema_invalid` never applied; the real code is `recipient_result_schema_invalid` |
| No code renders as the generic sentence | PASS | The generic one is kept for "no code at all" |
| A call the service was not ready to place is retried | PASS | Nothing was dialled, and the idempotency key makes a retry safe |
| Failures that would re-ring a stranger are never retried | PASS | `invalid_phone`, `recipient_blocked`, `insufficient_balance` and others |
| A user can call a business Dial skipped | PASS | Call placed, timeline says it was asked for |
| A user-chosen call passes the per-task ceiling | PASS | The ceiling bounds Dial's autonomy, not the user |
| The new outcome joins the comparison | PASS | Tally counts every call, not only Dial's own |
| A business with no dialable number is refused | PASS | 409 `no_phone`, naming the business |
| The same business is not called twice | PASS | 409 `already_called` |
| The daily budget still applies | PASS | 429 `budget_exhausted` |
| A policy forbidding calls still applies | PASS | 403 `not_authorized` |
| Another user cannot call from someone else's task | PASS | 404 |
| A direct call asks what it is for | PASS | "What do you want from Malik?"; nobody rung while Dial has nothing to say |
| An unclear answer is met with another question | PASS | "idk" -> re-asked, worded differently |
| The asking stops after two attempts | PASS | Call goes ahead, kept general, and says so |
| A stated purpose is not questioned | PASS | No question when the request already says what it wants |
| A search is never asked its purpose | PASS | The search phrase is itself the purpose |
| A finished job releases its dedupe key | PASS | Same key re-enqueueable after completion and after death; refused while outstanding |
| Answering a question after the search does not strand the task | PASS | Live: "call malik" ran to completion instead of stalling in `interpreting` |
| A named contact is dialled without a location question | PASS | Live: contact matched, one call placed, task completed |
| An unknown person gets a useful message, not a city prompt | PASS | "Dial does not have a number for Malik" |
| Intake questions are skipped when Dial knows who to ring | PASS | No search to sharpen |
| A number in the request skips the search entirely | PASS | No geocode, no directory, no location question; one call placed |
| Ordinary numbers are not mistaken for phone numbers | PASS | Prices, order numbers, party sizes and times all yield nothing |
| An emergency number is never extracted | PASS | `999` refused before the policy layer is reached |
| A national number is read against the last searched country | PASS | "055 550 1234" + AE -> +971555501234 |
| A saved contact names the call | PASS | Timeline and results show the contact name, not the bare number |
| Saving the same number twice renames it | PASS | One row, latest name |
| Contacts are private to their owner | PASS | Another user gets 404 on rename and delete, and an empty list |
| A second server is refused, not allowed to corrupt the database | PASS | Live: refused by pid, first server stayed healthy |
| A lock left by a dead process does not block startup | PASS | Cleared with a warning rather than requiring manual deletion |
| A damaged database recovers on the next start | PASS | Live: moved to `.pgdata.corrupt-20260823-101534`, fresh one created, migrations ran |
| An unopenable database gives an actionable error | PASS | Names the cause and the fix, never `Aborted()` |
| Google types map to Dial's vocabulary | PASS | `locality`->city, `administrative_area_level_1`->state; a country stays too coarse to search |
| A disabled Google API does not break geocoding | PASS | Live: real key with all three APIs off — Google rejected, Nominatim answered, Dubai and Saudi Arabia both resolved |
| A rejected key is not reported as an empty area | PASS | `REQUEST_DENIED` raises; only `ZERO_RESULTS` returns null |
| Google setup is checkable in one command | PASS | `node scripts/check-google.mjs` named all three disabled APIs and the project id |
| Intake asks 3-5 questions before starting | PASS | Real Gemini produced 4 for an iPhone repair, each with one-tap options; skippable; answers reach the call brief |
| Answers to unasked questions are discarded | PASS | An injected key never becomes a task constraint |
| A business that does not answer is abandoned after 60s | PASS | 30s x 2; marked `no_answer`, next business dispatched |
| Wording never claims a call was cancelled | PASS | CALL-E exposes no cancellation; asserted in the test |
| Provider queue time is not charged to the answer budget | PASS | A call held in `queued` past the budget is never marked no_answer |
| An answered call is never cut off mid-conversation | PASS | Transcript turns and `in_progress` attempts both count as answered |
| A phone that genuinely rings out is still abandoned | PASS | `dialing` past the budget -> `no_answer` / `answer_timeout` |
| A late result reclaims a call Dial stopped waiting for | PASS | Terminal snapshot may overwrite an `answer_timeout` row |
| The user is not interrogated unnecessarily | PASS | `shouldAskClarification` enforces section 10 in code, not prompt wording |
| User location works | PASS | Real Nominatim geocode of "Dublin 2" → 53.3389, -6.2527, IE; e2e |
| Real business discovery | PASS | Live Overpass query returned **59 real Dublin businesses** |
| Business phone retrieval | PASS | **15 of 59** carried numbers passing E.164 validation |
| Numbers normalised/validated | PASS | 10 unit tests incl. rejecting `+1 111 111 1111` |
| CALL-E reached and authenticated | PASS | Live `GET /v1/calls/{unknown}` with the supplied key returned **HTTP 404 `not_found`**, not 401/403 — the credential works and the error envelope matches the encoded contract. Read-only; no call placed |
| CALL-E used to place a call | PASS | **Real call `call_3kj1Yo8peCmczk6WKjjroA`** placed 2026-08-20T08:36:31Z to an owner-authorised number. Reached the handset and was **declined by the recipient** (`status=DECLINED, Hangup by: user`, 0s duration) |
| Real outcomes stored | PASS (mock provider) / BLOCKED (real) | pipeline tests persist and re-read results |
| Structured results | PASS | 25 schema tests; null result → `needs_review` |
| Multi-business comparison | PASS | 9 comparison tests incl. callout fee flipping the winner |
| Evidence preserved | PASS | candidates, calls, transcripts, `sourceUrl` all persisted and rendered |
| Result ranking | PASS | ranking + comparison tests |
| Task history | PASS | e2e list; identical via cookie and bearer |

### Reliability

| Requirement | Status | Evidence |
| --- | --- | --- |
| Tasks survive refresh/restart | PASS | "survives a restart" test; e2e re-read |
| Worker retries do not duplicate calls | PASS | unique `idempotency_key`; "never dials the same business twice" |
| Webhooks idempotent | PASS | 7 webhook tests; replay is a no-op |
| Webhook cannot inject data | PASS | hostile €1 payload ignored; re-fetched €95 stored |
| Errors become user-visible states | PASS | 7 failure-path tests, each with distinct wording |
| Simulated calls are labelled as simulated | PASS | `calls.provider` recorded at dispatch; banner + per-row pill + self-identifying transcript |
| Provider errors never reach the UI | PASS | `presentableFailure` rejects JSON bodies, stack traces, SQL and connection errors; 10 tests, written after a real Gemini 503 body was rendered verbatim |
| A transient model outage retries rather than failing | PASS | Verified against the live provider during an actual Gemini overload |
| Partial completion works | PASS | `partially_completed` when some calls fail |
| Queue survives worker death | PASS | `reclaimStaleJobs` test |
| Multi-worker contention | **BLOCKED** | PGlite is single-connection; needs a real Postgres server |

### Web

| Requirement | Status | Evidence |
| --- | --- | --- |
| Matches supplied design reference | PASS | tokens extracted from the screenshot; shell, composer, suggestion cards reproduced |
| New functionality follows the design | PASS | task/result/settings screens use the same tokens |
| Responsive | PASS (code) / **BLOCKED** (visual) | breakpoints at 1024/860/560; no browser driver available to screenshot |
| Auth + redirect | PASS | anonymous `/` → 307 `/sign-in`; e2e |
| Renders real data | PASS | hero and history render server-side with real rows |
| No secret in the bundle | PASS | e2e greps the page for key names and live key prefixes |
| Accessibility | PARTIAL | semantic controls, labels, focus-visible, reduced-motion, contrast tokens. **No screen-reader or axe run** — BLOCKED, no tooling here |

### Mobile

| Requirement | Status | Evidence |
| --- | --- | --- |
| iOS bundles | PASS | 2.60 MB Hermes `.hbc` |
| Android bundles | PASS | 2.59 MB Hermes `.hbc` |
| TypeScript clean | PASS | `tsc --noEmit` |
| Signed release artefact | **BLOCKED** | needs Apple/Google developer credentials |
| Runs on a device/simulator | **BLOCKED** | no simulator or device available here |
| Same account/data as web | PASS (server-side) | bearer and cookie resolve to the same user and task list; e2e |
| Location permission handling | **BLOCKED** | needs a device to grant/deny |
| Push notifications | **BLOCKED** | needs FCM/APNs credentials. Notifications are persisted server-side already |

### Security

| Requirement | Status | Evidence |
| --- | --- | --- |
| No API secrets in client | PASS | e2e assertion + BFF proxy architecture |
| Authorization enforced | PASS | cross-user read/cancel/delete all 404 |
| Input validated | PASS | Zod on every endpoint; 400s tested |
| Sensitive data protected | PASS | scrypt, hashed session tokens, masked phones, redacted logs |
| Webhook boundary hardened | PASS | 7 tests |
| Abuse limits | PASS | per-task cap and daily ceiling both tested |
| Prompt-injection defence | PASS | delimiter-escape, template markers, length cap, enum coercion |
| SSRF protection | PASS (code) | allowlist + per-hop revalidation. Not exercised against a live attacker |
| Account/data deletion | PASS | e2e deletes the account; session dies with it |

### Engineering

| Command | Status |
| --- | --- |
| `install` | PASS |
| `lint` | PASS — 0 errors, 0 warnings |
| `typecheck` | PASS — 14 workspaces |
| `test` | PASS — 184 |
| `integration-test` | PASS — 60 |
| `e2e` | PASS — 24 |
| `build:web` | PASS |
| `build:api` | PASS |
| `build:mobile` | PASS (JS bundle) |

### Real integration

| Requirement | Status | Missing |
| --- | --- | --- |
| A real CALL-E call is placed | PASS | call id `call_3kj1Yo8peCmczk6WKjjroA`, returned by the live API |
| The real result is received | PASS | Terminal `status: failed`, `failure_code: call_failed`, `completion_confidence {score: 0.66, label: medium}`, plus a schema-valid `structured_result` |
| Dial maps the real result correctly | PASS | `deriveDisposition` on the real snapshot returns `failed`; the call is **not** counted as answered and yields **no** "best option" |
| Evidence returned and preserved | PASS | CALL-E returned 3 evidence lines and an `evidence_summary`; 0 transcript turns, correctly reported as 0 rather than invented |
| No mock path involved | PASS | `TEST_PROVIDER=real`, `CalleCallProvider`, live `api.heycall-e.com` |
| AI disclosure honoured by the agent | PASS | CALL-E's own plan summary: *"will identify itself as an AI assistant calling on behalf of the Dial engineering team ... without asking for personal information"* |
| A declined call is not fabricated into a result | PASS | `question_answered: "no"`, evidence states 0s duration and no ASR captured |
| §32 flagship scenario, calls simulated | PASS | Real Gemini + real OpenStreetMap near Dubai: **78 businesses found, 5 contacted, 3 answered, 2 comparable**, honest headline. Calls on the fake provider |
| §32 flagship scenario with real calls | **BLOCKED** | needs businesses that have authorised being rung |
| §33 plumber scenario | **BLOCKED** | as above |
| §34 restaurant scenario | **BLOCKED** | as above |
| §35 pharmacy scenario | **BLOCKED** | as above |

---

## Unblocking the remaining tests

### 1. Task interpretation and the full lifecycle

Add to `.env`:

```
LLM_API_KEY=AIza...        # https://aistudio.google.com/apikey
```

Then `npm run e2e` runs the task-lifecycle checks instead of skipping them: a
real instruction is interpreted, real businesses are discovered, and the
pipeline runs to a real comparison — with calls still going to the fake provider
so nothing rings.

This alone validates **everything except the phone call itself**.

### 2. A real phone call

```bash
TEST_PROVIDER=real npm run calle:verify -- +353871234567
```

It places **one** call to **one** number given on the command line, after a
five-second abort window, and prints the real call id, the terminal status, the
structured result, the confidence and the transcript turn count.

It will not read a number from discovery. Dialling a real business has to be
deliberate.

### 3. The flagship scenario with real calls

Only after (1) and (2), and only against businesses you have authorised. Set
`TEST_PROVIDER=real`, keep `MAX_CALLS_PER_TASK` low, and use
`excludedBusinesses` or a tight radius to control who gets rung.

**Not done here, and not claimed.** No real business has been called.

---

## Notable defects found by these tests

Recorded because they are the argument for having written them:

1. **`status` collided with a CALL-E reserved field** — caught by the schema
   test, not by reading the docs. Renamed to `reported_status`.
2. **Migrations failed on PGlite** — multi-statement SQL is rejected by the
   extended query protocol. Fixed with a quote-aware splitter.
3. **The daily call budget could not be computed once clamped** — the code
   derived the prior value by subtraction, which is wrong when the addition was
   capped. Fixed by returning `new - old` from the statement itself.
4. **Tasks parked in `calling`** — a provider returning a terminal snapshot at
   create time was never advanced. Now applied inline.
5. **Test env leaked between files** — the harness mutated `process.env`, so one
   test's call ceiling silently applied to the next.
6. **Irish E.164 assertions were wrong in my own test** — the library was right;
   the test was corrected, not the code.
