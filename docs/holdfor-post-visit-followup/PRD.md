# HoldFor — Product Requirements

A clinic phone agent that takes the patient's turn in the queue.

| | |
| --- | --- |
| Team | Carol · Dihan · Aimee |
| Build | Wed 19 – Fri 21 Aug 2026 (3 days) |
| **Internal deadline** | **Fri 21 Aug 2026** — working, tested, end to end |
| Devpost deadline | Mon 14 Sep 2026, 11:45pm SGT |
| Call budget | 20 free test calls |
| Branch | `feat/clinic-followup-agent` |

Terms in **bold with a capital** are defined in [`CONTEXT.md`](../../CONTEXT.md).
Decisions are in [`docs/adr/`](../adr/). "HoldFor" is a working name.

## What we are building

An 82-year-old should not have to sit on hold for twenty minutes to reach her own
GP. HoldFor rings her a few days after her appointment on an ordinary phone — no
app, no menu, no hold music — and asks four questions at her pace. Bounded answers
go to practice staff. If she needs to be seen again, a named member of staff
releases the agent to ring the practice's own booking line and wait in the queue on
her behalf, carrying her exact words in.

The hold time does not disappear. It gets served to a machine instead of to her.
That is the whole product, and it is why the second call is a phone call and not a
database write — no practice grants an agent write access to appointments in EMIS or
SystmOne, and none should. See [ADR 0002](../adr/0002-rebooking-is-a-phone-call-not-a-write.md).

```text
Check-in Call ──answers──▶ Review Item ──┃──▶ Rebooking Call ──▶ Appointment
agent → Patient            on the board  ┃    agent → Reception    or back to board
      │                                  ┃           ▲
      └────── Carried Words, verbatim ───┃───────────┘
                                    RELEASE
                    named Reviewer sets the Booking Envelope
```

Nothing reaches the Rebooking Call except across the Release line, including the
quote. A **Reviewer** sees the exact string that will be spoken before it is spoken.

### Who it is for

Patients who find the telephone hardest to use — older, often living alone,
frequently without a smartphone. This overrules the 19 August minute recording a
move to "general clinic use"; see
[ADR 0004](../adr/0004-older-patients-not-the-general-public.md). For a patient who
can use the online portal, "use the portal" is a complete answer and this product
has no reason to exist.

## The rule, and the three places it bites

| Moment | Naive design | What HoldFor does |
| --- | --- | --- |
| Is this urgent? | Model grades severity. | Never assesses. Matches a closed, human-authored list of **Stop Conditions**. Pattern-match, not judgement. |
| Should we book them in? | Agent books when the patient says yes. | Never. A **Review Item** appears on the board; a named **Reviewer** releases it or closes it. |
| Is this slot acceptable? | Agent takes whatever reception offers. | Accepts only inside the **Booking Envelope** a Reviewer already set. Anything outside is refused and returned to the board. |

The third row is the one to defend. When reception says "I can do Tuesday the 26th
at ten past nine", something has to answer — so "the agent never decides" taken
literally makes the second call useless. A **Release** is therefore a bounded
authority, not a yes/no flag. See
[ADR 0003](../adr/0003-a-release-grants-a-bounded-authority.md).

```text
RELEASE by Dr Aimee Osei · 14:32
  accept in-person appointment
  between 2026-08-20 and 2026-08-29
  mornings only · any clinician
  carried words: "it's still weeping and I can't keep the dressing on"
```

### Where the human sits

This is the **human-in-the-loop** mechanism agreed on 19 August. It ended up in four
places rather than one, and the escalation Dihan proposed is only the first of them.

| Where | What kind of human-in-the-loop |
| --- | --- |
| Stop Condition → **Review Item** | The original escalation. The agent cannot resolve something, so it stops and a person gets it. Async rather than a transfer, because no transfer primitive exists — and because a transfer at 18:40 on a Friday transfers to nobody, whereas a Review Item is durable. |
| **Release** | The strong form. No Rebooking Call can *exist* without a named human authorising it. A precondition, not a fallback. |
| **Booking Envelope** | The human's decision travels *with* the agent into the second call and constrains what it may accept. The loop does not end at approval. |
| **Auto-close** | Defines where a human is *not* needed. The concept only means something if you say where it stops. |

