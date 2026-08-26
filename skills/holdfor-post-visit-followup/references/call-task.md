# The Check-in Call, word for word

The authored source of what the agent says. `build_task_text()` in
`apps/python/holdfor-board/holdfor/checkin.py` renders this; the sentences marked
**fixed** are pinned by a test, because they are the ones that carry a promise.

Terms in bold with a capital are defined in `CONTEXT.md`.

**No dashes, no brackets, no typography in anything spoken.** Every line in a fenced
block here is read aloud by a speech engine, and punctuation it cannot pronounce is
punctuation it may read out or pause in the wrong place for. The prose around the
blocks may use whatever it likes. A line she hears may not.

## Why the call proves itself instead of asking

The usual instinct is to verify the caller first: confirm your date of birth, confirm
your address. On a call to an 82-year-old that instinct is precisely backwards. An
unexpected voice asking an older person to confirm personal details is the most
recognisable opening of a telephone scam there is, and a genuine call that opens the
same way is indistinguishable from the fraudulent one. She cannot tell us apart, so
she is right to hang up — and if she hangs up, the workflow has failed even though
nothing went wrong.

So the call reverses it. **The agent proves itself to her, using a fact only the
surgery holds: the day she was seen.** It then says out loud that it will not ask her
for anything — the **Never-Ask Rule** — which gives her a rule to hold us to. If a
later caller asks her for her date of birth, she now knows that caller is not us.

That is the whole design of the opening, and it is why the Never-Ask promise is spoken
rather than merely honoured in the code.

## Opening

**Fixed.** Five things, in this order, before any question.

```
Hello, is that {first_name}?

This is an automated call from Fieldgate Surgery. I'm a computer, not a
person, so I'll keep this short.

You saw someone here on {weekday}, and the practice asked me to check how you've
been getting on since.

I won't ask you for your date of birth, your address, your bank details or anything
like that. I don't need them, and nobody from the practice will ever ask you for them
over the phone. If anyone does, it isn't us.

If you would rather not talk to a machine, just put the phone down. We won't ring
you again.

Is now a good time? If it isn't, just say so and I'll leave you be.
```

Notes on each part:

- **"is that {first_name}?"** — a first name only. The **Read Scope** of this call
  holds a first name and a phone number, and nothing else, so the agent could not ask
  for a surname even if it were told to.
- **"I'm a computer, not a person"** — plain words, said before anything is asked.
  Not "AI assistant", not "virtual agent". She should not have to work out what she is
  speaking to.
- **"You saw someone here on {weekday}"** — the proof. Day 3 after the appointment, so
  the weekday is unambiguous without a date.
- **"I won't ask you for…"** — the Never-Ask promise, spoken.
- **"just put the phone down. We won't ring you again."** — the promise
  [ADR 0006](../../../docs/adr/0006-a-refusal-is-not-a-missed-call.md) is built on.
  The call platform, on a hang-up, offers to ring again in forty five minutes; we
  suppress that, and this sentence is why we are entitled to. It has to be spoken
  before she has a reason to want it, which is why it sits in the opening and not at
  the end. A hang-up is a refusal expressed the only way available to someone who
  does not want to talk to a machine.
- **"Is now a good time?"** — she is allowed to decline before the questions start.
  A refusal here is a complete and successful outcome, not a failure to retry.

## When she declines

Set `declined` to `true`, leave the four answers out, and do **not** set
`stop_condition`. Then stop.

The distinction is not bookkeeping. A **Stop Condition** is one of five surfaces
listed in `CONTEXT.md`, and "not now" is none of them. Recorded as a Stop Condition, a
decline arrives on the board as a flagged **Review Item** reading `unmappable` — the
label for an answer that could not be mapped, applied to questions nobody put to her.
A Reviewer then reads it as something needing attention and rings her back, which is
the one thing she asked us not to do. The call that cannot ask is only trustworthy if
the no is also honoured.

So the absent answers carry no meaning here. They are absent because the questions
were never asked, and `declined` is what says so.

## The five questions

Asked one at a time, at her pace. The agent waits. It does not stack two questions
into one breath, and it does not fill her silence.

### 1 — Feeling

```
Since {weekday}, are you feeling better, about the same, or worse?
```

→ `feeling`: `better` | `same` | `worse` | `unsure`

### 2 — Medication

Asked **only** when the appointment record has `medication_changed = true`. Otherwise
it is not asked at all and the field is recorded as `not_asked`. The agent is never
told what she was prescribed, so it says "what they gave you" — it genuinely does not
know, and asking her to name a drug would invite a wrong answer into the record.

```
Are you getting on alright with what they gave you?
```

→ `medication_ok`: `yes` | `no` | `unsure` | `not_asked`

### 3 — Anything worrying

```
Is there anything worrying you?
```

Open. This is the **only** source of **Carried Words**. Whatever she says here is
stored as a verbatim span of the transcript together with the turn it came from, or
not stored at all. The agent does not summarise it, tidy it, or repeat it back in
better English.

If she says nothing usable, that is a legitimate outcome: no span is recorded and the
**Review Item** queues for a human. An invented quote would be spoken aloud to
reception on the **Rebooking Call**, in her name, so there is nothing to be gained by
guessing and a great deal to lose.

### 4 — Wants to be seen

