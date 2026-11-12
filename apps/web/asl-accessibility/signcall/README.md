# signcall

The phone-call workflow server for the ASL accessibility project. Given a validated booking request, it finds clinics, lines up an interpreter, asks the person to approve, books the appointment, confirms the interpreter, and can cancel later. The phone calls are placed with CALL-E through the `calle-ai` Python SDK.

Start with the [project README](../README.md) for the overview, setup, every environment variable and the safety design. This file covers how the workflow behaves, how to test it and where it stops.

> **No real clinic, interpreter or family member has ever been called with this code.** All live testing redirected every call to phone numbers owned by the authors (see `SIGNCALL_TEST_LINES` in the project README). The clinic and interpreter *searches* did run against real data (Apify Google Maps and the Illinois interpreter registry); only the dialing was redirected.

## Where it sits

CALL-E has no visual input; its interface is natural-language text. So the sign-language side and the phone side meet at one JSON object, [`schemas/user_input.schema.json`](./schemas/user_input.schema.json). The web app in [`../asl-recognition`](../asl-recognition/README.md) builds it from a camera or typed request plus a stored profile. [`dev/text_harness.py`](./dev/text_harness.py) builds the same object directly, which is how everything here is tested without a camera or a model.

## The workflow

```
STEP 1  validate the request           user_input.py       no calls
STEP 2  find and match a clinic        clinic_call.py      one clinic at a time, nearest first, insurance-gated, up to 10 called
STEP 3  line up an interpreter         appointment.py      the user's own  |  family (one at a time)  |  freelance (batches)
STEP 4  ask the person                 confirmation.py     nothing is booked until they say yes
STEP 5  book, confirm, notify          appointment.py      clinic first, then the interpreter's binding confirm, then texts
```

- **Consent has two stages.** `POST /runs` consents to the *search*: it returns `plan`, the plain-language text of what will be done, and starts calling clinics and asking interpreters whether they are free. Nothing is booked or bindingly confirmed until the run reaches `awaiting_confirmation` with a concrete proposal (clinic, date, time, interpreter, estimated cost) and `POST /runs/{id}/confirm` is answered `true`. A `false`, or no answer within `SIGNCALL_CONFIRM_TIMEOUT_SECONDS` (default 900), ends the run as `declined` with nothing booked.
- **Clinic search.** The ZIP and appointment type go to an Apify Google Maps search. Results are filtered (callable US number, open, matching category, de-duplicated by phone) and sorted nearest first by ZIP centroid. Each clinic is called in turn to check if it accepts the user's insurance, and is user provided time slots are free. The search stops at the first clinic whose slots overlap the person's availability. At most **10 clinics** are called.
- **Interpreter.** Three sources, in this order of the person's choice. (1) The person brings their own: nobody is called. (2) A family member: the family list is called one at a time, after the clinic match, and stops at the first yes. (3) A freelance interpreter: batches of 2 are asked about availability and hourly rate, and at most **3 batches (6 interpreter calls)** are tried. The cheapest available interpreter in the first batch with a match gets the binding confirm; if they decline, the next one in that batch is tried.
- **Booking.** After approval the clinic is booked first (a patient booking is normally free to cancel), then the interpreter is asked to commit. A family member's earlier "yes" was given before the slot was booked, so they get the same binding confirm. Only the interpreter the person approved is asked: **if they decline, or the call does not complete, the clinic booking is cancelled and the run ends.** No other family member or paid interpreter is substituted without the person's approval. A booking is only accepted if the call completed and the clinic stated the exact date and time that was approved; a missing or different date or time is rejected.
- **Honest failure.** If no clinic can be found, or no interpreter can be found, the run ends `declined` with a plain message ("nothing booked") and nobody is charged. There is no synthetic fallback dataset anywhere.
- **Cancellation.** `POST /runs/{id}/cancel` calls the clinic to cancel, then releases whoever was interpreting (nobody for a user-arranged interpreter), but only after the clinic confirms. If the clinic does not confirm, the run ends as `cancel_unresolved`: the interpreter is not released, nothing is retried, and the error names the clinic and booking reference to contact. A technical failure (`cancel_failed`) can be retried. Only the server's own in-memory record of the run is used: any request body is ignored, so a caller can't substitute a different clinic or number. After a server restart that record is gone and the cancel is refused (`404`).

## Setup

Python 3.11 or newer (`calle-ai` requires it).