[ADR 0005](../adr/0005-stop-conditions-are-enforced-twice.md) is what makes the first
row hold when the model misbehaves: the deterministic scan flags an item even if the
agent failed to escalate during the call. A human sees it either way.

## Call one — the Check-in Call

### The Never-Ask Rule

An unsolicited automated call to an 82-year-old is, from the receiving end,
indistinguishable from a scam. Every instinct says *verify the patient first* — and
that instinct is exactly wrong, because asking an older person to confirm their date
of birth is the most recognisable scam opening there is.

The Check-in Call asks for **nothing**: no date of birth, no address, no NHS number,
nothing resembling payment. It proves itself with a fact only the surgery holds — the
appointment date — and says the promise out loud. Identifiers reception needs are
supplied later by the Rebooking Call, never obtained from the Patient.

```text
agent   Hello — this is an automated call from Fieldgate Surgery.
        You were with us on Thursday the fourteenth. Is that Margaret?

agent   I won't ask you for any personal details or payment — we never
        do that by phone. If anyone rings and does, it isn't us.

        [ four questions, at her pace, repeated on request ]

agent   Thank you Margaret. Someone at the surgery will look at this
        today — and if they think you should come in, they'll sort the
        appointment out for you. You won't need to ring us.
```

### What she sees before we speak

The Never-Ask Rule governs what the agent says once the call is answered. It does
nothing about the two seconds before that, when all she has is a number on a screen —
and that is where the first live call on this project failed.

The call was placed to a team member's own phone. She knew it was coming, because she
had typed the command herself thirty seconds earlier. She heard a word or two and hung
up, because an unfamiliar number ringing out of nowhere reads as a scam. The platform
recorded `DECLINED`, zero duration, no transcript.

An 82-year-old has less warning than that, not more. Three things follow:

**The number is not the surgery's.** CALL-E lists Malaysia as a `Local` line region and
Indonesia as `International`, but *local* means the platform's local number, not ours.
So `"ring us back on the number that called you"` is not available to us, which is
part of why the voicemail message below carries the surgery's real number instead.

**We cannot see the caller ID.** No field in the call result reports the number the
Patient saw. It is not observable, and therefore not testable and not claimable — it
must not appear as an assertion in the pitch.

**The mitigation is not technical.** The Patient is told at the appointment: *we will
ring you on Thursday afternoon, you do not need to do anything, and we will never ask
you for details over the phone.* This is one sentence spoken by a receptionist, and it
converts an unknown caller into an expected one. It is a precondition of the product
working, not a nice-to-have, and any practice deploying this has to do it.

### The four questions

| # | Question | Field |
| --- | --- | --- |
| 1 | Since Thursday, are you feeling better, about the same, or worse? | `better \| same \| worse \| unsure` |
| 2 | Are you getting on with what they gave you? *(only when `medication_changed`)* | `yes \| no \| unsure` |
| 3 | Is there anything worrying you? | **open** → Carried Words |
| 4 | Would you like the surgery to see you again? | `yes \| no \| unsure` |

Question three is the only open one and the only source of **Carried Words**. A quote
is only genuinely hers if she was free to say anything. Extraction takes a **span from
the transcript**, never generated prose, so the Reviewer can check it against what she
actually said.

### When the call goes out

**Day 3 after the appointment, weekdays, 10:00–16:00 local.** Day 3 because 48–72
hours is when a post-procedure problem actually shows. 10:00 because before that she
may still be getting up; 16:00 because after that she is tired and the surgery is
closing, so a flagged item would sit unread overnight.

