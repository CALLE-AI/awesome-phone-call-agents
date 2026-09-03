# RingBack

**Calling campaigns that turn an empty appointment slot back into revenue — built on
the CALL-E phone agent.**

For a solo professional, a no-show is an empty chair and a day's income gone. A
cancellation is worse: somebody on the waiting list would gladly take the slot, but
calling twelve people one by one, between two clients, never happens. RingBack makes
those calls, one situation at a time, and brings back structured answers that update
the appointment book by themselves.

> ⚠️ **Simulation is the default. No real call can leave this machine until three
> independent locks are opened** — see [Safety and operations](#safety-and-operations).

Python 3.12, standard library only. No framework, no `pip install`, no CDN, no
telemetry. The only four binary files are two page backgrounds — one per theme —
and the site icon in two sizes, and **RingBack serves them itself** from a
whitelisted route: nothing is ever fetched from the internet.

---

## Quick start

```
python lancer_serveur.py               # web UI on http://127.0.0.1:8770
python -m unittest discover -s tests   # 1202 unit tests
python banc_essai.py                   # end-to-end bench + readable report
```

**On the very first run, a guided setup opens.** It asks for nothing extra —
it walks you through the same settings the ⚙ Settings page holds, one page at
a time, in an order that makes sense: who you are, when calls are allowed,
what the agent says for each kind of campaign, and your opening hours. Each
part carries a red ✗ until it is done and a green ✓ once it is. You can leave
it for later, and reopen it any time from ⚙ Settings.

On Windows, three double-clickable launchers do the same: `run.cmd`, `test.cmd`,
`banc-essai.cmd`. They only look for a Python interpreter — set `RINGBACK_PYTHON` to
point at yours, otherwise the `python` on your `PATH` is used.

The database is created on first run at `donnees/ringback.db`, with demonstration
data inserted only if it is empty. Delete that file to start from scratch. An
existing database is migrated **additively**: tables and columns are added, never
rewritten, never dropped.

### Language — French and English

The product is written in French: it targets French solo professionals, and the calls
themselves are placed in French (`locale: "fr-FR"`). **The interface also speaks
English**, so a reviewer can drive it without reading French: an **EN / FR** button sits
in the banner of every page, next to the light/dark switch. It is a real form — it works
with JavaScript disabled — and it returns you to the page you were on.

Measured on 98 crawled pages (6.4 MB of HTML):

| what is counted | coverage |
|---|---|
| **actual text** (anything with two letters in a row) | **96.6 %** |
| distinct phrases, symbols included | 93.9 % |
| every phrase occurrence, symbols included | 84.3 % |

The first line is the honest one. The other two are dragged down by 728 one-letter grid
markers (`f` for *fermé*) that are hidden from sight and doubled by a `title` which
*is* translated — counting them costs 28 points and hides nothing. What genuinely stays
French is not interface text: contact names, appointment reasons, file names,
environment variables, the product's own name.

Run `python outils/recolter_phrases.py` to reproduce all three numbers — it crawls the
running product and reports the coverage itself, so the figure in this README can never
drift away from the code.

**How it is done, and why it is worth a paragraph.** The screens are 15 440 lines of
hand-written f-strings across 238 functions, with no template engine — there was no
single place to hang a dictionary, and threading one through 238 functions is exactly
the kind of sweep that breaks a working product. So the page is translated **once it is
finished**, at the two lines where all HTML becomes bytes. Three consequences:

- **In French, nothing happens at all.** `traduire(page, "fr")` returns the object it
  was given; the French product is not traversed, so it cannot regress. A test asserts
  this with `is`, not `==`.
- Phrases assembled at run time are covered — a source-string extractor would never see
  them.
- Nothing is written to the database. Statuses stored in French stay French: translating
  stored data would corrupt it.

Only phrases present in the dictionary — or matched by one of its seven rules — are
translated. **Anything unknown stays in French**, on purpose: on screens that trigger
real phone calls, a wrong translation is worse than an untranslated one.

The rules exist because half the phrases carry a date: `dimanche 06/09 10h00 — hors
horaires d'ouverture`. Spelled out one by one, 804 entries would have stopped matching
the next day and the translation would have quietly decayed. Seven rules let the data
through and translate only the words around it.

**The briefing sent to the phone agent follows too** — and that matters here more than
anywhere else, because on a CALL-E hackathon what is sent to the agent *is* what is
being judged. Switch to English and the whole task changes language: the opening spoken
word for word, the objective, the facts, the step-by-step conduct, the rules, the three
closed outcomes. Measured by building the same briefing in both languages and comparing
it line by line — 5 natures × 32 option combinations × 2 result schemas, **11 744 lines,
100 % translated**.

Four things move with it, and each would be a real defect on its own:

- **The voice.** `region` / `locale` go from `FR` / `fr-FR` to `GB` / `en-GB`, and they
  are re-read at each call departure. An English briefing read by a French voice would
  be worse than leaving everything in French.
- **The dates spoken aloud.** `Monday 24 August 2026 at 2:30 pm`, not
  `lundi 24 août 2026 à 14 heures 30` — including dates embedded in the facts.
- **The titles.** `M.` is expanded to `monsieur` in French because the agent mis-read
  the abbreviation. In English nothing is expanded: `Mr Smith` reads perfectly, and
  *monsieur Smith* would be plain wrong.
- **The reply.** The date reader understands English answers — `August 25, 2026 9:00 AM`,
  `2:30 pm` — so an appointment agreed in English lands in the diary instead of falling
  to "a human must call back".

**What never gets translated, on purpose:** a briefing you rewrote by hand. It belongs
to whoever wrote it, and translating it would put a sentence nobody proof-read into a
real phone call.

> **Redirect number:** the test-redirect and declared-tester numbers accept **any
> international dialling code** (`+44 20 7946 0958`, `+1 212 555 0198`), so a reviewer
> anywhere can send every call to their own phone. Contact numbers stay French — those
> are the numbers the product *dials*, and a looser check there would let typos through
> instead of stopping them.

---

### Loading the demo data set — the fastest way in

**A reviewer with an empty database sees an empty product.** One click fills it:

> ⚙ **Settings** → 🧪 **Trials** → **Test data** → **Load the test data set…**

It adds **75 contacts and 112 appointments** from a fictional physiotherapy
practice: past and upcoming appointments, missed ones, cancelled ones, moved
ones, 🚫 do-not-call contacts, contacts with no number, and appointments longer
than one slot. Every situation the product handles is already in there, so
campaigns have something to chew on from the first minute.

Three things make it safe to press:

- **Additive** — nothing of yours is touched, and loading twice doubles nothing.
- **Reversible** — every record it creates is flagged 🧪, and *Remove the test
  data set* deletes only those.
- **Unreachable numbers** — they come from the six ranges the French regulator
  (Arcep) reserves for fiction. They are assigned to nobody and cannot ring.

The same screen also generates a **sample diary file** (`.ics`) built from the
same cast, to exercise the import.

> **In English, the cast is English.** Switch the interface to EN *before*
> loading, and the same set arrives with British names and physiotherapy
> reasons in English — same 75 contacts, same 112 appointments, same
> structure down to the two deliberate homonyms and the two records without a
> number. It is the same test bench with a different cast, not a different
> bench. Already loaded it in French? *Remove* it, switch language, load again.

---

## Safety and operations

*The five things this repository asks every call-placing app to document.*

### Setup

1. Install Python 3.12 or newer. Nothing else is required.
2. Run `python lancer_serveur.py` and open `http://127.0.0.1:8770`.
3. That's it — you are in simulation mode and can explore everything.

The **first run opens a guided setup**, and its very first page is *Connecting to
CALL-E*: paste your key there, or skip it and keep exploring in simulation.

To place **real** calls you additionally need a CALL-E account and API key, plus the
three deliberate gestures described under *Dry-run* below.

> ⚠ **Register that CALL-E account with a Google address.** As of 3 September
> 2026 CALL-E has disabled API access for accounts registered with non-Google
> e-mail addresses — a temporary measure after attacks on their service. With
> such an account **every call returns `403 forbidden`**, whatever you do here.
> See *If every call comes back `403 forbidden`* below. Simulation is
> unaffected: the whole product, demo data included, runs with no key at all.

Files written by the application, all under `donnees/`:

| File | What it holds |
|---|---|
| `ringback.db` | clients, appointments, campaigns, calls, follow-ups (SQLite) |
| `preferences.json` | settings: company name, calling window, follow-up delay and ceiling, real-call timeouts, declared testers, test-number redirect |
| `cle_calle.txt` | your CALL-E API key, **only if** you chose to store it from ⚙ Settings (see *Credential handling*) |
| `audit_appels_reels.jsonl` | one line per **real** call: timestamp, **masked** number, status |

### Dry-run and preview behaviour

**Dry-run is the default and cannot be left by accident.** With no configuration at
all, the call client is a simulator: no network access whatsoever, scripted plausible
conversations, fictional numbers, and results that conform to the very same schema the
real API is asked to enforce. A banner on every page states it.

Leaving simulation requires **three independent gestures**, none of which can be
performed from the web interface:

1. supply the API key — the `CALLE_API_KEY` environment variable, or ⚙ Settings →
   🔌 CALL-E (see *Credential handling*);
2. start with `python lancer_serveur.py --appels-reels` (this is what sets
   `dry_run=False`);
3. type exactly `APPELER` at the keyboard prompt — **asked again at every launch and
   never remembered**.

Miss any one of the three and the server stays in simulation, silently and safely.

Beyond that, **nothing is ever launched without an explicit human gesture**:

- a campaign is *prepared*, then started by a button — clicking a slot in the planner
  or a filter in the client list only pre-fills a campaign, it never dials;
- due follow-ups are listed and wait for "run the due follow-ups" to be pressed;
- before a run, every queued call can be cancelled individually;
- starting a campaign first shows a preview of the exact message the agent will read,
  and the count of people it will call.

### If every call comes back `403 forbidden` — read this first

If real calls fail with:

```
403 {"error":{"code":"forbidden","message":"This account is not allowed to access CALL-E."}}
```

**your key is fine and RingBack is fine — it is the CALL-E account that is
refused.** The two codes mean different things, and it is worth knowing which
you are looking at:

| response | what it means |
|---|---|
| `401 Invalid or missing API key` | the **key**: absent, mistyped, or revoked |
| `403 This account is not allowed…` | the **account**: the key authenticated, then was refused |

A `403` therefore *proves* the key was recognised. Re-pasting it or creating a
new one cannot help.

⚠ **One known cause, current as of 3 September 2026.** CALL-E told us: *"CALL-E
has recently been targeted by attacks. As a temporary security measure, we
disabled CALL-E access for accounts registered with non-Google email
addresses."* If you registered your CALL-E account with anything other than a
Google address, **every call will return 403** until that measure is lifted —
whatever you do in RingBack. Register with a Google address, or ask CALL-E.

Everything else in RingBack still works with no key at all: the whole product
runs in **simulation** by default, with a full demo data set (⚙ Settings →
Trial → *Load the demo data*). You can evaluate every screen, every campaign
type and the cascade without ever placing a real call.

### Credential handling

The API key can be supplied in **two** ways, and the environment variable always wins:

1. the `CALLE_API_KEY` **environment variable** — nothing is written to disk;
2. **⚙ Settings → 🔌 CALL-E**, which stores it in `donnees/cle_calle.txt`, created with
   owner-only permissions where the operating system honours them (Windows ignores
   POSIX modes — the page says so).

*Requiring the environment variable alone was a wall for a solo professional, which
made the product unusable in practice. Storing the key is the one property we traded
away; the folder already holds your contacts' names and phone numbers, which GDPR
treats as more sensitive than an API key.*

Everything that actually protects the key is unchanged:

- The key is **never displayed**, not even to its owner — it is *described*
  ("23 characters, looks like a web address"), never echoed back into the input field,
  and **never sent to the browser**.
- It is **never logged**, and **never quoted in an error message** — a refusal
  describes it instead. Asserted in the test suite.
- Its **shape is validated before it is stored** and before any connection: a web
  address pasted instead of a key, stray quotes, an inner space, a too-short string are
  all refused with the reason. Surrounding whitespace is tolerated and trimmed — people
  paste from email.
- **Storing a key authorises nothing.** The three locks are untouched: you still have to
  start with `--appels-reels` and type `APPELER`. The Settings page holds the key and
  nothing else; the steps — account, dashboard, key, then the real-mode launch — live in
  a folded *how do I get one?* beside the field, so the screen states one thing at a
  time.
- The API base URL is configurable with `CALLE_API_URL` (default
  `https://api.heycall-e.com`).
- No other credential exists. The application has no account, no login, no session.

### Side effects

Two kinds of side effect can reach the outside world, and only two:

| Side effect | When | How to prevent it |
|---|---|---|
| **A real phone call is placed** (`POST /v1/calls`) | only when the three locks above are open, and only from an explicit human gesture | leave any one lock closed |
| **A pending result is read** (`GET /v1/calls/{id}`) | only from the "fetch pending results" button | do not press it — it dials nothing and can only read |

Everything else is local: SQLite writes, the preferences file, the audit file.

Guardrails that limit those side effects:

- **Calling window.** Outside the configured window (09:00–19:00 by default), every
  launch is refused with a clear message. Follow-up due dates are counted in working
  hours only, so a follow-up asked for on Friday evening falls on Monday.
- **Do-not-call.** A flagged client is never dialled — not from a campaign, not from a
  cascade, not even when their number is pasted by hand into a list. **And the flag can
  be raised by the person themselves, during a call**: the agent reports it in a
  `do_not_call` field, RingBack writes it on their record, cancels their pending
  follow-ups, and enters a line in the change log saying when and why. The field is
  deliberately **not required** — a result where the agent omits it stays valid, so a
  new field can only add information, never pause a campaign.
- **A softer flag: "stop offering me slots".** After declining a freed slot, the agent
  asks whether the person still wants to be called when another one opens. A "no" is
  written on their record and **only** stops opportunistic slot offers — they remain
  callable about **their own** appointments. Turning down one slot never meant turning
  down every future one, and without this question their only way out was the blanket
  do-not-call.
- **The interest rule applies to follow-ups too.** A queued follow-up for a freed-slot
  campaign is dropped — no call placed — when no remaining slot is earlier than the
  person's own appointment. Calling to offer something that helps nobody is worse than
  not calling.
- **No duplicate numbers.** Two contacts sharing a number are refused, so the same
  person is never called twice in one campaign. The exception is deliberate and
  explicit: see *Real-conditions trial*.
- **Numbers are masked everywhere** — screen, logs, audit file (`+33 6 •• •• •• 42`).
  Masking is applied in one place and asserted throughout the test suite. The only
  place a number appears in clear is a CSV the user downloads themselves, which is
  generated on the fly and never written server-side; the page says so.
- **The message sent to the agent never contains a phone number.** The number travels
  only in the recipient field of the API call.

### Cancellation and rollback

The recurring workflow here is the **follow-up chain**: every call that does not
conclude schedules one. All of it can be stopped, and none of it fires on its own.

| Situation | What cancels it |
|---|---|
| A single scheduled follow-up | "Cancel" on the follow-ups page — the chain for that contact stops there |
| A follow-up that is due too soon | "Postpone" with a new deadline; the deadline of any follow-up is editable |
| Every follow-up of a campaign | Close the campaign: all its pending follow-ups are cancelled |
| A chain that never succeeds | The attempt ceiling (1 by default, configurable) abandons it — the contact stays visible as "not reached", never silently dropped |
| A cascade that has already found a taker | The slot being filled cancels the campaign's remaining follow-ups, since they would offer a slot that no longer exists |
| A queued call, before the run | "Cancel" on that call, or "empty the queue" for all of them |

Rollback of data, rather than of calls:

- An appointment moved by a call keeps its history: the old one becomes "moved", a new
  one is created, and the change log records who, when, and why.
- Emptying the missed-appointment list marks them "ignored" — reversible one by one.
- Deleting a client **always** goes through a confirmation page that spells out what
  will be lost. There is no one-click deletion anywhere in the product.

---

## Runs on your own machine, by design

RingBack is not deployed to a server, and that is a product decision rather than a
missing feature. It handles a solo professional's client list: names, phone numbers,
appointment history. That data stays on their machine, in a single SQLite file they
can copy or delete. There is no account to create, no server to trust, no subscription
to keep the data alive, and nothing to breach.

The consequence is accepted: to try it, you run it. The quick start above takes under
a minute on any machine that already has Python.

---

## What it does

### Campaigns: five situations, three steps

The home page is the campaign list. "New campaign" opens a three-step wizard:

1. **Pick the situation.** Freed slot · appointment reminder · confirmation ·
   rescheduling · booking. Each kind has its own script and its own closed set
   of outcomes — and every one of them **writes back into the appointment
   book**. That is the line, and it is deliberate: three earlier kinds were
   removed because their answers had nowhere to go.
2. **The message writes itself** from the chosen situation and the settings — and
   stays fully editable. What you read is exactly what the agent will say.
3. **Load the people** — or don't. A freed-slot campaign defaults to **automatic**:
   it holds a rule, not a list (see below). Switch to **manual** to choose the
   people yourself: paste `Name;Phone`, a CSV file, an ICS calendar (names matched
   against known clients), or straight from the planner and the client list.

A campaign gets a readable automatic name ("Créneau libéré du 03/08 11h20 — 02/08"), a
status (running / paused / finished / closed) and a progress line (called / concluded /
follow-ups). The message form opens in a **simplified mode** showing only what must be
filled; an **advanced mode** exposes the rest.

### The first-yes cascade

A slot frees up at 11:20. RingBack calls the waiting list **one person at a time, in
order**. The first person who says yes gets the slot, and the cascade **stops dead**:
everyone below is marked *spared — never called*. A dial counter in the test suite
proves those numbers were never composed.

- A refusal or an unanswered ring moves to the next person.
- Someone who wants **another date** gets an appointment at their date, while the hunt
  for a taker of the original slot continues.
- If the list runs out with no taker, the page says so plainly instead of pretending.

### Several slots, one campaign

A morning cancels: four holes, not one. A *freed slot* campaign therefore carries a
**list of places**, added one by one with `+`, or by **dragging across the planner**.
The campaign fills them **in chronological order**: when a place is taken, the cursor
moves to the next one, the opening message is **rebuilt on that date**, and the calls
continue with the people who are left. A campaign holding a **single** place behaves
exactly as before — that path was left untouched.

- **Up to three places are offered in the same call.** They are numbered in the
  briefing, and the agent writes the one that was retained into `new_datetime`.
  A date that is **not among those announced** is never booked: nothing is written,
  and the contact is flagged *to be called back by a human*, with what was said on the
  phone kept in full. No appointment is ever guessed.
- Accepting **moves** the caller's own appointment instead of cancelling it: the old
  one becomes *displaced*, the new one is created, and the change log holds **one**
  line — a move, not a deletion followed by an addition.
- The place the caller **leaves** joins the same campaign's list, so a single freed
  slot can unwind a whole chain.
- The call order defaults to **furthest appointment first** — the people who gain the
  most from an earlier date.

**A place only reaches someone it actually helps.** One rule, applied both when the
list is built and before each call:

- someone with **no upcoming appointment** — cancelled, missed, displaced and never
  rebooked — is interested in **any** free place; their last date is in the past by
  definition and says nothing about what they want now;
- someone who **still has an appointment** is only called for a place **earlier** than
  theirs. Offering a later one would be offering a delay.

That second half is why the "how far past the place" window exists — and why it applies
to upcoming appointments only. Whoever a place cannot help is **spared with the reason
in plain words**, never called and never left hanging as "to call".

The waiting list can be built from your own book — cancelled appointments, displaced
clients still waiting, *cancelled, missed and pending* (displaced with no new
appointment), or every client — ordered furthest-first, soonest-first,
closest-to-the-slot, or alphabetically. **No order is ever imposed**: on first use no
option is preselected, and afterwards only *your* last choice is remembered. The
generated list lands in the paste zone, editable and reorderable by hand before launch.

In **automatic** mode — the default — the campaign holds no fixed list at all: it
holds a **rule** (which appointments, how far past the place to look, and in which
order to call), played at creation and **replayed at every change of place** — so the
place on the 12th reaches the people it actually interests, and the place on the 30th
reaches others. The window always starts **at the place**, never at an absolute date,
which is what makes the rule replayable. Replaying only ever **adds**: nobody already
called loses their history. When the rule finds nobody, the campaign page **says so**
and says why, rather than showing an empty list that looks like a forgotten step.

**Whoever the window leaves out is counted and named**, on the campaign's own page:
*"list built by the rule: 3 people kept. 11 people left out: their appointment is not
after this place — bringing it forward would gain them nothing."* A count on its own
reads like a bug; a count with its reason reads like a decision.

**A ceiling on how many people to load.** One field beside the call order: *at most N
people*. It caps what comes **in** and never trims what is already there — a row typed by
hand is not removed by a ceiling set afterwards, though it does occupy one of the N. And
it keeps the **most relevant**, not the first found: the chosen call order is applied
before cutting, so a freed-slot campaign keeps the people whose appointment is furthest
away rather than whoever the database returned first. In automatic mode the ceiling holds
**across places** — counting only new arrivals would have let N more people in at every
change of place.

### Scheduled follow-ups

Every unsuccessful call — no answer, technical failure, "wants to move but no date
agreed" (`to_reschedule`), refusal to requalify — schedules a **follow-up that keeps
its campaign's script and settings**.

- The default delay (4 hours) is counted in **working hours**: inside the calling
  window, outside forbidden periods, on open days of the working week, never on a day
  declared closed.
- Each deadline is editable; attempts are counted against a ceiling (1 by default).
- The follow-ups page groups them by kind — due, upcoming, blocked at the ceiling,
  waiting for a human, already handled — each with its own count.
- **Follow-ups never fire on their own.** A human presses "run the due follow-ups",
  behind exactly the same locks as any other call.
- A follow-up that concludes closes the chain.

### The planner is a launch pad

The week planner shows the appointment book in fifteen-minute rows.

- Click a **free slot** → "create a *freed slot* campaign on this place", with the
  wizard opening at step 2, slot already filled in.
- Click an **appointment** → its two gestures: **move it** (a rescheduling campaign on
  that appointment, contact already loaded) or **cancel it**.
- "Cancel" **announces first** what it is about to do, and writes nothing until you
  confirm: a **past** appointment becomes *cancelled* (that is history); a **future**
  one is *deleted* and **its place becomes free again**.
- When a cancellation happens **during a call**, and there is more than 12 hours
  (configurable) before the slot, the appointment is deleted and the campaign summary
  **offers** a "freed slot" campaign to refill it. Below the threshold it says plainly
  that it is too late to organise a replacement automatically.
- A "create a recall campaign" button in the week header covers the whole week, or the
  days you choose.
- **Drag across the grid** to select a **rectangle** of days × hours — Monday to
  Wednesday, 09:00 to 10:15 — and a panel opens *beside the selection* saying how many
  free places and how many appointments it holds, in words, before offering anything.
  **Ctrl + drag** adds another zone without opening the panel; it opens when Ctrl is
  released. Overlapping zones never count the same place twice.
- Without JavaScript, or on a phone where there is no drag, the same choice is a form
  **folded behind one line** — *Saisie manuelle des créneaux*: from which day, to which
  day, from which hour, to which hour. The last cell is **included**, exactly as the
  drag treats it. The fold is a plain `details` element, so it opens **without any
  script** — which is the whole point, since the device that needs the form is the one
  where dragging is missing.

**No call is ever placed by any of these clicks.** They prepare; a human starts.

The page holds **the planner and almost nothing else** — one folded line for the manual
range entry, plus one line under the grid:
*＋ Import your agenda* (a window offering the CSV and the ICS import) and a link to
*All appointments*. Three lists that used to sit below it were removed on the owner's
request: the missed ones, the *contact by hand* table, and *upcoming appointments*.
What they showed is a click away — the follow-ups page carries the people waiting for a
human call, and *All appointments* carries every appointment with its state and the
campaign that obtained it.

### The client list is a launch pad too

The clients page lists everyone with their conversation state. Filter by state, and a
button appears **inside the list**: "create the *booking* campaign — 8 client(s)". The
kind is not chosen, it is **deduced from the filtered state**; if the selection mixes
states handled by different kinds, there is one button per kind, each with its own
count. A state no campaign handles gives no button but **says why**. One click opens
the wizard at step 2 with the list already filled.

### Appointments

Every appointment whose time has passed flips to "missed" automatically, on load —
including confirmed ones, so nobody vanishes between two lists. "Upcoming" shows what
still holds, planned and confirmed alike: a confirmed appointment does not disappear,
its status pill changes. Cancelled, deleted, moved and ignored ones live in "all
appointments", and the change log carries the line: who, when, the reason. An
appointment obtained by phone links back to the campaign that asked for it.

### Clients: do-not-call and safe deletion

"Do not call" is a **reversible** flag: the client is excluded from the queue, from
cascades and from generated lists, carries a 🚫 badge everywhere, and is removed from
the queue if already in it. "Delete" always goes through a confirmation page that
states exactly what will be lost — the client and all their appointments, with their
recorded calls.

### Settings and the agent's briefing

The settings page is a two-level menu:

- **Company** — name, available slots to offer, calling window, forbidden periods.
- **Working week** — open days, opening hours, days declared closed.
- **Calls** — real-call timeouts (wait for a call 600 s, polling interval 5 s, request
  timeout 30 s; simulation is never slowed), replacement threshold.
- **Follow-ups** — default delay and attempt ceiling.
- **The agent's script, per campaign kind** — the three-part briefing (see below),
  editable for each of the five kinds, with a live preview of the exact text.
- **Behaviour options, per campaign kind** — call back if unreachable and how, offer
  to free the slot, chain the cascade, what to do with an answering machine.
- **Trial testers** — see below.
- **The guided setup** — reset its first-run flag, and refreshing the home page
  brings the walkthrough back. Your settings are untouched; only the walk is
  redone.

### Imports: paste, CSV, ICS

- **Paste**: one line per person, `Name;Phone` — commas and tabs accepted, errors
  reported line by line.
- **CSV**: `name;phone;datetime;reason` (see `exemple_import.csv`). Three date formats,
  numbers with dots or spaces — all normalised. Bad lines are rejected one by one with
  their line number while the good ones still import.
- **ICS calendar** (Google Calendar, Outlook, Thunderbird — see the three example
  files): folded lines unfolded, UTC times converted, named timezones converted when
  the machine knows them, all-day events refused with a clear message, and **the end
  time read** (`DTEND`, or `DURATION` when the export writes that instead) so a
  one-hour consultation really occupies four fifteen-minute rows, rounded **up**.
  Calendars rarely carry phone numbers: imported appointments land in a "without
  number" screen with a field to complete each one, and such a client is never queued.
- **An import takes the slot it lands on.** Whatever the format, an imported
  appointment that overlaps an existing one **replaces** it: after an import, no two
  appointments overlap. Nothing is erased — the displaced appointment goes through the
  same rule as a manual removal (`horaires.decision_annulation`, one place since
  31/07): "cancelled" if its date has passed, "deleted" if it was ahead. Both free the
  slot, both stay readable in *All appointments* and on the contact's record, and the
  import report **names every appointment it displaced**. The ICS form also carries a
  *replace the whole agenda* checkbox, which empties the **upcoming** agenda first — the
  past is history and an import does not rewrite it.
- **A generated example agenda** (⚙ Settings → 🧪 Trials → *An example agenda to
  import*) is built the moment you click, **from your own opening hours**: your open
  weekdays, your slot step, your closed days skipped. Its dates start today, so it is
  correct whichever day you download it — unlike the three fixed example files, which
  age. With no opening hours configured it falls back to written ranges **and says so**:
  nobody can guess a practice's working hours.
- **It spans a hundred days, thinning out with distance.** Nearly full next week, nearly
  empty in three months — the way a real book looks. Two things follow: free places
  remain to offer **at every distance**, and the rule's *up to 90 days past the place*
  window has matter to work on. It used to stop at three weeks, which made both the
  30-day and the 90-day options indistinguishable from *no limit*. The demonstration data
  set was extended the same way, to a hundred days, for the same reason.

### Real-conditions trial

To exercise the product with **real** calls you need several identities on a few known
phones — which the no-duplicate-numbers rule forbids. The rule is not removed, it is
made **deliberate**: a "trial testers" list in the settings declares a name and a
number per tester (your own, plus anyone willing to play a part). **Only those numbers**
may appear more than once; removing a tester restores the strict rule for that number
at once. Matching is done on the nine significant digits, never on the masked text.
Contacts carrying such a number are flagged 🧪 everywhere, with the sentence saying
why — no confusion with real data is possible, and the numbers stay masked like all
the others.

A second button prepares a five-identity trial campaign in the "ready" state, one
identity per outcome to exercise, with the parts spread round-robin across the
declared testers and the screen stating who plays what and what it will cost. **It
places no call**: the three locks remain the operator's gestures.

**Or send every call to your own phone instead.** ⚙ Settings → 🧪 Trials →
**Always my number** (*Toujours mon numéro*) carries a checkbox — *always use my phone
number for real-conditions trials* — and a number field. It is its own sub-part of the
🧪 Trials tab, next to *Test data* and *Testers*: this is the single switch a reviewer
needs to try the product end to end without any patient's phone ringing. With it on, the number handed to the agent is **replaced** at the very
last moment, in the single place where a recipient is built: **no contact is ever
dialled**, your phone rings for every call of the campaign, and **the identity is
untouched** — the agent still says "Bonjour madame Duval", with her reason and her
appointment. You hear exactly the conversation that contact would have had, on your own
real data, without one real phone ringing. The redirect itself **writes nothing** to the
database (unlike testers, whose numbers are written onto records), and **no lock is
opened**: the key, `--appels-reels` and `APPELER` are all still required.

One consequence is worth stating plainly, and the screen states it: **the outcomes are
still written to the real records**. Say "yes" on the phone and *that contact's*
appointment becomes confirmed; ask for another date and it is moved. That is precisely
what makes the trial complete — but if you want nothing in your data to change, run it
on 🧪 test-data contacts rather than on your real appointments.

A redirect that went unnoticed would make a whole campaign unreadable afterwards, so it
is stated **everywhere a call departs**: a banner on every page in real mode, the
🔌 CALL-E part, the trial-campaign part, the console **before** the `APPELER` prompt,
and every audit line — which keeps the contact's **masked** number (who we meant to
reach) next to a `renvoi_essai` field saying they were not the one called. An imposed
number that is not composable **refuses the call**: it never falls back to the
contact's own number, because that is the one outcome nothing can undo.