```bash
cd apps/web/asl-accessibility
python3 -m venv .venv && source .venv/bin/activate     # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r signcall/requirements.txt
cp signcall/.env.example signcall/.env
```

Settings are in [`.env.example`](./.env.example) and documented in the [project README](../README.md#every-setting). Mock mode needs no key. Real calls need `CALLE_API_KEY`, `SIGNCALL_TEST_LINES` and two switches; clinic search needs `APIFY_API_TOKEN`.

**Always run from `apps/web/asl-accessibility/`, never from inside `signcall/`.** The SDK installs a package named `calle`, and this app has a folder named `signcall/calle/`. Running from inside `signcall/` makes Python import the local folder instead of the SDK, silently. Internal imports are relative (`from ..calle.run import call_and_wait`), so a bare `calle` always means the SDK.

## Run the server

```bash
cd apps/web/asl-accessibility
CALLE_MOCK_MODE=1 SIGNCALL_API_DEMO_MOCKS=1 \
  python3 -m uvicorn signcall.api.server:app --host 127.0.0.1 --port 8001
```

| Route | Request | Response |
|---|---|---|
| `POST /runs` | the user-input JSON | **202** `{run_id, status, mock_mode, plan}` · **400** with the validator's message (nothing called) · **409** if a run is active |
| `GET /runs/{run_id}` | | `{status, proposal, result, error, error_type, plan, started_at, finished_at}` · **404** unknown. `status` is `running`, `awaiting_confirmation`, `succeeded`, `declined`, `failed`, `cancelling`, `cancelled`, `cancel_failed` or `cancel_unresolved` |
| `POST /runs/{run_id}/confirm` | `{"approved": true\|false}` | **200** · **409** if no answer is awaited (including a second answer) · **404** |
| `POST /runs/{run_id}/cancel` | no body (any body is ignored) | **202** · **409** if nothing to cancel or already cancelling · **404** unknown, including a run forgotten after a restart |
| `GET /health` | | mode flags and whether keys are present (never their values) |

A run is accepted, not awaited: a real one places many calls over minutes, so clients poll `GET /runs/{id}`, or receive pushes at `SIGNCALL_NOTIFY_URL` (`confirmation_requested`, `run_finished`, `run_cancelled`; see [`api/notify.py`](./api/notify.py)). Every push carries `SIGNCALL_NOTIFY_SECRET` in the `X-Signcall-Secret` header, and the web app refuses pushes without it.

**The server refuses to start in real-call mode** unless `CALLE_MOCK_MODE=0`, `SIGNCALL_API_ALLOW_REAL_CALLS=1` and `SIGNCALL_TEST_LINES` are all set, so a bare launch with a working key cannot dial.

Before pointing anything else at it:

- **No authentication.** It is a single-user local server. CORS only admits `localhost` origins, but CORS is not a security boundary.
- **One run at a time**, enforced with a lock (a second `POST /runs` gets `409`). The line-assignment map in `calle/run.py` is per run, so overlapping runs would corrupt it. Do not use `--workers` greater than 1 or `--reload`, and do not bind `0.0.0.0`.
- **`GET /runs/{id}` returns the plan text**, which includes the patient's name, date of birth and insurance policy number. The run registry is in memory and unbounded; restarting forgets it.
- **Phone numbers are masked** to their last four digits in everything the API returns or pushes (results, proposals, plan, errors, events) by [`api/masking.py`](./api/masking.py). The real numbers are kept in memory under internal fields that `GET /runs/{id}` never returns; cancellation dials from that private copy.

## Testing

The test suite is a set of scripted scenarios. Each runs entirely in mock mode with no network and no credentials; every phone number's reply is scripted with `register_mock()`, so the suite also proves nothing is dialed that was not scripted.

```bash
cd apps/web/asl-accessibility
python3 -m signcall.dev.text_harness <scenario>
```

| Scenario | What it proves |
|---|---|
| `clinic_search` | Full sequence: clinic search, insurance gate, family, freelance batch, booking, confirmations. |
| `shortcut` | `has_interpreter: true`: same clinic search, nobody called for the interpreter. |
| `decline_then_retry` | The cheapest interpreter declines the binding confirm; the next in that batch takes it. |
| `cheapest_wrong_day` | The confirmed interpreter is booked for the slot they named, never another. |
| `family_locks_in` | Family are called one at a time after the clinic match and stop at the first yes. |
| `family_confirm_declined` | The approved family member declines the binding confirm, or the call does not complete: the clinic booking is cancelled and nobody else is substituted. |
| `clinic_search_exhausted` | The 10-clinic ceiling: 11 offered, exactly 10 called. |
| `no_interpreter_available` | No interpreter found: honest "nothing booked", no clinic appointment taken. |
| `call_scripts` | All 9 call types open by saying they are an AI agent and end with the brevity and safety rule. |
| `requirements` | Requirements and notes from calls reach the proposal. |
| `clinic_alternate_date_rejected` | A booking call reporting a different date or time, or none at all, is rejected, not accepted. |
| `freelance_parallel` | `SIGNCALL_FREELANCE_PARALLEL_BATCH=1`: a batch's members are dialed at once. |
| `sequential_batch_calls_both` | The default sequential dispatch still asks every member of a batch. |
| `declined` | The person says no: nothing booked, clean end. |
| `interpreters_all_decline` | Every interpreter declines the final confirm, or the confirm call does not complete; the clinic booking is cancelled. |
| `input_validation` | Every malformed profile is rejected before any call. |
| `clinic_lookup` | The Maps parser and filters against canned Apify items; empty result on a missing token. |
| `il_interpreter_lookup` | Illinois ZIP and county lookup, phone extraction, Active-plus-phone filter, county-then-region tiers, against canned rows. |
| `call_routing` | Real-mode dialing resolves only to configured test lines, stickily per recipient, and refuses when missing or malformed. |
| `api_endpoint` | The HTTP flow in-process: 400, 202, confirm, cancel, 409, 404, the forgotten-run cancel, an unconfirmed clinic cancel that stops without releasing the interpreter, phone numbers masked in everything returned or pushed, timeout to declined. |

Run them all:

```bash
for s in clinic_search shortcut decline_then_retry cheapest_wrong_day family_locks_in \
         family_confirm_declined clinic_search_exhausted no_interpreter_available call_scripts \
         requirements clinic_alternate_date_rejected freelance_parallel sequential_batch_calls_both \
         declined interpreters_all_decline input_validation clinic_lookup il_interpreter_lookup \
         call_routing api_endpoint; do python3 -m signcall.dev.text_harness $s || break; done
```

**Placing real calls from a scenario** (to your own test lines only):

```bash
CALLE_MOCK_MODE=0 python3 -m signcall.dev.text_harness <scenario>
```

In real mode `resolve_dial_target()` maps every clinic and interpreter onto `SIGNCALL_TEST_LINES`, so it cannot reach a real business. Family numbers are dialed as entered. [`dev/live_smoke_test.py`](./dev/live_smoke_test.py) places one call and prints CALL-E's raw response next to the mapped result, to check that the field mapping in `calle/run.py` still matches the live API; it refuses numbers outside the test lines.

## Coverage and data sources

| Piece | Source | Coverage |
|---|---|---|
| Clinics | Apify Google Maps Scraper (needs `APIFY_API_TOKEN`) | Search works for any US ZIP. This build accepts **Nevada and Illinois ZIPs only**, because ranking uses a ZIP-centroid table per state (`data/nv_zip_centroids.json`, `data/il_zip_centroids.json`, GeoNames, CC BY 4.0). Add a state by adding its file and registering it in `COVERED_STATES` in `workflow/user_input.py`. |
| Interpreters | The Illinois Deaf and Hard of Hearing Commission's public licensed-interpreter directory, queried live on every run and never cached | **Illinois only.** Filtered to an Active license and a published phone number; matched by county, then by region, because the directory publishes no ZIP or address. Every other state returns an honest empty result. |

An earlier version scraped the RID (Registry of Interpreters for the Deaf) directory. That was removed because RID's terms do not permit automated scraping. See the docstring of [`workflow/interpreter_lookup.py`](./workflow/interpreter_lookup.py) for why the Illinois directory is usable.

## Layout

```
signcall/
├── schemas/            user_input.schema.json (the input contract), clinic_record.schema.json
├── data/               ZIP centroid tables; clinics_last_search.json is a git-ignored runtime dump
├── api/                server.py (HTTP), notify.py (push events), demo_mocks.py (scripted answers)
├── workflow/
│   ├── appointment.py          the orchestrator: steps 2-5 and cancellation
│   ├── user_input.py           schema validation, one-hour slot parsing, covered states, ZIP lookups
│   ├── clinic_lookup.py        Apify search, filtering, sorting
│   ├── clinic_call.py          clinic search, booking and cancel calls
│   ├── family_call.py          the ordered family list
│   ├── interpreter_lookup.py   Illinois registry query
│   ├── interpreter_matching.py freelance batches, rate ranking, binding confirm, release
│   ├── calendar.py             clinic slots intersected with the person's availability
│   ├── confirmation.py         BookingProposal, BookingDeclined, NoMatchFound
│   ├── reminders.py            confirmation text (composed, delivery is a stub)
│   └── types.py                shared dataclasses
├── calle/run.py        call_and_wait(): the only function that reaches CALL-E; mock mode; test-line routing
└── dev/                text_harness.py (the scenarios), live_smoke_test.py
```

### How CALL-E is used

Only the `calle-ai` SDK is used (pinned to `0.7.0` because `calle/run.py` relies on SDK internals). The workflow is a deterministic state machine, so there is no LLM deciding the next call; each call is one scripted task with a result schema, started with `client.calls.create()` and polled by `call_and_wait()`. That function polls against a wider terminal-status set than the SDK's own `wait_for_result()` (which would sit through the full timeout on a voicemail or no-answer), retries on CALL-E's concurrent-call limit until `CALLE_CONCURRENCY_RETRY_DEADLINE_SECONDS`, appends the brevity and safety rule to every task, and serialises two calls to the same dial target.

## Known limitations

- **Never called a real business.** See the note at the top. Real clinics' phone systems, IVR menus, voicemail and refusal to talk to an AI are untested.
- **Two states for clinics, one for interpreters.** Everything else is rejected or returns nothing.
- **Clinic yield is not guaranteed.** Listings are dropped for no callable number, closed, non-US, duplicate phone, or a category that does not match. 20 places are requested to fill a list of 10. The category filter is a keyword allow-list (`CATEGORY_KEYWORDS` in `clinic_lookup.py`), not semantics; widen it if a legitimate clinic type is filtered out.
- **"Nearest first" is ZIP-granular.** Distance comes from ZIP centroids, so clinics in the person's own ZIP all score 0.0 and Maps' own ordering is discarded. Interpreter matching is by county then region, with no mile radius, because the directory does not publish one.
- **A clinic search takes tens of seconds** and blocks (an Apify run polled every 3 s, 240 s deadline).
- **Matching depends on exact slot strings** (`"2026-09-24 14:00"`). A call answering `"14:00:00"` or `"Thu 2pm"` yields no match, and the search reports itself exhausted. Clinic-returned dates are not normalised before parsing, so a clinic answering "Sept 24th" raises after the paid search call has already happened.
- **Satisficing, not optimising.** "Cheapest" and "nearest" are compared only within the batch that first matched, so two runs against the same pool can book different people.
- **A freelancer who is available but gives no hourly rate is not counted as a match**, so an unpriced candidate never reaches the binding confirm.
- **Call caps are fixed constants** (`MAX_CLINICS_CALLED` in `workflow/clinic_call.py`; `DEFAULT_BATCH_SIZE` and `MAX_INTERPRETER_BATCHES` in `workflow/interpreter_matching.py`).
- **No clinic-initiated reversal.** If a clinic cancels after an interpreter confirmed, nothing notices. `interpreter_matching.send_release()` exists but only user-initiated cancellation calls it.
- **Confirmation text is not delivered and nothing is added to a calendar.** `reminders.send_confirmation_text()` is a stub; the undelivered message is recorded in the run's `evidence`.
- **The booking call identifies the patient** (name, date of birth, age, phone, insurance provider and policy number) to the clinic that ends up holding the appointment. The search calls say nothing about the patient, and the consent text discloses this before anything is dialed.
- **The run mutates the objects it is given** (`ClinicCandidate`, `FamilyInterpreter`, `InterpreterCandidate`), so reusing hand-built lists across runs starts from a dirty state.
- **`AppointmentResult`** carries the booked date and time under `appointment_slot`, not at the top level.

## Next steps

1. Deliver the confirmation message (SMS, email or push) and decide whether a calendar write is worth adding.
2. Add interpreter sourcing for another state: find a public directory that permits automated use and wire it into `workflow/appointment.py::_resolve_freelance_pool()`.
3. Widen clinic coverage with another state's ZIP-centroid file.
4. Add authentication and persistence before any multi-user use.