The window is a **Reading Window**, not a convenience window: *no Check-in Call is
placed unless a Reviewer will be there to catch what comes back the same day.* A call
whose result nobody can read should not be made. Weekends are excluded for the same
reason, and a day-3 date landing on a weekend shifts to the next weekday.

### When she does not answer, and when she refuses

One attempt. Never two — and the board records *which* of these happened, because they
mean opposite things to the practice.

| What happened | Status | What the Practice should read into it |
| --- | --- | --- |
| Answered, then hung up | `declined` | She does not want these calls. |
| Nobody picked up, or voicemail | `not_reached` | She has not been reached yet. |

The call platform collapses both into a retry offer — it proposed ringing back in
forty-five minutes after the refusal described above. We suppress that, because the
agent has just promised out loud that hanging up ends the calls for good.
[`ADR 0006`](../adr/0006-a-refusal-is-not-a-missed-call.md) records why, and
`holdfor/outcomes.py` is the only place the mapping lives.

A refusal is also not a Stop Condition: there are no answers to map and no red-flag
phrase to match. A Patient who answers and *cannot be understood* does raise one. On
the board those look different, deliberately.

If an answering machine picks up, the agent leaves one fixed message.

```text
"This is Fieldgate Surgery. There's nothing to worry about — we were
 just ringing to see how you're getting on. You don't need to ring us
 back; someone here will try you again. If you do want us, we're on
 01632 960 118."
```

Leaving nothing looks safer and isn't: an unexplained missed call makes an anxious
person living alone ring the surgery back — straight into the queue this exists to
keep her out of. So the message's real job is to *prevent* a callback. It carries no
clinical content, no surname and no date of birth, in case a carer or neighbour hears
it.

The number is not optional. [`apps/typescript/verify-contact-claim/docs/limits.md`](../../apps/typescript/verify-contact-claim/docs/limits.md)
records that an artificial voice message must state a telephone number for the
responsible party (47 CFR 64.1200(b)(2), US); Ofcom's persistent-misuse guidance
carries an equivalent expectation in the UK. **Confirm the UK position before
submission** — we have the shape of the rule, not a verified citation.

### Stop Conditions

The call ends immediately on any of:

- a phrase on the red-flag list
- an answer that cannot be mapped to a bounded field
- repeated confusion or a repeated non-answer
- a third party on the line
- the Patient asks the agent a clinical question

Then, and only then, the **Safety Line** — one fixed sentence, never improvised:

```text
"I'm going to stop there and pass this to someone at the surgery.
 If you're worried right now, please ring 111 — or 999 if it's an emergency."
```

### The list is not ours

The red-flag list is lifted from published NHS/NICE post-procedure safety-netting
advice, kept to about ten items, and cited in `references/red-flags.md`. We do not
write it. [`apps/python/sentinelcall-anc-followup/`](../../apps/python/sentinelcall-anc-followup/)
in this repository screens against WHO-standard obstetric danger signs for the same
reason: three people at a hackathon should not be the authors of a clinical screening
instrument.

### Enforced twice

A Stop Condition lives both in the agent's call prompt and in a deterministic scan of
the finished transcript. These are not the same check twice. **The prompt exists for
the Patient** — it is what makes the call end kindly, at the right moment, with the
Safety Line. **The scan exists for the Practice** — it is what makes "the agent never
grades severity" a property of the system rather than a request made of a model.

Where they disagree, the item is flagged. A model failure can delay or degrade a
call; it cannot produce an unflagged Review Item. See
[ADR 0005](../adr/0005-stop-conditions-are-enforced-twice.md) — and do not delete the
scan for being redundant.

**The agent never transfers.** Our premise is that the practice's line is jammed;
warm-transferring a frightened patient into the jammed line is worse than not
calling, and at 18:40 on a Friday it transfers her to nobody. It is also not
buildable — there is no transfer primitive anywhere in this repository, and CALL-E's
surface (`call plan`, `call start`, `call status`, `call transcript`) is entirely
outbound. The async Review Item is the only version that exists.

## Call two — the Rebooking Call