---

## Using the real CALL-E API

The real client speaks to the CALL-E REST API directly with `urllib` — no SDK, no
dependency.

### What is sent

`POST /v1/calls` carries a **three-part briefing**, and the split is the point:

1. **the opening, spoken word for word** — who is calling, and why;
2. **the goal, the useful facts and the constraints** — and between parts 1 and 3 the
   agent is explicitly free to *converse*: answer a question, repeat a date, reassure;
3. **the closed outcomes** it must come back with, and nothing else.

Civilities are expanded when the text is built ("M." → "monsieur"), never in the
database. Every one of the five scripts ends on a **question**: a text that ends on an
explanation leaves a silence, while a question gets the answer the agent needs.

The recipient is `{phones: [E.164], region: "FR", locale: "fr-FR"}`, and two strict
schemas are imposed:

| Schema | Fields |
|---|---|
| `result_schema` / `recipient_result_schema` | `appointment_status` (`confirmed \| rescheduled \| canceled \| to_reschedule`), `new_datetime` (ISO 8601, **must be null** when nothing was agreed), `notes` |
| cascade calls | `outcome` (`accepted \| refused \| moved \| to_reschedule`), `new_datetime`, `notes` |

On cascade calls `new_datetime` is **required** for `moved` and **allowed** for
`accepted` — that is how the agent says *which* of the announced places was retained.
RingBack then checks that the date is one it actually had announced; if it is not,
nothing is booked.

