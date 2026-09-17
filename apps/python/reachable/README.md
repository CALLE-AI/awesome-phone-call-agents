# Reachable

Keeps a school's emergency contact list reachable, and follows up by phone when
a pupil's absence stays unexplained across register sessions.

Two workflows that feed each other: a termly **contact check** that finds the
numbers which have quietly stopped working, and a register-triggered **pattern
follow-up** that cascades through a pupil's contacts in the school's own order.
Every failed absence call flags a contact immediately, so the list is maintained
by the calling rather than in spite of it.

Runs dry by default. Every test passes with no network and no credentials.

---

## The problem

**The contact list decays silently, and the school finds out at the worst
moment.** The Department for Education's statutory guidance advises schools,
"where reasonably possible", to hold more than one emergency contact number per
pupil, because it gives the school "additional options to make contact with a
responsible adult". So schools collect two, three, four numbers at enrolment —
and then the data sits. People change jobs, relationships end, numbers are
reassigned. None of that produces a form for a parent to fill in. The school
discovers which numbers are dead on the morning a child is missing.

**Continued unexplained absence has no owner.** The same guidance expects
schools to set out their day-to-day processes "for example first day calling
**and processes to follow up on unexplained absence**", and says that where
absence continues without explanation, "further contact should be made to ensure
safeguarding". First-day calling is a named, resourced routine in most schools.
The second duty usually falls between the office and the attendance officer.

There is a clock on it. Where no reason has been established before the register
closes, the session is recorded as **code N, "reason for absence not yet
established"**, and the correct code must be entered no more than **5 school
days** after the session — after which the school must amend the record to code
O, unauthorised. So there is a short, legally-defined window in which a phone
call can still change the outcome, and it is precisely the window nobody owns.

Citations, with page numbers and the primary legislation, are in
[`docs/SOURCES.md`](docs/SOURCES.md) §3.

---

## What it does

### Workflow A — contact check (termly)

Calls each emergency contact and establishes one thing: is this still a good
number for this named person, and are they still willing to be a contact?

It does not ask for or automatically adopt a new phone number by voice.
The schema has no dedicated replacement-number field, but free-text results and
transcripts can still contain unsolicited numbers. Somebody who wants their
details changed produces an office task instead, confirmed through a channel
the school already trusts.

### Workflow B — pattern follow-up (triggered by the register)

Fires when a pupil has two consecutive sessions coded N. Consecutive means AM→PM
or PM→the next **school day's** AM, closing over weekends, holidays and staff
training days from a calendar file. The threshold is configurable.

It dials the pupil's contacts in the school's listed order and stops at the first
confirmed conversation. The call is supportive: is the contact aware, what is the
reason, is anything making attendance difficult, would they like a call from the
attendance officer.

### The loop

```
        Workflow A: contact check              Workflow B: pattern follow-up
          (termly sweep)                        (triggered by the register)
                 │                                          │
                 │  keeps the cascade order worth following │
                 └──────────────►  contact health  ◄────────┘
                                        ▲
                     every failed pattern call flags a contact
                          immediately, not next term
```

A wrong number found during a real absence call appears in contact health as
soon as that call ends, and the cascade moves to the next contact.

---

## How it relates to Roll Call

[Roll Call](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/325)
(`apps/typescript/roll-call`) is a good app that does first-hour absence
verification for schools. Reachable is deliberately not that, in three ways:

| | Roll Call | Reachable |
| --- | --- | --- |
| **Trigger** | The first hour of the first day of absence | A **pattern** across sessions, after the school's own first-day process |
| **Output** | A safeguarding verdict per child | **Support needs and a suggested register reason.** There is no outcome meaning "accounted for" |
| **Data** | Consumes the contact list | **Maintains** it — half the app is the contact check |

**Reachable adds to first-day calling and never replaces it.** `school.csv` must
carry a non-empty `first_day_process_description`, and Workflow B refuses to run
at all without one — a school without a first-day process needs one, not an
automated second-day call standing in for it. Reachable also never calls about
the session that triggered it.

