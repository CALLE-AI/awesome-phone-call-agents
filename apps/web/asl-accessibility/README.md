# ASL Accessibility: appointment booking by sign or text, over the phone

A Deaf or hard-of-hearing person signs (or types) what they need, such as "dentist, Tuesday, 3". An AI agent then phones clinics and sign-language interpreters on their behalf, asks for the person's approval, and only then books the appointment and confirms an interpreter.

**Status: a working prototype. No real clinic, interpreter or family member has ever been called by this project.** All live testing was done by the authors, who redirected every outbound call to phone numbers they own (see [Real calls and the test-line safety net](#real-calls-and-the-test-line-safety-net)). Everything else was tested against scripted mock calls. Treat this as a reference implementation, not a service you can point at the public.

It is built on CALL-E (the `calle-ai` Python SDK), which places the calls.

## What is in this folder

| Folder | What it is | Runs on |
|---|---|---|
| [`asl-recognition/`](./asl-recognition/README.md) | The web app the person uses: camera and typed input, ASL-to-text model, profile and family storage, booking progress, approval and cancellation screens. | port 8000 |
| [`signcall/`](./signcall/README.md) | The workflow server: validates the request, searches clinics, finds interpreters, places the calls through CALL-E, asks the person to approve, books, confirms, and cancels. | port 8001 |

```
camera / typed text
      │
      ▼
 asl-recognition  ── MediaPipe landmarks ──► BiGRU sign model ──► words
      │                                                            │
      │   Gemini turns the words into availability (day + time)    │
      ▼                                                            ▼
 booking request JSON  ───────────────────────────────►  signcall  POST /runs
                                                               │
                         Apify Google Maps  ──► clinics        │
                         IDHHC directory    ──► interpreters   │
                                                               ▼
                                              CALL-E phone calls (clinic, interpreter, family)
                                                               │
 approval screen  ◄── "awaiting_confirmation" proposal ◄───────┘
      │ yes / no
      ▼
 book clinic ─► confirm interpreter ─► done (or cancel later)
```

CALL-E only takes text, so the sign recognizer and the phone workflow meet at one JSON object ([`signcall/schemas/user_input.schema.json`](./signcall/schemas/user_input.schema.json)). Everything after that JSON can be tested with no camera and no model.

## Read this first: what works and what does not

**The sign recognizer is an early-stage feature and should currently be considered experimental.** It is a small model trained on isolated dictionary-style clips. It knows **85 labels** (26 letters and 59 words), it classifies one sign at a time, and it cannot read sentences or continuous signing. It has never been measured on held out data, and it has not been tested with a range of signers. Typing is a full alternative path and is the reliable way to use the app today. The full explanation, including how the model was built and why it is limited, is in [`asl-recognition/README.md`](./asl-recognition/README.md#the-sign-model-and-its-limits).

What is solid:

- The workflow (search, approve, book, confirm, cancel) runs end to end and has 20 scripted scenarios covering the happy path and the failure paths.
- Honest failure: when no clinic or interpreter can be found, the run ends with "nothing booked". It never falls back to made up data.
- Consent in two steps: submitting a request consents to a *search*. Nothing is booked until the person answers a second, explicit approval.
- Live lookups worked in testing: clinics through Apify Google Maps, and Illinois interpreters through the state's public registry.

What is limited or missing:

- **Clinic search covers Nevada and Illinois ZIP codes only.** Other ZIPs are rejected up front.
- **Interpreter search is real for Illinois clinics only.** For any other state, the freelance-interpreter search returns nothing and the run ends honestly. A person who brings their own interpreter, or who has a family member to interpret, is unaffected.
- No authentication, and the booking API is single user. Do not expose either server to a network.
- The confirmation text to the person is composed but not sent (`signcall/workflow/reminders.py` is a stub). Nothing is added to a calendar.
- The booking is made on a phone call to a real business, so what the clinic says is whatever an AI voice agent understood. Results are checked (for example a clinic offering a different time than asked is rejected), but a phone call is not an API.

## Quick start (mock mode: no calls, no cost)

You need Python 3.11 or newer. The two apps can share one virtual environment.

```bash
cd apps/web/asl-accessibility
python3 -m venv .venv
source .venv/bin/activate            # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r signcall/requirements.txt -r asl-recognition/requirements.txt

cp signcall/.env.example signcall/.env
cp asl-recognition/.env.example asl-recognition/.env
```

Mock mode is the default in `signcall/.env.example` (`CALLE_MOCK_MODE=1`, `SIGNCALL_API_DEMO_MOCKS=1`). Every call is answered by a script, so no key is needed for the workflow. Terminal 1:

```bash
# from apps/web/asl-accessibility (NOT from inside signcall/, see Troubleshooting)
python3 -m uvicorn signcall.api.server:app --host 127.0.0.1 --port 8001
```

Terminal 2:

```bash
cd apps/web/asl-accessibility/asl-recognition
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Open <http://localhost:8000>. Set up a profile, then make a request. Notes for the demo path:

- Reading an ID or insurance card photo and turning a typed request into availability both use Gemini, so they need `GEMINI_API_KEY` in `asl-recognition/.env`. Without it you can still fill the profile in by hand, but the request parsing step (`/parse-booking`) will not return pre-filled results.
- In mock mode `SIGNCALL_API_DEMO_MOCKS=1` scripts the answers: the clinic accepts insurance and offers your first free hour, the family list declines, and the first freelance interpreter is available. Declines and dead ends are covered by the test scenarios, not the demo script.
- The clinic search still needs `APIFY_API_TOKEN` (see below) because there is no fake clinic list. Without it the run ends with "No clinic could be found". Use an Illinois ZIP for the freelance-interpreter path, since that is the only live interpreter source. To exercise the whole HTTP flow with zero credentials, run the in-process scenario instead: `python3 -m signcall.dev.text_harness api_endpoint`.

Run the whole test suite (no network, no credentials):

```bash
cd apps/web/asl-accessibility
python3 -m signcall.dev.text_harness clinic_search      # one scenario; see signcall/README.md for all 20
python3 scripts/validate_repository.py                  # from the repository root
```

## Accounts and keys

| Variable | Where | Needed for | How to get it |
|---|---|---|---|
| `CALLE_API_KEY` | `signcall/.env` | Real calls only | CALL-E dashboard. Paid credits. |
| `APIFY_API_TOKEN` | `signcall/.env` | Finding clinics (Google Maps Scraper) | An Apify account. Metered per place scraped; one search requests up to 20 places. |
| `GEMINI_API_KEY` | `asl-recognition/.env` | Reading card photos, parsing the request into availability | Google AI Studio. |

No key is ever sent to the browser. `.env` files are git-ignored. The Illinois interpreter registry is public and needs no credential.

## Every setting

**`signcall/.env`** (loaded once by `signcall/__init__.py`; variables already set in your shell win)

| Variable | Default | Meaning |
|---|---|---|
| `CALLE_API_KEY` | | CALL-E key. Real mode only. |
| `APIFY_API_TOKEN` | | Clinic search. Without it no clinic can be found. |
| `CALLE_MOCK_MODE` | `0` in code, `1` in `.env.example` | `1`: every call is scripted, nothing is dialed. `0`: real CALL-E calls. |
| `SIGNCALL_API_ALLOW_REAL_CALLS` | `0` | The server refuses to start with `CALLE_MOCK_MODE=0` unless this is `1`. Two switches so a real-call server never starts by accident. |
| `SIGNCALL_API_DEMO_MOCKS` | `0` | With mock mode on, answers HTTP runs with the demo script. |
| `SIGNCALL_TEST_LINES` | | **Required for real mode.** Comma-separated E.164 numbers you own. Every clinic and interpreter call is redirected to one of them. The server refuses to start in real mode without it. |
| `SIGNCALL_FREELANCE_PARALLEL_BATCH` | `0` | `1`: call the members of an interpreter batch at the same time. Needs a CALL-E plan that allows concurrent outbound calls and at least as many test lines as the batch size (default 2). |
| `SIGNCALL_DISABLE_IL_LOOKUP` | `0` | `1`: skip the live Illinois registry query (offline development). |
| `SIGNCALL_NOTIFY_URL` | none | Where run events are POSTed. Set it to `http://localhost:8000/notifications` for the web app. |
| `SIGNCALL_CONFIRM_TIMEOUT_SECONDS` | `900` | How long to wait for the person's approval. No answer counts as "no". |
| `CALLE_CONCURRENCY_RETRY_DEADLINE_SECONDS` | `300` | How long to keep retrying when CALL-E reports its concurrent-call limit. |

**`asl-recognition/.env`**

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | | Required for card reading and request parsing. |
| `BOOKING_WORKFLOW_URL` | | The signcall `POST /runs` URL, normally `http://localhost:8001/runs`. |
| `GEMINI_MODEL` | `gemini-flash-latest` | Pin a Gemini model. If the model stays overloaded (HTTP 429/503) the app falls back to `gemini-flash-lite-latest`. |

## Real calls and the test-line safety net

Phone calls are real world side effects, so real mode cannot reach a real clinic or interpreter in this build. To place real calls at all you must set all three: `CALLE_MOCK_MODE=0`, `SIGNCALL_API_ALLOW_REAL_CALLS=1`, and `SIGNCALL_TEST_LINES`.

```bash
# signcall/.env
CALLE_API_KEY=...
CALLE_MOCK_MODE=0
SIGNCALL_API_ALLOW_REAL_CALLS=1
SIGNCALL_TEST_LINES=+15555550101,+15555550102   # numbers you own and will answer
```

How it works (`signcall/calle/run.py`, `resolve_dial_target`):

- The workflow still *searches* real clinics and *finds* real interpreters, so the task text, ranking and evidence trail are realistic. Only the number handed to CALL-E is swapped.
- Each recipient is mapped to one test line by its position in the batch and keeps that line for the rest of the run, so "the clinic searched on line 2 is booked on line 2". With fewer lines than recipients, lines are reused in order.
- Two calls to the same line queue instead of overlapping, so one line is enough for testing but serialises everything. Parallel batch calling needs more than one line.
- **Family members are the exception.** Their numbers are dialed exactly as entered in the profile, because they are the user's own contacts. In real mode, only enter family numbers you are happy to have called.
- An unset or malformed `SIGNCALL_TEST_LINES` is an error, never a fallback to the real number.
- The live smoke test (`python3 -m signcall.dev.live_smoke_test`) places one call and prints CALL-E's raw response next to the mapped result. It refuses any number not in `SIGNCALL_TEST_LINES`.

Cost control: each run is capped at **10 clinics called** and **3 interpreter batches of 2 (6 interpreter calls)**, plus the family list. Every call script opens with "I am an AI agent calling on behalf of ..." and ends with a brevity rule, because calls are billed per second.

**A CALL-E account note.** On the account used for testing, a second simultaneous outbound call was refused with a concurrency-limit error, and the code retries until `CALLE_CONCURRENCY_RETRY_DEADLINE_SECONDS`. Buying a dedicated number in the CALL-E dashboard made it default, but outbound calling from it stayed disabled until a third-party identity verification was completed, so check your own account's terms before paying for one. Parallel batch calling worked in the authors' final test. If you leave `SIGNCALL_FREELANCE_PARALLEL_BATCH` at `0`, batch members are called one after another and none of this matters.

## Safety design

- **Explicit intent and two-step consent.** A request consents to the search only. The proposal (clinic, date, time, interpreter, estimated cost) must be approved on screen before anything is booked or any interpreter is bindingly confirmed.
- **Disclosure.** Every call opens by saying it is an AI agent calling on behalf of the patient.
- **E.164 numbers.** The web app normalises US numbers to `+1XXXXXXXXXX`; the schema rejects anything else.
- **No hidden schedules, no duplicate jobs.** The app never schedules recurring calls. One run at a time (a second `POST /runs` gets `409`), and a run cannot be double-confirmed.
- **Cancellation.** A booked appointment can be cancelled from the outcome screen or the "Upcoming" list. The workflow calls the clinic to cancel, then releases the interpreter. It is stateless about it: the web app sends the stored booking back, so a cancel works even after the workflow server restarted.
- **Scope of the calls.** Scripts restrict the agent to scheduling and logistics, tell it to give no medical, legal or financial advice, and tell it to direct anyone describing an emergency to 911 and end the call. This app is not for emergencies; a Deaf person in an emergency should use their local text-to-911 or relay service.
- **Credentials.** Keys live in git-ignored `.env` files and are read only by the server that needs them. `/health` reports presence, never values.
- **Phone numbers are not masked.** Clinic and interpreter numbers are real and unmasked in API responses and in the local database, because the cancel flow needs them. Mask them before putting the app on a screen recording, a public demo or a shared log.
- **Personal data.** The profile (name, phone, date of birth, address, insurance, family contacts) and booking records are stored in plaintext SQLite at `asl-recognition/data/app.db` (git-ignored). The booking call tells the clinic the patient's name, date of birth and insurance because a clinic cannot book an anonymous slot. There is no login: a "user" is a random ID kept in the browser's localStorage.

## Troubleshooting

- **`ImportError` or a surprising `calle` module.** The SDK installs a package named `calle`, and this repo has a folder named `signcall/calle/`. Always run signcall from `apps/web/asl-accessibility/` as `python -m signcall...`, never from inside `signcall/`.
- **Server refuses to start in real mode.** Check the three switches above; the error names the missing one.
- **`No mock registered for ...` in tests.** A scenario placed a call to a number it did not script; this is the harness protecting you from an unscripted call.
- **Gemini returns 404 or "couldn't read that".** Pinned model names get retired. Leave `GEMINI_MODEL` unset to use the `-latest` alias. 429/503 are retried automatically.
- **Camera does not start.** Browsers only grant camera access on `localhost` or HTTPS.
- **Stale page after editing static files.** The server sends `Cache-Control: no-cache`; hard-refresh once.
- **No clinics found.** Check `APIFY_API_TOKEN` and Apify credit. ZIPs outside Nevada and Illinois are rejected by design.

## Repository layout

```
apps/web/asl-accessibility/
├── README.md                this file
├── asl-recognition/         web app + ASL model          (README inside)
└── signcall/                phone-call workflow server   (README inside)
```

## Contributors and a note from us
Rutvi Mehta - @mehtar38
Kanish Godani - @kanish26
Arya Shetty - @aryashettyy

Hi, and thank you for reading this far.

First, a big thank you to the CALL-E team. Their support, including the testing credits they gave us, is what let us try this against real phone calls instead of only mocks.

This project started from a simple observation: Call agents can be a great for someone who is Deaf or hard of hearing, provided that the whole flow works without a voice. A lot of clinics also still have no website or online booking, so a phone call is the only way in. And once you get an appointment, you often still need an interpreter, which is another round of calls and coordination. We wanted one flow that handles all of it: the person signs or types a request, the agent makes the calls, and they approve before anything is booked.

We also tried to add a low typing layer, so someone could sign instead of typing. That is where we hit the most limits. Interpreter directories and repositories are hard to find and often don’t allow automated use, so we localized interpreter search to Illinois for now, where we found a public directory we could use. On the sign recognition side, there is very little publicly usable data, and we were limited by our own hardware for training and for running it. So the model recognizes a small set of isolated words and letters, not sentences, and typing is still the reliable path.

We know there is a lot of good open source and research work on sign-to-text out there. We wanted to build something of our own for this contribution. Even though it has a narrow use case, it is not where we want it to be yet, and we say so plainly in the README.

Thank you to everyone who reads this or contributes. If you’d like to see it in action, we would be happy to present a demo.


## Contributing and next steps

Good first extensions, roughly in priority order: a better sign model (more signers, continuous recognition, a held-out evaluation); a public interpreter directory for another state, wired into `signcall/workflow/appointment.py::_resolve_freelance_pool`; a ZIP-centroid file for another state in `signcall/workflow/user_input.py::COVERED_STATES`; real delivery for the confirmation message; authentication before any multi-user deployment. The full list of known gaps is in [`signcall/README.md`](./signcall/README.md#known-limitations).