`to_reschedule` means *"wants to move but no date was agreed"* — the answer a web form
cannot express. **What RingBack does with it depends on the kind of campaign**, and only
two of the five hand the person to a human:

| Campaign | What happens |
|---|---|
| Reschedule an appointment | **to be called back by a human** — there is still a date to find |
| Book an appointment | **to be called back by a human** — same reason |
| Freed slot | **refused** — the slot goes to somebody else. Their own appointment is **kept and marked confirmed**: they answered, we spoke to them, they did not cancel |
| Appointment reminder | **the client will call back** — the appointment is theirs, nothing is pending on our side, and it is left untouched |
| Confirmation | same — and the appointment stays *scheduled*: marking it *confirmed* would invent the confirmation this campaign exists to obtain |

*A human callback used to be created on all five. On a freed slot that meant calling
someone back about a slot already given away — "we wanted to ask you something, but it is
no longer relevant". The agent's briefing was changed with the behaviour: it only offers a
human callback on the two campaigns that honour one.*

`GET /v1/calls/{id}` is then polled until the call completes. **The returned result is
re-validated locally against the same schema before a single row is written**: a
malformed answer never touches the appointment book.

### When something goes wrong

Three families of failure are told apart, because they mean opposite things:

| | **The contact's** failure | **Our** failure | **The call went out, the result did not come back** |
|---|---|---|---|
| Examples | no answer, voicemail, unusable number | key refused (401/403), credit exhausted (402), rate limit (429), service down (5xx), network cut — **before** the call left | wait expired, read expired, server hung up — **after** the call left |
| Attempt counted | yes | **no** | **no** |
| The contact | "to call back", then "not reached" at the ceiling | **untouched — still "to call"** | **"called, result unknown"** — never "not reached" |
| The campaign | carries on | **pauses**, and resumes exactly as it was | **pauses**, and the contact is not re-queued |
| The message | the call's outcome | says what did **not** happen (nobody called, no credit spent) and what to do | says the call **did** happen, gives its CALL-E id, and offers to fetch its result |