Only ever after a Release. Dials the practice's own booking line and waits.

```text
agent      This is the automated assistant for Fieldgate Surgery. I'm
           ringing on behalf of a patient after a check-in call.
           Margaret Wilson, date of birth 4 March 1943.

           Her words were: "it's still weeping and I can't keep the
           dressing on."

           She'd like to be seen again.

reception  I can do Tuesday the 26th at ten past nine.
agent      [inside envelope]  That's fine, thank you — please book that.

  — or —

reception  Earliest I've got is Friday the 12th of September.
agent      [outside envelope] I can't accept that one. I'll pass it back
           to the surgery. Thank you.
```

The agent quotes and stops. It never summarises and never adds "she sounds like she
needs to be seen soon". Reception hears evidence, not an agent's opinion.

### When reception refuses

Receptionists really do decline third-party bookings. When it happens the agent
thanks them and ends the call — no rephrasing, no restating the mandate, no second
attempt, no redial. The item returns to the board as `reception_declined` and a human
picks it up.

An agent that argues with a receptionist is the fastest way to get this product
banned from a practice. The refusal is also real information the practice should see.

### Menus, hold, and what we do not claim

Navigating "press 4 for appointments" is a real CALL-E capability —
[`verify-contact-claim/docs/limits.md`](../../apps/typescript/verify-contact-claim/docs/limits.md)
describes a call as "queue it, dial it, wait for somebody to pick up, **get through a
menu**, ask the question then finish", and [`skills/linecanary-monitor/`](../../skills/linecanary-monitor/)
exists to walk IVR journeys.

**A twenty-minute hold is unverified.** Nothing in this repository supports it; the
same file frames a call as taking "minutes". *Do not put a number on the hold in the
pitch.* Say the agent waits so she doesn't — not that it waits twenty minutes.

### Read Scope is per-call, not per-patient

| Field | Check-in Call | Rebooking Call |
| --- | --- | --- |
| First name | yes | yes |
| Surname, date of birth | **no** | yes — reception asks |
| Appointment date and type | yes | yes |
| `medication_changed` flag | yes | no |
| Drug names, doses, diagnosis, history, notes | **never** | **never** |

## The board

Three screens, no more.

- **Queue** — Review Items newest first: first name, the four answers as chips, a flag if a Stop Condition fired.
- **Detail** — transcript alongside the extracted answers, each anchored to the turn it came from.
- **Release form** — the Booking Envelope plus the exact Carried Words, editable *down* but never up. A Reviewer may narrow what gets spoken; they may not add to it.

Three actions: **Release**, **Close**, **Ring them myself**. A Release records who,
when, and the envelope. That record is the audit trail.

### Auto-close

A Review Item closes without a human **only** when all of these hold: no Stop
Condition fired, all four answers mapped cleanly, feeling better or about the same,
and she does not want to be seen. Anything else queues.

```text
12 calls today
────────────────────────────────
 9  closed, nothing needed
 3  need you
    · Margaret W  wants to be seen
    · Alan P      feeling worse
    · Joan R      stopped early  (!)
```

That ratio is the labour saving, and it is the only number in the demo that says the
practice got something back. Note the deliberate redundancy: an unmappable answer is
both a Stop Condition *and* an auto-close blocker. Belt and braces on the one path
where being wrong is expensive.

## Data model

SQLite, seed data, not a real clinical system.

| Table | Carries |
| --- | --- |
| `patient` | first name, surname, DOB, E.164 phone, `consent_to_call` |
| `appointment` | patient, `seen_on`, type, `medication_changed`, `followup_booked` |
| `call_attempt` | kind (`checkin`/`rebooking`), CALL-E `run_id`, state, transcript ref, idempotency key |
| `review_item` | the four bounded answers, stop-condition flag, Carried Words span, status (`needs_review` / `auto_closed` / `released` / `closed` / `rang_manually` / `reception_declined` / `not_reached` / `declined`) |
| `release` | reviewer name, timestamp, Booking Envelope, approved Carried Words |

