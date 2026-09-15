# Reachable — Product Specification

Reachable keeps a school's emergency contact list reachable, and follows up by
phone when a pupil's absence stays unexplained across sessions.

It is one app with two workflows that feed each other: a **contact check** that
verifies the list is still good, and a **pattern follow-up** that uses the list
when it matters. Every call the second workflow makes tests the first workflow's
data, and every failure feeds straight back.

---

## 1. The problem

### 1.1 The contact list decays silently, and nobody finds out until it matters

The Department for Education's statutory guidance advises schools, "where
reasonably possible", to hold **more than one emergency contact number** for each
pupil, because it gives the school "additional options to make contact with a
responsible adult" (page 20). The admission register must hold at least one
number per parent, and the DfE's advice is to hold one for more than one person
(page 67). See [`SOURCES.md` §3.1](SOURCES.md#31-more-than-one-emergency-contact).

So schools collect two, three, sometimes four numbers per child, usually at
enrolment, and then the data sits. People change jobs and lose the work mobile.
Relationships end and the second contact is no longer willing. A grandparent dies.
A number is transferred to someone else entirely. None of these events produce a
form for a parent to fill in.

The result is a list that looks complete in the management information system and
is quietly full of numbers that do not work. **The school discovers which ones
those are at the worst possible moment: the morning a child is missing.** That is
not a data-quality problem. It is a safeguarding problem wearing a data-quality
costume.

Nobody phones the whole list to check, because doing it by hand is hours of
office time producing, on a good day, nothing at all.

### 1.2 Unexplained absence is supposed to be followed up, and the follow-up has no owner

The same guidance expects schools to set out their "day to day processes for
managing attendance, for example first day calling **and processes to follow up
on unexplained absence**" (page 16). And, more pointedly, schools should contact
parents on the first day where no reason has been provided — and "**if absence
continues without explanation, further contact should be made to ensure
safeguarding**" (page 20). See
[`SOURCES.md` §3.2](SOURCES.md#32-first-day-calling-is-the-schools-own-process).

First-day calling is a named, owned, resourced routine in most schools. The
second duty — continued unexplained absence — usually is not. It falls between
the office (who did their first-day call and moved on) and the attendance officer
(who sees it in a report next week).

There is a clock on it. When a reason has not been established before the
register closes, the session is recorded as **code N, "reason for absence not yet
established"**. Code N must not sit on a record indefinitely: the correct code
must be entered as soon as the reason is known, and **no more than 5 school days
after the session**, after which the school must amend the record to **code O**,
which counts as unauthorised absence
([`SOURCES.md` §3.5](SOURCES.md#35-code-n-and-the-deadline)).

So there is a short, legally-defined window in which a phone call can still turn
an unexplained absence into an explained one, and it is precisely the window that
nobody owns.

### 1.3 Why this is phone work

Both problems are phone-shaped and neither is solved by another email.

A number that does not work cannot be detected by sending a text to it — a
delivery report says the network accepted it, not that the right person holds it.
Only a conversation establishes that the named person still holds this number and
is still willing to be a contact.

And a family whose child has been absent for two sessions without explanation is
often a family with something going on. A text asking them to log into a portal
is the least likely thing to work. A short, kind phone call that asks what is
happening and whether anything would help is the thing schools actually do when
they have the staff for it.

---

## 2. Users

**The school office administrator** — runs the contact check once a term and
works the queue the follow-up workflow produces. They are the busiest person in
the building and interruptible every ninety seconds. They will not read a manual.
Their view is a list with a clear next action per row.

**The attendance officer** — owns unexplained absence and support. They want to
know which families have a barrier to attendance and which asked to speak to
someone, and they want the suggested register reason ready to approve rather than
re-gathered.

**The designated safeguarding lead (DSL)** — owns anything where a contact did
not know the child was absent, or does not know where the child is. They need
those to arrive **immediately and separately**, not at the bottom of a report.
They are the reason `URGENT_HUMAN` exists as its own terminal outcome with its
own queue.

**Not a user: the parent or contact.** They never log in. Their entire interface
is one short phone call they can end at any moment.

**Not a user: the pupil.** Reachable never calls a child.

---

## 3. Workflow A — Contact check

Scheduled, typically once a term.

Reachable calls each emergency contact on the school's list and establishes one
thing: is this still a good number for this named person, and are they still
willing to be a contact?

### 3.1 The call

1. **Disclosure.** The call opens by stating it is an automated assistant calling
   on behalf of the named school.
2. **Identity first.** It asks whether it is speaking to the named contact.
   **Nothing about any child is said until this is confirmed**, and then only the
   child's **first name**.
3. **Willingness.** It confirms the person is still happy to be an emergency
   contact for that child on this number.
4. **No data capture.** If the person wants to change their details, Reachable
   says the office will be in touch and **creates an office task**. It does not
   take a new number down.

### 3.2 Outcomes

| Outcome | Meaning |
| --- | --- |
| `VERIFIED` | The named person confirmed identity and willingness on this number |
| `WRONG_PERSON` | Someone answered; it is not the named contact |
| `NUMBER_NOT_WORKING` | Not in service, or repeatedly unobtainable |
| `NO_LONGER_A_CONTACT` | The named person no longer wishes to be a contact |
| `UPDATE_REQUESTED` | They want details changed — office task raised, no number taken |
| `UNREACHED` | Voicemail or no answer within the attempt budget |
| `NEEDS_HUMAN` | Ambiguous, low-confidence, schema-invalid, unbound, or a language we cannot serve |

### 3.3 Why it never takes a new number by voice

A new phone number collected on an unauthenticated inbound-quality voice call is
the perfect vector for redirecting a school's emergency contact for a child to an
arbitrary number. The person on the line has not been authenticated; the
transcription may be wrong by a digit; and the change would flow into the record
that the school uses when a child is missing.

So Reachable is built so that this is **impossible, not discouraged**: there is
no field in the result schema that can carry a phone number, and no code path
that writes to a contact record. `UPDATE_REQUESTED` produces a task saying "this
person wants to update their details — contact them through a known channel". The
office does the rest.

### 3.4 Output

A contact-health report per pupil and per contact, and a **CSV of suggested
changes** for the office to review and apply in their own system. Reachable
suggests; the office decides; the management information system remains the
single source of truth.

---

## 4. Workflow B — Pattern follow-up

Triggered by the register, not by a person.

### 4.1 The trigger

A pupil has **two consecutive register sessions** marked code N — "reason for
absence not yet established". The threshold is configurable;
`REACHABLE_TRIGGER_SESSIONS` defaults to `2`.

**Consecutive** means AM→PM on the same day, or PM→the next *school day's* AM.
Schools take the register twice a day, "at the start of each morning session and
once during each afternoon session of every school day" (guidance page 18,
paragraph 32), which is what makes a session the right unit
([`SOURCES.md` §3.4](SOURCES.md#34-sessions-are-am-and-pm)).

Weekends, holidays and staff training days are **skipped, not counted** — they
are not school days, so they break neither the chain nor the count. This is
driven by the school calendar CSV, never inferred from the date.

### 4.2 It adds to first-day calling; it never replaces it

This is a hard configuration requirement, not a note in the README.
`school.csv` must carry `first_day_process_description` as a non-empty value, and
Reachable **refuses to run Workflow B at all** if it is missing — the decision
not to call is `NO_FIRST_DAY_PROCESS`.

Reachable also never calls about the session that triggered it, only after the
pattern. First-day calling is the school's, done by a person, and it stays that
way. The guidance names both duties separately; Reachable takes the second one.

### 4.3 The cascade

Reachable dials the pupil's contacts **in the school's listed order** — the
office knows who to try first and Reachable does not second-guess it.

It stops the moment a named contact confirms their identity. One confirmed
conversation is the end of the cascade; it does not call the rest "to be sure".

If a contact turns out to be a wrong person or a dead number, that is
**immediately flagged in contact health** and the cascade moves to the next
contact. If every contact is exhausted without reaching anyone, the case goes to
a human as `UNREACHED` — and a pupil with no reachable contact at all is exactly
the finding the DSL needs.

### 4.4 The call

Supportive, not punitive. After disclosure and identity confirmation, and using
only the child's first name, it asks:

- whether they are **aware** the child has been absent;
- what the **reason** is — a category, plus a short free-text note;
- whether **anything is making attendance difficult**;
- whether they would like a **call from the attendance officer**.

The support-first framing is taken directly from the guidance, which sets out
"providing support first before attendance legal intervention" (page 51). It is
also why fines, penalty notices and legal action are in the forbidden list in
[`SAFETY.md`](SAFETY.md) — a school may lawfully discuss those, but an automated
call is the wrong mouth for them.

### 4.5 Outcomes

| Outcome | Meaning |
| --- | --- |
| `REASON_GIVEN` | A reason category and note, with a **suggested** register reason for staff to approve |
| `SUPPORT_REQUESTED` | A barrier was mentioned, or a call from the attendance officer was requested |
| `URGENT_HUMAN` | Any sign the contact did not know about the absence, or does not know where the child is |
| `UNREACHED` | The cascade was exhausted without reaching a confirmed contact |
| `NOT_CALLED` | A guard refused, with the named reason |

### 4.6 The two rules that matter most

**Any hint the contact did not know about the absence, or says they do not know
where the child is, goes straight to `URGENT_HUMAN`.** Not to a report, not to a
queue the office reads after lunch — to the DSL queue, immediately, with the
transcript.

It fires on two conditions, evaluated before everything else:

- `aware_of_absence` is anything other than `yes`. **`unknown` counts**: "we could
  not establish whether this adult knew their child was missing from school" is
  not a neutral result.
- `knows_child_whereabouts` is `no` — an explicit statement that they do not know
  where the child is, which escalates even when they were aware of the absence.

`knows_child_whereabouts = unknown` does **not** escalate on its own. The question
often does not arise in a call where the contact clearly knew about the absence
and gave a reason, and escalating on it would fire on most ordinary calls. It is
recorded and shown on the case so staff can see it was never established.

The asymmetry is deliberate: a stated "I don't know" is evidence, a question that
never came up is not. The cost of a false alarm is a member of staff reading a
transcript; the cost of a miss is unbounded — so where evidence points at risk we
escalate on a weak signal, and where there is no evidence we do not manufacture
an alarm from its absence.

**Reachable never concludes a child is safe or accounted for.** There is no
outcome that means that. `REASON_GIVEN` means a contact stated a reason on a
phone call; a human decides what that is worth. The app's job is to get a person
in front of the right information faster, never to close the loop itself.

### 4.7 Vulnerable pupils are never called automatically

A pupil flagged vulnerable in `pupils.csv` — a child with a social worker, on a
child protection plan, or flagged by the school for any reason — produces a staff
task directly and **no call is ever placed**. The decision not to call is
`PUPIL_VULNERABLE`.

These are the cases where the right response is a named professional who knows
the family, and where an automated call could do real harm. The guidance itself
singles out prioritising vulnerable children in day-to-day attendance processes.
This is a hard gate in the policy layer, evaluated before any other guard.

---

## 5. The loop between the workflows

```text
         Workflow A: contact check
        (scheduled, once a term)
                    │
                    │ keeps the cascade order reliable
                    ▼
    ┌──────── contact health ────────┐
    │   VERIFIED / WRONG_PERSON /    │
    │   NUMBER_NOT_WORKING / ...     │
    └────────────────────────────────┘
                    ▲
                    │ every failed pattern call flags a contact
                    │
         Workflow B: pattern follow-up
          (triggered by the register)
```

The two directions:

- **A → B.** The contact check keeps the cascade order worth following. A school
  that has run it knows contact 1 answered last term, so starting there is not a
  guess.
- **B → A.** Every pattern call is a live test of the data. A `WRONG_PERSON` or
  `NUMBER_NOT_WORKING` during a follow-up is written into contact health at once,
  without waiting for next term's check, and appears in the next suggested-changes
  export.

This is the part that makes Reachable one app rather than two scripts. The
contact list is not a static input to absence calling — it is maintained *by* the
absence calling, and the absence calling is only as good as the list.

---

## 6. CSV input

Input is CSV export files. This matches how school management information systems
actually let an office get data out, and it means Reachable needs no integration,
no vendor approval, and no credentials for the school's systems.
**There is no live link to any management information system.**

All files are UTF-8, comma-separated, with a header row. Import is validated and
rejected as a whole on structural error — a partial import of a contact list is
worse than none.

### 6.1 `pupils.csv`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `pupil_id` | string | yes | The school's own identifier. Stable across imports |
| `first_name` | string | yes | **The only name ever spoken on a call** |
| `last_name` | string | yes | Never spoken; used in staff views only |
| `year_group` | string | no | Staff views only |
| `form_group` | string | no | Staff views only |
| `vulnerable_flag` | `Y`/`N` | yes | `Y` means never call automatically. Anything not exactly `N` is treated as `Y` |
| `notes_for_staff` | string | no | Never spoken; shown on the staff task |

### 6.2 `contacts.csv`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `contact_id` | string | yes | The school's own identifier |
| `pupil_id` | string | yes | Must match a row in `pupils.csv` |
| `contact_order` | integer | yes | 1 = try first. The cascade follows this exactly |
| `contact_name` | string | yes | The named person whose identity is confirmed |
| `relationship` | string | no | Staff views only |
| `phone_e164` | string | yes | Must pass strict ASCII E.164. Rejected, never repaired |
| `language` | string | no | BCP 47 or plain English name. Anything other than English routes to a human |
| `is_emergency_contact` | `Y`/`N` | yes | Only `Y` rows are called |
| `do_not_call` | `Y`/`N` | no | `Y` suppresses permanently |

### 6.3 `register.csv`

One row per pupil per session.

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `pupil_id` | string | yes | |
| `date` | `YYYY-MM-DD` | yes | |
| `session` | `AM`/`PM` | yes | The two statutory sessions |
| `code` | string | yes | Single-letter national code. `N` is the trigger code |
| `reason_recorded` | string | no | If non-empty, a reason now exists and the trigger is void |

### 6.4 `school_calendar.csv`

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `date` | `YYYY-MM-DD` | yes | |
| `day_type` | `SCHOOL_DAY`/`HOLIDAY`/`WEEKEND`/`INSET` | yes | Only `SCHOOL_DAY` counts |
| `note` | string | no | |

A date absent from this file is **not** assumed to be a school day. Missing
calendar coverage for a date in the register is an import error. Guessing which
days are school days from the day of the week would be wrong every half-term.

### 6.5 The fixture cast

One fictional school, used by every fixture, scenario, worked example and demo.
Nothing here is a real school, a real child or a real number. Every number is in
Ofcom's reserved drama range `+447700900000`–`+447700900999`, which is never
allocated to a subscriber.

**Fernhollow Primary School**, `Europe/London`, calling window 09:00–16:00,
first-day process recorded as "office calls home before 10:00 on the first
morning of any unexplained absence".

| Pupil | First name spoken | Vulnerable | Role in the demo |
| --- | --- | --- | --- |
| `P-1041` | **Ivy** | N | The main case: two unexplained sessions, cascade of three |
| `P-1177` | **Sam** | N | The escalation case (worked example D) |
| `P-1203` | **Dylan** | **Y** | Never called; goes straight to a staff task |

Ivy's contacts, in the school's own `contact_order`:

| Order | `contact_id` | Name | Number | Fate |
| --- | --- | --- | --- | --- |
| 1 | `C-2089` | Daniel Fry | `+447700900377` | Number has changed hands — wrong person, flagged |
| 2 | `C-2090` | Martin Dunn | `+447700900218` | Answers: illness, plus a bus-fare barrier |
| 3 | `C-2088` | Janet Okoro | `+447700900142` | Verified in the termly contact check; never reached in the cascade, which stops at Martin |

Sam's contact: `C-2301`, Paul Adeyemi, `+447700900455` — the contact who did not
know Sam was absent.

Surnames appear in this table and in staff views. **They are never spoken on a
call**: only the first name, and only after identity is confirmed
([`SAFETY.md` §2.2](SAFETY.md#22-minimal-disclosure)).

### 6.6 `school.csv`

Single row.

| Column | Required | Notes |
| --- | --- | --- |
| `school_name` | yes | Spoken in the disclosure line |
| `timezone` | yes | IANA name, e.g. `Europe/London`. Never inferred |
| `call_window_start` / `call_window_end` | yes | Local clock times |
| `first_day_process_description` | **yes** | Must be non-empty. Workflow B refuses to run otherwise |
| `attendance_officer_name` | no | Named when offering a call back |
| `dsl_name` | no | Staff views only |

---

## 7. Session counting

The rule in full, because it is the thing most likely to be implemented subtly
wrong:

1. Take the register rows for one pupil. Sort by (`date`, `session`) with `AM`
   before `PM`.
2. Drop every row whose `date` is not a `SCHOOL_DAY` in the calendar. If a
   register row has a date with no calendar entry, **fail the import**.
3. Walk the resulting sequence. Two sessions are **consecutive** if they are
   adjacent in it — which gives AM→PM on one day, and PM→next school day's AM,
   with weekends, holidays and INSET days closed over transparently.
4. A run of `REACHABLE_TRIGGER_SESSIONS` adjacent sessions all coded `N`, with
   `reason_recorded` empty throughout, fires the trigger.
5. The trigger date is the date of the **last** session in the run.
6. If any session in the run gains a `reason_recorded` in a later import, the
   trigger is void — decision `REASON_NOW_RECORDED`.

The 5-school-day deadline for amending a code N record is computed on the same
calendar. The dashboard shows it as a **date**, not a countdown, and names the
rule — the statutory unit is school days, though the guidance is internally
inconsistent about this ([`SOURCES.md` C2](SOURCES.md#c2-the-deadline-is-5-school-days-and-the-guidance-contradicts-itself)).

---

## 8. Scope

### In scope

- CSV import of pupils, contacts, register and calendar
- Both workflows and the loop between them
- The office dashboard
- CSV export of suggested contact changes
- A fake CALL-E server and replay scenarios, so every test runs with no network

### Out of scope

Each was considered and cut deliberately.

| Out of scope | Why |
| --- | --- |
| A live link to school management information systems | Vendor-specific, credential-heavy, and unnecessary: CSV export is universal |
| Writing to the register | Reachable suggests; only staff record official attendance codes |
| First-day calling | The school's own process. Reachable requires it to exist and adds to it |
| Lesson-level (in-session) absence | A child missing from a lesson while on site is an immediate on-site matter for staff, not a phone call to a parent |
| SMS and email | A different consent and deliverability problem, and neither establishes identity |
| Inbound calls | Reachable only places calls that pass its guards |
| Languages other than English on UK lines | CALL-E lists English only for GB ([`SOURCES.md` §2.8](SOURCES.md#28-united-kingdom-region-line-and-language)). Other languages route to a human |
| Multi-school tenancy | One school per deployment |
| User accounts beyond a single admin token | Loopback-bound single-operator app |

---

## 9. Configuration

Environment variables. Secrets are read from the process environment only, never
from a file in the repository, never logged, never rendered.

### Required for live operation

| Variable | Purpose |
| --- | --- |
| `CALLE_API_KEY` | CALL-E bearer token. Server-side only |
| `REACHABLE_DATA_DIR` | Directory holding the five CSV files |

### Safety switches, all default-off

| Variable | Default | Effect |
| --- | --- | --- |
| `REACHABLE_LIVE_CALLS` | unset | Without `1`, **no call is ever placed**. Calls are rendered, stored and shown as previews |

`REACHABLE_LIVE_CALLS=1` is necessary and **not sufficient**: every individual
call also needs a typed confirmation in the CLI or a confirm step in the
dashboard. See [`SAFETY.md`](SAFETY.md).

### Behaviour

| Variable | Default | Purpose |
| --- | --- | --- |
| `REACHABLE_TRIGGER_SESSIONS` | `2` | Consecutive code-N sessions that fire Workflow B |
| `REACHABLE_MAX_ATTEMPTS` | `2` | Attempts per contact per trigger |
| `REACHABLE_CASCADE_LIMIT` | `4` | Contacts tried per pupil per trigger |
| `REACHABLE_CONFIDENCE_FLOOR` | `0.6` | Minimum `completion_confidence.score`. Configurable because CALL-E publishes no threshold |
| `REACHABLE_TRANSCRIPT_RETENTION_DAYS` | `14` | Short by default. After this, transcripts are deleted and the outcome remains |
| `REACHABLE_CALLE_TIMEOUT_SECONDS` | `60` | Well above provider acceptance latency, on purpose |
| `REACHABLE_TERM_ID` | current term | Part of the contact-check idempotency key |

The calling window and timezone come from `school.csv`, not from the environment,
because they are properties of the school rather than of the deployment.

### Local and test

| Variable | Purpose |
| --- | --- |
| `REACHABLE_CALLE_BASE_URL` | Must be the official origin or a loopback fake. Any other value is **refused at startup** — see [`SAFETY.md`](SAFETY.md) requirement 1 |
| `REACHABLE_DB` | SQLite path. Defaults to a gitignored local path |
| `REACHABLE_ADMIN_TOKEN` | Single admin token for the dashboard |

---

## 10. Dashboard

Server-rendered Jinja2 on FastAPI, bound to loopback. Six views.

**Today** — the landing page. Two counts that matter: open `URGENT_HUMAN` cases,
and cases approaching their code-N amendment deadline. Nothing else competes.

**Contact health** — every contact, its last verification, and its current state.
Sortable by pupil. This is where a `WRONG_PERSON` found during a pattern call
appears within seconds of the call ending.

**Pupils and triggers** — pupils with an open trigger, the sessions that caused
it, the cascade position, and the deadline date.

**Case detail** — one trigger: the sessions, the cascade with each contact's
result, the guards with their current answers, the sanitised transcript, and the
suggested register reason awaiting approval.

**Staff tasks** — everything needing a person: `URGENT_HUMAN` first and visually
separated, then `UPDATE_REQUESTED`, `SUPPORT_REQUESTED`, vulnerable-pupil tasks,
and `NEEDS_HUMAN`.

**Decisions not to call** — every refusal with its named reason. A refusal is a
result, and this view is the clearest evidence that the guards are real.

**Call preview** is not a view but a step: the fully rendered task text, the
result schema, the masked destination, and the idempotency key that will be
reserved. It is the only place a live call can be started.

---

## 11. Honest limits

- Reachable establishes what a person said on a telephone. It does not establish
  that the person is who they said, beyond their own confirmation, and it never
  establishes that a child is safe.
- A suggested register reason is a suggestion. Only staff record attendance codes.
- The contact-health view reflects the last time a number was tried. A number
  verified in September can be dead in October, which is why the pattern workflow
  writes back.
- English only on UK lines is a real limitation for a real population of
  families, and Reachable surfaces those contacts rather than quietly skipping
  them.
- Nothing here is legal advice. The calling window, the retention period and the
  call wording are product defaults. A real deployment needs the school, as data
  controller, to complete its own data protection impact assessment.