A response code RingBack does not know is **not** interpreted: it says so frankly and
the failure stays local to that call. The line of truth is the creation of the call:
before it, nothing left; after it, the id is kept and the contact waits for its result.

### A call that went out is never lost

Once creation succeeds the call id is stored, and the campaign sheet shows **"fetch
pending results"**. It performs a plain `GET /v1/calls/{id}` and applies the outcome
**exactly** as if it had arrived on time — moved appointment, change log, cascade,
follow-ups, one and the same code path. If the call is still running it says so and
writes nothing.

⚠️ **This gesture dials no number.** It can only read. The three locks guard the
*creation* of calls and are not involved.

---

## Testing

**1202 unit tests**, all green:

```
python -m unittest discover -s tests
```

They cover the database layer (masking included, plus the additive migration of
pre-existing files), on-disk persistence, the missed-appointment rule, input
validation, CSV and ICS import, the campaign model for all five kinds, the follow-up
scheduler end to end, the guardrails (a dial counter proves an excluded number is never
composed, even hand-pasted), the calling window, the settings, the light/dark toggle,
the web server over **real HTTP requests** — the wizard, the follow-ups page, the
planner, three end-to-end owner scenarios — and the real client driven against a
**faithful local fake of the CALL-E API**, which proves that while the locks hold,
**zero network requests leave the machine**.