`consent_to_call` is a hard gate, checked before anything crosses the real-call
boundary. `release` is a separate table on purpose: a Rebooking Call with no row here
is a bug that should be unreachable, not a state to handle.

## What we are not building

| Cut | Why |
| --- | --- |
| Any write to the clinical record | Results land in our own store and on the board. If it belongs in the record, a Reviewer types it in. Not gated — *absent*. [ADR 0001](../adr/0001-no-agent-write-path-to-the-clinical-record.md) |
| The scheduler | Calls fire from a button on the board. Saves most of a day and sidesteps the repo's recurrence and cancellation rule surface. |
| Live transfer | No primitive exists. |
| Real EMIS / SystmOne integration | Seed data. The absence of a write path is the point, not a shortcut. |
| Personalised patient history | Agreed 19 Aug. Not a risk we take for a demo. |
| Billing | Agreed 19 Aug. |
| Retries, voicemail handling, multi-language, auth beyond one shared key | One attempt, then `not_reached`. Time. |

## The call budget

Twenty free calls is the binding constraint, not the two days. One end-to-end run of
the chain costs **two** calls.

```text
  20   free test calls
 − 8   demo video, 2 chain runs × 2 takes
 − 2   spare — no answer, bad audio
 ────
  10   left for two days of development, across three people
```

**Every number dialled belongs to someone on this team.** Patients are synthetic,
Margaret is a simulated patient played by one of us, and the practice's booking line is
Dihan's phone. No external number — no real patient, no real surgery, no stranger's
line — is dialled at any point in development or in the demo.

**We cannot develop against the live provider.** Prompt tuning alone could eat that on
Thursday morning. Everything is built behind a provider interface with a fake adapter
and fixture transcripts; live is a flag. Real calls are spent on two calibration calls
early — to hear how it lands on a real phone, which fixtures cannot tell us — and the
video.

This is also what [`AGENTS.md`](../../AGENTS.md) requires: *"Do not require live
credentials or real outbound calls for default tests."*

## Three days

Friday is the deadline. Everything below is sized to hit it.

### Wednesday 19 Aug — today

- **Carol** — fork `CALLE-AI/awesome-phone-call-agents`, repoint remotes, add Dihan and Aimee to the fork, push `feat/clinic-followup-agent`
- **Carol** — submit the request for additional call credits. It is the longest-lead item and costs five minutes
- **All** — install the `calle` CLI, `calle auth status` green, confirm push access to the fork
- **Aimee** — read this PRD; draft the four questions and pull the red-flag list from NHS safety-netting

### Thursday 20 Aug

- **Carol** — SQLite schema, seed patients and appointments, FastAPI skeleton, provider interface with fake adapter and fixture transcripts
- **Dihan** — board: queue, detail view with transcript, release form. Wired to fixtures; no live calls needed to build it
- **Aimee** — Check-in Call script, the four questions, red-flag list, result schema
- **Aimee** — *2 calibration calls, live.* The only live calls today

### Friday 21 Aug

- **Carol** — wire live CALL-E behind the same interface, both call kinds, idempotency keys
- **Dihan** — Rebooking Call script and envelope matching: accept, refuse, return to board
- **All** — *one full chain run, live, in the morning.* Not Friday night
- **Carol** — package `skills/holdfor-post-visit-followup/`, run `python3 scripts/validate_repository.py`

### Weekend 22–23 Aug

- **Aimee** — record and edit the demo video (8 calls, budgeted)
- **Carol** — README, PR against upstream `main`

### Tuesday 25 Aug

Mon 24 and Tue 25 are public holidays — **nothing may depend on work happening then.**
Done means done Friday.

> **Deadline correction.** The 19 August minute recorded the deadline as "the following
> Tuesday". Devpost gives **14 September 2026, 11:45pm SGT** — confirm the hour against
> the countdown clock.
>
> This does not change the plan. Friday remains the internal deadline and everything
> above is sized to hit it. What it changes is the failure mode: **a slip on Friday is
> now recoverable rather than fatal.** Do not spend the difference on scope. The cuts in
> *What we are not building* that were made on principle — no clinical write path, no
> live transfer, no personalisation, no billing — stay cut regardless of available time.

