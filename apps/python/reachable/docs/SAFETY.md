# Reachable — Safety Contract

Reachable phones adults about children. Two things follow from that and shape
everything below: the information is sensitive even when it sounds mundane, and
the person who answers has not been authenticated by anything except their own
word.

Read this before extending Reachable or placing a call with it.

**The one-line rule: code decides whether to call and what may be said. The model
chooses only wording.**

---

## 1. The four requirements

A maintainer review of the neighbouring Roll Call app set out four fixes
([`SOURCES.md` §1.10](SOURCES.md#110-the-roll-call-maintainer-review--verified)).
Reachable meets all four from the first commit. Two of them are still maintainer
blockers after a superseding review on 11 September 2026; the other two are not,
and Reachable implements them anyway because they are cheap and correct.

### 1.1 Credential allowlist

Bearer credentials may only ever be sent to an allowlist of approved HTTPS
provider origins.

- The allowlist is the official CALL-E API base URL, plus a loopback address for
  the local fake server, which never receives a real key.
- Any other value of `REACHABLE_CALLE_BASE_URL` is **rejected at startup**,
  before the API key is read from the environment. A misconfigured base URL can
  therefore never leak a bearer token, because the process refuses to start.
- Rejection is by parsed scheme and host, not by substring. A host such as
  `api.heycall-e.com.attacker.test` does not match.
- The check runs at startup rather than at call time so the failure is loud and
  early rather than at the moment somebody is trying to place a real call.

### 1.2 Sanitise all free text

Transcripts, CALL-E results and any provider text are stored and displayed
escaped, length-limited, and with control characters stripped.

- Sanitisation happens at the **ingestion boundary**: text is cleaned as it
  enters storage, not on the way out to a template. A second consumer added later
  cannot forget to sanitise.
- Control characters are stripped, including bidirectional-override codepoints,
  which can make a stored string display as something other than what it is.
- Every free-text field has a documented maximum length and is truncated with a
  visible marker.
- Raw provider text is **never** passed through into JSON output or CSV exports.
  CSV export additionally neutralises leading `=`, `+`, `-` and `@`, which
  spreadsheet software otherwise interprets as formulas — a school office opens
  these files in Excel.
- The sanitised text is what a member of staff reads. It is also all they need:
  the decision the transcript supports is made by a person, so a lightly
  escaped rendering loses nothing that matters.

### 1.3 Bind every result

A result only counts if it is provably the result of the call we placed.

All five must match, or the result is `NEEDS_HUMAN`:

1. CALL-E `call_id` equals the one stored at reservation;
2. idempotency key equals the one reserved;
3. destination equals `recipients[].attempts[].phone` for the attempt read;
4. `metadata.pupil_id` equals the case's pupil;
5. `metadata.contact_id` equals the contact dialled.

**Plus the transcript condition.** An `identity_confirmed = yes` must be
supported by at least one transcript turn where `speaker == "user"`. A
`speaker: bot` turn is Reachable's own agent talking; a `speaker: unknown` turn is
unattributed. Neither is evidence
([`SOURCES.md` §2.3](SOURCES.md#23-transcript-turns-and-speakers--how-binding-is-possible)).

**A generic yes or no never triggers an attendance or safeguarding action by
itself.** High-stakes interpretation always goes to a human: the suggested
register reason is approved by staff, and every `URGENT_HUMAN` is read by a
person before anything happens.

### 1.4 Strict ASCII E.164 validation

`^\+[1-9][0-9]{7,14}$`, applied to **ASCII input only**, before any live call.

- The string is rejected if it contains any non-ASCII codepoint, before the
  pattern is applied. Unicode digits and full-width forms are not normalised into
  ASCII and then accepted — a number containing them is refused.
- Numbers are **rejected, never repaired**. No stripping of spaces, no adding a
  country code, no inferring `+44` from a leading `0`. Guessing a destination
  means guessing whose telephone rings
  ([`docs/design-principles.md`](../../../../docs/design-principles.md) Principle 3).
- A failed number is a named decision not to call, flagged in contact health so
  the office can correct it in their own system.

---

## 2. Disclosure and minimal disclosure

### 2.1 Disclosure

Every call opens by stating it is an automated assistant calling on behalf of the
named school. If asked whether it is a person, it says plainly that it is not. If
asked to stop or not to be called again, it records that, stops, and asks nothing
further.

The disclosure block is prepended by the policy layer, not composed by a model.

### 2.2 Minimal disclosure

**Nothing about a child is said until the named contact confirms their identity.**
After that, only the child's **first name** — never a surname, never a year or
form group, never an address, never the reason for the absence beyond what the
contact themselves raises.

Anyone who is not the named contact, and every voicemail, hears only that the
school is calling and a request to call the school office back. No child is named
and no reason is given.

This matters more than it first appears. A phone number that has changed hands
belongs to a stranger, and the contact-check workflow exists precisely because
some of these numbers *have* changed hands. The minimal-disclosure rule is what
makes it safe to dial a list that we already suspect is partly wrong.

---

## 3. Authority boundaries

| | Action |
| --- | --- |
| **Allowed** | Place calls that pass every guard |
| | Record call outcomes against a case |
| | Create tasks for staff |
| | Export suggested contact changes as CSV |
| | Flag a contact's health from a failed call |
| | Produce a *suggested* register reason for staff approval |
| **Forbidden** | Write to the school's management information system or register |
| | Record an official attendance code |
| | Collect a new phone number by voice |
| | Mention fines, penalty notices, prosecution or legal action |
| | Give medical advice |
| | Conclude that a child is safe or accounted for |
| | Call the contacts of a vulnerable-flagged pupil automatically |
| | Call a pupil |
| | Speak a child's surname, year group, form group or address |
| | Say anything about a child before identity is confirmed |

### 3.1 These are enforced in code, not by prompting

This is the central design claim and the thing to check when reviewing a change.

- **There is no dedicated replacement-number field or automatic contact update.**
  The task text tells the agent not to request a new number. Free-text results
  and transcripts can nevertheless contain unsolicited numbers; display masking
  is a heuristic, not proof that a number was never captured. Contact changes
  require office follow-up through a trusted channel.
- **There is no code path that writes to a register or an attendance code.** The
  forbidden actions are not blocked by a check — they are not implemented. The
  output side of Reachable is: a task row, an outcome row, and a CSV file.
- **The vulnerable gate is evaluated before every other gate**, in the policy
  layer, and produces a task with no call attached.
- **Fines and legal action cannot reach a task text.** The placeholder set is
  closed and validated, and the assembled task is asserted at render time to
  contain none of the forbidden terms outside the block that prohibits them. A
  render containing one is refused, which routes the case to a human.
- **Approval-required actions are transitions with a `staff` trigger** in
  [`STATE_MACHINE.md`](STATE_MACHINE.md). There is no scheduler path to them.

A useful test for any future change: if the only thing standing between the
system and a forbidden action is a sentence in a prompt, the change is wrong.

### 3.2 Why "safe" is not an outcome

There is no state, no enum value and no report cell that means a child is safe or
accounted for. `REASON_GIVEN` means an adult stated a reason on a telephone.

The distinction is not pedantry. An automated system that can output "accounted
for" will, eventually, output it wrongly — on a mis-transcription, on a confident
extraction from an ambiguous call, on a number that has changed hands. The person
reading the report will reasonably stop looking. Reachable is built so that the
comfortable conclusion is not available to it.

---

## 4. Dry run by default

Reachable cannot place a call unless **both** are true:

1. `REACHABLE_LIVE_CALLS=1` is set in the server environment; and
2. a human confirms **that specific call** — a typed confirmation in the CLI, or
   the confirm step on the dashboard's call preview.

Without (1), every code path still runs: the task is rendered, the schema built,
the idempotency key derived and reserved, the destination masked and displayed,
and the attempt stored. Only the network request does not happen. This is what
the default test suite exercises, which is why the tests need no credentials and
no network.

There is no "confirm all" and no standing approval. The cascade confirms per
contact, because each hop dials a different household.

**Never test against a real family.** Verify configuration against a number you
own and have offered for testing. Fixtures use only Ofcom's reserved drama range
`+447700900000` to `+447700900999`, with fictional pupils and fictional contacts.
No fixture contains a number that can ring a real subscriber.

---

## 5. Numbers, names and masking

- Private destination records and call evidence may contain full numbers.
  Dashboard expressions, CSV cells, and CLI output use a shared display-only
  mask for E.164 and common national phone formats, showing the last three digits.
  Stored evidence and identity comparisons are unchanged. This heuristic does
  not anonymise spelled-out numbers or other personal data; use synthetic data
  for public demos and review exports before sharing.
- The unauthenticated dashboard's `serve` command refuses non-loopback hosts.
  Do not expose it using a public tunnel or a separately configured server.
- Pupil surnames, year groups and form groups exist in staff views only and are
  never spoken on a call and never placed in a task text.
- Audit rows name the fields that came back, not their values
  ([`SOURCES.md` §1.9](SOURCES.md#19-call-safety)).

---

## 6. Idempotency

One authorised intent produces at most one call.

Keys, derived from the authorised intent and never from the attempt:

- **Pattern follow-up:** `(trigger_date, pupil_id, contact_id, authorisation)`
- **Contact check:** `(term_id, contact_id, authorisation)`

`authorisation` is the ordinal of the human decision that this specific call may
happen. It is **not** a retry counter: it advances only when a person authorises
that household to be rung again, which is genuinely a new authorised intent.
Every network retry of the *same* authorisation reuses the same key, so a
timeout, a crash or a replay can never dial twice.

> **Why the ordinal is there.** Without it these keys contradict
> [`STATE_MACHINE.md`](STATE_MACHINE.md), which returns a case to a ready state
> after voicemail so that a further attempt may be authorised. A key over
> `(term, contact)` alone is already reserved at that point, so guard 9 would
> refuse forever, `REACHABLE_MAX_ATTEMPTS` would be dead configuration, and the
> transition would be a dead end. The ordinal is the smallest change that keeps
> both documents true, and it keeps "a human must decide to ring that household
> again" explicit rather than accidental.

Each key is **reserved in an append-only ledger before dialling**. Order, without
exception: write the reservation, commit, place the call, update from the
authoritative terminal read. A record that only exists after success is not a
record — a call accepted but never reported would leave no trace for the next
attempt to collide with.

Anti-patterns that silently disable the protection, and are therefore forbidden:
a fresh UUID per call, a hash of the clock, a hash of payload plus clock, one
identifier per *network* attempt. If retrying one authorisation can produce a
different key, there is no idempotency and the provider is behaving correctly
when it dials again ([`SOURCES.md` §1.6](SOURCES.md#16-idempotency)).

The ledger outlives the case it guards, so a redelivered webhook after cleanup
cannot produce a second call.

---

## 7. The calling window

School hours on school days, in the school's own IANA timezone, from
`school.csv`. Configurable per school.

- "School day" comes from the calendar CSV, never inferred from the day of the
  week. Half-terms and INSET days are not weekends and cannot be derived.
- The timezone is an IANA name and is **never inferred** from a phone number,
  country code or locale
  ([`docs/design-principles.md`](../../../../docs/design-principles.md) Principle 4).
- A refusal names the local time that caused it, so the dashboard can say
  "outside the calling window (17:40 Europe/London)" rather than "waiting".

**This is a product default, not legal advice.** Appropriate hours for contacting
families about a child are a matter for the school's own policy.

---

## 8. Retention

Transcripts are deleted after `REACHABLE_TRANSCRIPT_RETENTION_DAYS`, default
**14** — short on purpose. After deletion the outcome, the disposition and the
audit trail remain; the words do not.

Sanitised transcript text is visible only on the case detail page, to the single
operator the app is bound to. It is never exported, never placed in a CSV, and
never sent anywhere.

---

## 9. Data protection

Reachable is a tool a school runs; the school is the **data controller**. A real
deployment needs the school to complete its **own data protection impact
assessment** covering at least: the lawful basis for calling contacts, what
contacts are told about automated calling, retention of transcripts, and who can
see them.

**Reachable does not claim legal compliance, and this document is not legal
advice.** The defaults here — the calling window, the 14-day retention, the
minimal-disclosure rule, the wording of the calls — are engineering choices made
to be defensible. They are a starting point for that assessment, not a substitute
for it.

Nothing in Reachable has been reviewed by a lawyer or a data protection officer.

---

## 10. What a call can and cannot establish

**A call can establish:**

- That someone answered the number the school holds.
- That the person who answered said they are the named contact, and that a turn
  they actually spoke supports it.
- What that person said, in their words, at that moment.
- That they said they were aware, or not aware, of the absence.
- That they asked for support, or asked to speak to a member of staff.
- That they asked not to be called again.

**A call cannot establish:**

- **That the person is who they said.** Reachable has a self-report backed by a
  transcript turn. That is enough to proceed with minimal disclosure; it is not
  identity verification.
- **That a child is safe, present, or accounted for.** No outcome means this.
- **That a stated reason is true.** `REASON_GIVEN` records a claim. Staff decide
  what to record.
- **That silence means anything.** A no-answer is not a refusal, is not consent,
  and is not evidence of a problem. CALL-E's own documentation says it directly:
  do not infer that a recipient declined from a generic failure state
  ([`SOURCES.md` §2.6](SOURCES.md#26-how-voicemail-no-answer-not-in-service-and-failure-are-reported)).
- **That a confident extraction is a true one.** `task_completed: true` with a
  confidence score of 0.05 is a low-confidence result wearing a success label.
  Both the score and the label are checked.
- **That the absence of an alarm means there is no problem.** A contact who is
  aware of the absence and gives a plausible reason has told us one thing about
  one morning. Reachable makes no claim beyond that.
- **Anything at all, when the outcome is unknown.** Unknown is the absence of a
  fact. It is reconciled by reading the call back, never by dialling again, and
  if it stays unknown a person resolves it.

Stopping is a successful outcome. Guessing is not.