**An end-to-end bench** on top of that:

```
python banc_essai.py
```

It stands the whole product up on a **throwaway** database (port 8779) and walks a
matrix of campaign kind × entry point × call outcome — **661 checks across 121
combinations** — verifying both what is written to the database *and* what becomes
visible on screen. It runs **simulation only** (it removes `CALLE_API_KEY` from its own
process and proves it, lock by lock), **never touches** `donnees/ringback.db` (it
refuses to start if pointed at it), and produces a **byte-identical report** from one
run to the next, in `rapport-banc-essai.html` (the readable one) and
`rapport-banc-essai.txt`.

---

## Project layout

```
ringback/
  db.py             SQLite: clients (do-not-call flag), appointments, calls,
                    cascades, campaigns, campaign contacts, campaign calls,
                    follow-ups + the missed rule + ADDITIVE migration
  calle_client.py   call client: simulator (default) / real CALL-E client
                    (written, tested, locked). Result schemas, reserved-field
                    guard, failure taxonomy, masked audit trail
  consigne.py       THE BRIEFING dictated to the agent, in three parts, plus
                    civility expansion at build time
  planificateur.py  call queue + guardrails (dry-run, confirmation,
                    cancellation, do-not-call) + first-yes cascade + smart
                    rescheduling
  campagnes.py      THE MODEL: situations instantiated as campaigns, follow-up
                    scheduling (working-hour delays, editable deadlines,
                    attempt ceiling, human gesture, closed chains)
  assistant.py      the three-step wizard: kinds, scripts per kind, behaviour
                    options, expected columns, draft store
  assistant_web.py  the wizard's screens
  etats_clients.py  client conversation states and which campaign handles them
  horaires.py       working week, opening hours, closed days, forbidden
                    periods, week planner, period boundaries
  themes.py         call themes (mission templates, substituted variables) +
                    settings + the politeness guardrail
  saisie.py         input validation (name, phone, date) + CSV import + paste
                    parsing
  generation.py     waiting lists built from the database (sources, orders,
                    CSV export) + the preferences file
  ics.py            ICS calendar import (folded lines, timezones, end times)
  essai_reel.py     real-conditions trial: declared testers, trial campaign
  jeu_essai.py      demonstration data set (fictional numbers only)
  installation.py   the first-run guided setup: which parts exist, which
                    pages they hold, and what has been done
  images/           two page backgrounds (one per theme) and the site icon
                    in two sizes — served by the app itself, on a
                    whitelisted route
  serveur.py        the web UI (stdlib, port 8770): campaigns, follow-ups,
                    appointments, planner, clients, settings, guided setup,
                    light/dark
donnees/            created at runtime — see "Setup"
tests/
  test_ringback.py  the 1202 tests
banc_essai.py       the end-to-end bench
exemple_import.csv          CSV import example
exemple_agenda*.ics         three ICS calendar examples
```