```
Would you like the surgery to see you again?
```

→ `wants_seen`: `yes` | `no` | `unsure`

### 5 — Which half of the day

Asked **only** when she answered `yes` to question 4. Otherwise it is not asked at all
and the field is recorded as `not_asked`.

```
Are mornings or afternoons easier for you?
```

→ `when_easier`: `morning` | `afternoon` | `either` | `unsure` | `not_asked`

Until this question existed, the **Booking Envelope** was authored entirely by the
Reviewer. She said yes to being seen; a Reviewer who had never spoken to her picked a
window; the **Rebooking Call** accepted a slot inside it; and the first she heard of the
time was when she was expected. For somebody who does not drive and depends on a lift,
a time nobody asked her about is a missed appointment, and missed appointments in this
population are the thing the whole workflow claims to reduce.

It is also the same distinction the Closing is written around. A call made on her
behalf that she was never told about is acting over her rather than for her; a *time*
chosen on her behalf that she was never asked about is that distinction one step
further along.

Three deliberate limits:

- **It books nothing and promises nothing.** The agent does not say a time is
  available, does not offer one, and does not tell her when she will be seen. Nothing
  is held at this point in the workflow — a **Release** has not happened and no human
  has read the call.
- **Not asked of somebody who said no.** Asking when she is free, straight after she
  has said she does not want to be seen, presses her towards an appointment she
  declined. `not_asked` is the same shape `medication_ok` uses: a question nobody put
  to her is not an answer she failed to give, and `extract` enforces it rather than
  trusting the agent to have obeyed.
- **A weekday is `unsure`, not a guess.** "Thursdays, when my daughter's off" is
  neither half of the day. The Booking Envelope has no room for a weekday and the
  Rebooking Call cannot negotiate one with a receptionist, so recording it as `morning`
  would put a constraint into the envelope she never gave. It is recorded as `unsure`
  and a person reads the transcript. Carer patterns and hospital transport are the
  practice's to arrange, not this call's to collect.

Her answer becomes the **default** on the Release form's time of day, which the Reviewer
may still change — the same rule the quote follows. It is the starting point rather than
the decision, and where she gave no answer the form says so, so a Reviewer knows the
window is her own judgement.

Its absence never refuses a call. It is the one bounded answer whose gap is not
`extraction_failed`: a call placed before this question existed, or one where the agent
skipped it, is still a call a Reviewer can read, and the item is already in front of a
person because she said yes.

## Closing

**Fixed. Not optional copy.**

```
Thank you, {first_name}. Someone at the practice will read this today, and if you
need another appointment they'll sort that out for you, so you won't have to ring in
and wait on hold.

Take care.
```

The second clause is her notice. A **Rebooking Call** may later be placed in her name,
and this sentence is where she is told so, in the only language that matters to her:
she will not have to sit in the queue. Removing it would mean a call is made on her
behalf that she was never told about — which is the difference between acting for
someone and acting over them.

It promises no appointment and no time. Only that a person will read it, and that the
queueing is not hers to do.

## The Safety Line

**Fixed. Read verbatim when a Stop Condition fires, then the call ends.**

Never improvised, never varied, never adapted to what she said. The agent matched a
surface condition; it did not understand her situation, and a model that improvises
here is a model giving medical advice.

```
Thank you for telling me. That's something a person needs to hear, not a computer,
so I'm going to stop here rather than get it wrong.

Please ring 111 and tell them what you've just told me. They're there day and night,
and they'll decide what happens next. If it feels like an emergency, ring 999.

You won't be any trouble to them. That's what the number is for.

I'm letting the practice know we spoke, and someone there will see this today, so you
are not left on your own with it.

So that's 111. Take care, {first_name}.
```

The last three sentences were added after a test call, and each buys about four
seconds. They are not softening.

- **"You won't be any trouble to them."** The reason an older person does not ring
  111 is rarely that nobody told them to. It is that they do not want to be a
  nuisance, and a machine has just told them their problem is too serious for it.
- **"So that's 111."** Spoken safety advice repeats the action at the end. The first
  hearing lands while she is still taking in that the call has changed under her.
- **"Take care, {first_name}."** Every other way out of this call has a goodbye. This
  one did not, and the line ended mid-air. The first person to hear it said the agent
  hung up on her.

## Where the Safety Line sits in the prompt

Above the red-flag list, not below it, and it says *say this* before it says *stop*.

The first version put the trigger first — "STOP the call and read the line below" —
and then ninety five red-flag phrases, and only then the line itself. On the first
live call to somebody who said the words, the agent stopped the call and said nothing
at all. That ordering asks a model to hold a long instruction across a wall of list
items and act on its second clause; the first clause is `STOP the call`, and it obeyed
it.

So the order is now: what to say, how to say it, that it is never skipped, then what
triggers it, then one line closing the loop. The imperative the model meets first is
to speak.

Why 111 and not the practice's own number: the agent does not grade severity, so the
line cannot route by severity. 111 exists precisely for "I don't know how urgent this
is" and escalates to 999 itself. Sending her to a surgery switchboard that may be
closed, or asking her to judge her own symptoms, would both put the grading back on
her — and she rang nobody. We rang her.

The last sentence matters as much as the first. Ending a call after someone has
described something frightening, without telling her a human will see it, leaves her
worse off than before we called.