No code is shared with Roll Call; it is TypeScript and this is Python. The four
fixes a maintainer asked of it are adopted here from the first commit, and each
has its own tests — see [Safety](#safety).

---

## Quick start

Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
cd apps/python/reachable
uv sync --dev
```

### No calls, no credentials, no network

This is the default. Nothing below can dial anything.

```bash
uv run reachable config                 # shows DRY-RUN and which secrets are unset
uv run reachable import                 # five CSVs, with a row-level validation report
uv run reachable scan-register          # find consecutive unexplained sessions
uv run reachable check-contacts         # open a contact-check case per contact
uv run reachable preview PF-P-1041-2026-09-11   # exactly what would be said
uv run reachable replay                 # five end-to-end scenarios against a fake CALL-E
uv run reachable serve                  # the office dashboard on 127.0.0.1:8000
uv run pytest                           # 408 tests, no network, no credentials
```

`reachable replay` is the backup demo: it runs both workflows end to end,
including the cascade, an escalation and two refusals, with the mode banner
reading `FAKE`.

### Against the local fake CALL-E server

```bash
uv run reachable fake-calle             # in one terminal
REACHABLE_LIVE_CALLS=1 \
REACHABLE_CALLE_BASE_URL=http://127.0.0.1:8787 \
  uv run reachable serve                # in another; banner reads FAKE
```

### Live, to a number you own

Only do this for a number you own and have offered for testing.

```bash
# 1. Point one sample contact at your own phone. Refuses drama numbers and
#    invalid numbers, and makes you type the contact id back.
#    Substitute your own number in E.164; no example is given here on purpose.
uv run reachable live-contact --contact C-2090 --number "<your number, E.164>"

# 2. Turn live calls on. This is necessary and NOT sufficient.
export CALLE_API_KEY=...            # server environment only
export REACHABLE_LIVE_CALLS=1
uv run reachable serve

# 3. On the case page, type the pupil's first name to confirm that one call.
```

Requires the SDK: `uv sync --extra live`.

---

## Architecture

```
  CSV exports                  ┌──────────────────────────────────────┐
  pupils / contacts /          │  importers  row-level validation     │
  register / calendar / school │  sessions   calendar-aware trigger   │
        │                      │  phone      strict ASCII E.164       │
        ▼                      │  sanitize   at the ingestion boundary│
   ┌─────────┐                 └──────────────────────────────────────┘
   │  store  │  append-only event log + idempotency ledger (SQLite)
   └─────────┘
        ▲
        │        ┌───────────────────────────────────────────────┐
   orchestrator ─┤ policy   ten guards, evaluated before any dial │
   the only      │ machines two pure state machines, no I/O       │
   thing that    │ calls    contracts → binding → dispositions    │
   can dial      └───────────────────────────────────────────────┘
        │
        ├── DryRunClient    renders a masked preview, never dials  (default)
        ├── FakeCalleClient scripted, in-process or loopback HTTP
        └── CalleClient     the calle-ai SDK, allowlisted origin only
                              │
                              ▼
                   create → poll → bind → classify
                   (never create_and_wait: a restart must resume by reading)
```

The two state machines are pure functions of `(state, event, guard answers)` and
do no I/O, so every transition in
[`docs/STATE_MACHINE.md`](docs/STATE_MACHINE.md) is directly testable.

---

## Safety

Full contract in [`docs/SAFETY.md`](docs/SAFETY.md). The parts that matter most:

**Nothing is said about a child until identity is confirmed**, and then only the
child's **first name** — never a surname, year group or form group. Voicemail,
and anyone who is not the named contact, hears only that the school called and a
request to ring the office. No child is named and no reason is given. This is why
it is safe to dial a list we already suspect is partly wrong.

**Vulnerable-flagged pupils are never called automatically.** The gate is
evaluated before any contact is even selected, and produces a staff task carrying
the school's own notes.

**Reachable never concludes a child is safe.** There is no state, enum value or
report cell that means it, and a test asserts the words never appear in any
event, task or export.

**It never writes to a register.** Attendance reasons are *suggestions* a member
of staff approves. No register-writing function exists to be called.

### The four fixes from the Roll Call review

Each has its own section in
[`tests/test_review_requirements.py`](tests/test_review_requirements.py), with the
adversarial cases rather than only the happy ones.

1. **Credential allowlist.** Bearer credentials go only to
   `https://api.heycall-e.com` or a loopback fake. Any other origin is rejected
   **at startup, before the API key is read** — a tripwire test proves the key is
   never touched when the origin is refused. Matching is on the parsed host, so
   `api.heycall-e.com.attacker.test` and `api.heycall-e.com@evil.test` are both
   refused. Only two modules in the app ever see the key, and no other HTTP
   client exists.
2. **Sanitisation.** All provider free text is cleaned at the ingestion boundary:
   control characters and bidirectional overrides stripped, length capped.
   Provider `summary` and `evidence` are not persisted at all — there is no
   column for them. Templates autoescape and none uses `|safe`. CSV exports
   neutralise leading `=`, `+`, `-`, `@`.
3. **Result binding.** A result counts only if the call id, idempotency key,
   destination, pupil and contact all match what was reserved — and an identity
   confirmation must be supported by a transcript turn the **recipient actually
   spoke**. A `speaker: bot` or `speaker: unknown` turn is not evidence. A
   generic yes/no never triggers an attendance or safeguarding action; an
   unbound but alarming result goes to human review, not to an escalation.
4. **Strict ASCII E.164** (`^\+[1-9][0-9]{7,14}$`, ASCII input only) before any
   live call, at import *and* again at dial time. Numbers are **rejected, never
   repaired** — no stripping spaces, no inferring `+44` from a leading zero.
   Unicode digits are refused rather than normalised into something dialable.

### Dry run, and the two locks on a live call

A call needs **both**:

1. `REACHABLE_LIVE_CALLS=1` in the server environment; **and**
2. a per-call confirmation — typing the pupil's first name on that case's page.

Without (1) every code path still runs: the task is rendered, the schema built,
the idempotency key derived and reserved, the destination masked and displayed.
Only the network request does not happen.

The dashboard always shows a mode banner: `DRY-RUN`, `FAKE` or `LIVE`.

### Side effects, and how to undo them

| Side effect | Scope | Cancellation |
| --- | --- | --- |
| An outbound phone call | One contact, one authorisation | Cannot be un-made. This is why two independent switches and ten guards precede it |
| Rows in a local SQLite file | `REACHABLE_DB`, default `data/`, gitignored | Delete the file |
| A staff task | Local only | Mark handled in the dashboard |
| A CSV export | A file you downloaded | Delete it |

There are **no recurring jobs**. Nothing is scheduled; the office runs
`scan-register` and `check-contacts` when it chooses, or a host scheduler does.
Stopping the process mid-call never redials on restart — it reconciles by reading
the call back through `GET /v1/calls/{id}`.

**Nothing is written to any school system.** No management-information-system
integration exists.

### Credentials

`CALLE_API_KEY` and `REACHABLE_ADMIN_TOKEN` are read from the process
environment only. Never logged, never rendered, never exported, never in a task
text. `reachable config` shows them as `set`/`unset` — not a prefix, because a
prefix is still key material. `.env` is gitignored; `.env.example` documents
every variable and carries no secret values.

### Phone numbers

Private destination records use E.164; stored call evidence can also contain
numbers. Dashboard expressions, CSV cells, and CLI output mask E.164 and common
national phone formats, including numbers in quotes and provider free text.
This display-only heuristic preserves private evidence for identity checks; it
does not anonymise spelled-out numbers, names, or all possible personal data.
Use synthetic records for public demos and review exports before sharing.
The unauthenticated dashboard's `serve` command accepts loopback hosts only;
do not expose it through a public tunnel or a separately configured server.
Fixtures use only Ofcom's reserved drama
range `+447700900000`–`+447700900999`, with fictional pupils at a fictional
school; a test fails if any number in the repository could reach a real
subscriber.

### UK lines are English only

CALL-E lists English as the only language for `GB`, and UK calls use an
International line that its documentation describes as primarily intended for
testing ([`docs/SOURCES.md`](docs/SOURCES.md) §2.8). A contact recorded as
needing another language is **never called** — they are surfaced as a staff task
so a person rings them, rather than being quietly skipped or rung in a language
they may not speak.

### Data protection

Reachable is a tool a school runs; **the school is the data controller**. A real
deployment needs the school to complete its **own data protection impact
assessment** covering at least the lawful basis for calling contacts, what
contacts are told about automated calling, transcript retention, and who can see
them.

**This app does not claim legal compliance and nothing here is legal advice.**
The defaults — a 09:00–16:00 calling window, 14-day transcript retention, the
wording of the calls — are engineering choices made to be defensible. They are a
starting point for that assessment, not a substitute for it. Nothing here has
been reviewed by a lawyer or a data protection officer.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). The ones that
change behaviour rather than wiring:

| Variable | Default | Effect |
| --- | --- | --- |
| `REACHABLE_LIVE_CALLS` | unset | Exactly `1` allows calls. Necessary, not sufficient |
| `REACHABLE_CALLE_BASE_URL` | official origin | Official origin or a loopback fake. Anything else refuses at startup |
| `REACHABLE_TRIGGER_SESSIONS` | `2` | Consecutive code-N sessions that fire a follow-up |
| `REACHABLE_MAX_ATTEMPTS` | `2` | Authorised attempts per contact |
| `REACHABLE_CASCADE_LIMIT` | `4` | Contacts tried per pupil per trigger |
| `REACHABLE_CONFIDENCE_FLOOR` | `0.6` | Minimum `completion_confidence.score`. The label is checked too |
| `REACHABLE_TRANSCRIPT_RETENTION_DAYS` | `14` | Purged at startup; the outcome survives |

The school name, IANA timezone and calling window come from `school.csv`, not the
environment, because they are properties of the school rather than the
deployment.

---

## Input

Five CSV files, because that is how school management information systems
actually let an office get data out — no integration, no vendor approval, no
credentials for the school's systems. Columns are documented in
[`docs/SPEC.md`](docs/SPEC.md) §6, and [`sample_data/`](sample_data/) is a
complete worked example.