---

## Simulation conventions

In simulation (tests and demonstration), the **last two digits** of a fictional number
force the outcome, so every path can be exercised deterministically:

| Ending | Behaviour |
|---|---|
| `51` | accepts / confirms |
| `52` | refuses / cancels |
| `53` | never picks up |
| `54` | asks for another date |
| `55` | wants to move but **concludes no date** (`to_reschedule`) |
| `56` | misses the first call, then accepts the follow-up |
| `57` | refuses **and** asks never to be called again (🚫) |
| `58` | refuses **and** wants no further slot offers (🔇) |
| `59` | the conversation happened, **the answer is unreadable** → goes to a human |

Any other number follows the **written case list of the campaign's kind**
(`calle_client.SUITES_PAR_NATURE`): one call, one case, in a fixed order — refusal,
report with no date agreed, another date, nobody picking up, refusal + 🚫, refusal + 🔇 —
and the outcome that **succeeds comes last**. That order is the whole point: on a
*first-yes* campaign (freed slot, reschedule) the succeeding outcome **ends the
campaign**, so putting it first meant the very first call filled the slot and no other
case was ever produced. Past the list the expected outcome takes over again — a
fifty-person campaign must not read like a catalogue of failures.

The list is **tailored to the campaign's size**: five contacts for seven cases plays four
of them, then the one that succeeds — the slot does get filled — and the *next* campaign
resumes the tour where this one left off. Two campaigns of five show all seven.
Reschedule has **two** succeeding outcomes and only one can fire per campaign; they
alternate, so two campaigns show both.

`59` is the only case a campaign never plays by itself, on purpose: it returns no result
but an exception, and the campaign is then paused. Putting it in the list would have
stopped every simulated campaign at the same call.

*Before 11/08/2026 this was a written sequence of twenty outcomes with the expected one
thirteen times — and before that, a weighted random draw. The draw never produced two of
the four outcomes at all. The sequence did produce them, but started with the expected
one: on a first-yes campaign it therefore showed a single case. Neither was a matter of
proportions — it is the **order** that decides.*

All demonstration numbers are fictional: the documented `+33 6 00 00 00 XX` series, and
the six ranges the French regulator (Arcep) reserves for fiction, which are assigned to
nobody and can neither call nor be called.