## Risks

| Risk | What we do |
| --- | --- |
| First true end-to-end live run fails on Friday | Run it Friday **morning**. Everything before it is provable against fixtures, so a failure is isolated to the live adapter. |
| Call budget exhausted before the video | Live calls require an explicit flag and are counted in the app. Fake adapter is the default in every test. |
| Reception improvises off-script in the demo | Expected. The refuse path is a **feature to show**, not a failure. |
| Extraction can't find a clean Carried Words span | No span, no Release. Item goes to the board flagged and a human rings instead. Never generate the quote. |
| Two public holidays | Nothing may depend on Mon or Tue. |
| Hold duration ceiling is unknown | Never state a hold length in the pitch. Demo the waiting behaviour for 20 seconds and jump-cut. |
| The simulated patient reads as an actor | Script the pacing, not the persona. Caption it "simulated patient" on screen. Never perform an elderly voice — a bad impression is worse than a flat read. |
| Someone deletes the deterministic scan as redundant | [ADR 0005](../adr/0005-stop-conditions-are-enforced-twice.md) exists precisely to stop this. |
| The Patient hangs up before the agent finishes its first sentence | **Observed, not hypothetical** — it happened on the first live call, to a team member who knew the call was coming. Mitigated outside the software: the practice tells her at the appointment that the call is coming. See [What she sees before we speak](#what-she-sees-before-we-speak). |
| The platform rings a Patient back after she refused | Suppressed in `holdfor/outcomes.py`; `may_redial()` returns `False` for every outcome. [ADR 0006](../adr/0006-a-refusal-is-not-a-missed-call.md) |
| The demo hangs up on camera for the same reason the first live call did | Brief the simulated patient to stay on the line. Do not discover this while recording. |

## The demo — three minutes

**Casting — no real person.** Margaret is a **simulated patient**, played by one of
us and captioned as simulated on screen. No real patient, no relative, no recruited
member of the public: nobody outside the team has to consent to anything, and there is
no real person's health situation on film.

Play her plainly. Script the *pacing*, not the persona — answer slowly, leave real
pauses, and ask the agent to repeat itself once. That single "sorry, say that again?"
is the beat that shows the product working, and it needs no impersonation. **Nobody
performs an elderly voice.** A flat, honest read is fine; a bad impression is worse
than either. Dihan plays reception.

1. **The problem** (0:15). Margaret is 82, had a minor procedure on Thursday, and the surgery's line has a twenty-minute wait.
2. **The Check-in Call** (0:50). Play it. Let it be slow. The Never-Ask promise is the moment that lands — it is the opposite of what a scam call does. Close on the line that tells her the surgery will sort the appointment out for her.
3. **The board** (0:30). "12 calls today · 3 need you." Her item, four answers, and her own sentence sitting there in quotes.
4. **The Release** (0:20). A named person sets the envelope. Say it out loud: *nothing has been booked, and nothing can be, until this.*
5. **The Rebooking Call** (0:50). Reception says "bear with me" and puts the handset down. **Hold on the agent waiting for twenty seconds**, then jump-cut with a caption — "…4 minutes later". That footage is the pitch; without it, queue absorption is a claim. Then the agent reads her words back. **Show the refuse path too** — an offer outside the envelope going back to the board is the whole safety argument in four seconds.
6. **The close** (0:15). The hold time didn't go away. It just wasn't served to Margaret.

## Where it lives

```text
skills/holdfor-post-visit-followup/    SKILL.md + references/ (safety, result-schema, scripts, envelope)
apps/python/holdfor-board/             FastAPI + SQLite + the board
docs/holdfor-post-visit-followup/      this PRD
CONTEXT.md                             glossary
docs/adr/                              0001–0004
```