A register date the calendar does not describe **fails the import** rather than
being assumed a school day. Inferring school days from the day of the week would
be wrong at every half-term, and the trigger and the statutory deadline both
depend on getting it right.

---

## Limitations

- Reachable establishes what a person said on a telephone. It does not establish
  that they are who they said beyond their own confirmation, and it never
  establishes that a child is safe.
- A suggested register reason is a suggestion. Only staff record attendance codes.
- Contact health reflects the last time a number was tried. One verified in
  September can be dead in October — which is why the pattern workflow writes
  back.
- English only on UK lines is a real limitation for a real population of
  families. Reachable surfaces those contacts rather than hiding them.
- The escalation rule is deliberately quick to fire: `aware_of_absence` escalates
  on `unknown` as well as `no`. Expect false alarms; the cost is a member of
  staff reading a transcript.
- Single school, single operator, one admin token. No multi-tenancy.

---

## Documentation

| File | What it settles |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | The problem with citations, users, both workflows, CSV formats, session counting, scope, configuration, dashboard |
| [`docs/STATE_MACHINE.md`](docs/STATE_MACHINE.md) | Both machines, the ten guards, every decision not to call, ambiguous outcomes |
| [`docs/SAFETY.md`](docs/SAFETY.md) | The four requirements, disclosure, authority boundaries, idempotency, retention, the data protection note |
| [`docs/CALL_CONTRACTS.md`](docs/CALL_CONTRACTS.md) | Both task texts, both result schemas, result-to-state mapping, worked examples |
| [`docs/SOURCES.md`](docs/SOURCES.md) | Every verified fact with its citation, and the conflicts found while verifying |

This is a runnable demo app, not a CALL-E SDK, and it does not define a supported
application API.
