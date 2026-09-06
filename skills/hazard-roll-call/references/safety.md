# Safety rules for hazard roll calls

Phone calls are real-world side effects, and these calls reach frightened, elderly, often isolated
people during an emergency. Every rule below is enforced in code by the Canopy app; this file states
them so an agent driving the skill never works around them.

## Explicit intent and consent

- A roll call is started by a person, or by a trigger the person configured (`watch`). The agent never
  invents an event.
- Only registry rows with `consent=yes` and a `consent_date` are eligible. Everyone else is skipped and
  listed in the run output. The registry is an opt-in list, not a phone book.
- Live mode needs three independent signals: `CANOPY_MODE=live`, `CALLE_API_KEY`, and `--confirm`.
  A drill (dry-run) is the default and places no call.
- Live runs are started only from the command line, never from the dashboard.

## Calling window

- Quiet hours default to 21:00-07:00 in the configured time zone. A live roll call inside the window is
  refused.
- Only playbooks flagged `life_safety: true` (heat, flood, outage-medical, smoke) may be started inside
  quiet hours, and only with `--override-quiet-hours "<reason>"`. The reason is written to the ledger.
  A boil-water notice waits for morning.
- Drills are not blocked by quiet hours, but they print what a live run would have done.

## Disclosure

Every call opens with the same disclosure, rendered from one function so it cannot drift:
"Hello, this is an automated welfare call from <org>. You signed up for check-in calls during
emergencies like this <hazard>. This will take about one minute. Is now okay?"
If asked, the agent says it is an automated assistant calling for the organisation. It never claims to
be a person, a nurse, or an emergency service.

## Phone numbers

- E.164 only, validated on load. Anything else is skipped, never "fixed".
- Two rows sharing one phone are collapsed to the first, because CALL-E runs one conversation per
  phone (platform issue #235).
- Numbers are masked (`+14*******01`) in logs, dashboard, ledger timeline, transcript excerpts and
  reports. Full numbers exist only in the operator's registry file, which is git-ignored when named
  `*.private.csv`.
- In rehearsals, `CANOPY_LIVE_ALLOWLIST` hard-limits which numbers may be dialled.

## What CALL-E is told about a person

Name, language, an age band, whether they live alone, and on an escalation call the contact's name and
a one-line reason. Address, coordinates, medical keywords and operator notes never leave the machine.

## Credentials and exposure

`CALLE_API_KEY` is read from the environment or a local `.env` and never written, echoed or committed.
The fake server needs no credential. Webhook deliveries from CALL-E are unsigned; the receiver checks
`CALL-E-Event-Id` against the body, de-duplicates, and re-fetches the call through the authenticated
API before acting. When a public URL is configured for webhooks, every other route requires a token, so a
tunnel never exposes the drill or approve endpoints.

## No duplicate calls

Every call task carries an idempotency key (`canopy:<event>:wave<n>:attempt<m>[:<person>]`,
`canopy:<event>:escalation:<person>`). A create that CALL-E rejects with 429 or 5xx is retried with the
same key. Re-running an event whose ledger exists is refused; `resume` re-places refused waves with the
same keys, so a call CALL-E had in fact accepted is returned rather than duplicated. A person is dialled
at most twice per event plus one follow-up per explicit `follow-up` invocation. Tickets are unique per
person and kind; a contact is phoned at most once per event.

## Nobody is escalated for a call that never happened

If CALL-E keeps refusing a task, the people are marked `not_attempted`, get a `not_attempted` ticket, and
the report is flagged incomplete. Their emergency contacts are not phoned. If a call is accepted but does
not finish before the timeout, the people are `awaiting` a result; no verdict is guessed.

## No hidden schedules

Canopy has no internal recurring scheduler. `watch` polls only while the process runs. Recurrence
belongs to the host scheduler, which must document its own cancellation.

## Cancellation

The CALL-E Developer API cannot cancel a call once created, so Canopy limits blast radius: sequential
waves of at most `CANOPY_WAVE_SIZE` people, and Ctrl+C stops every task not yet created. Tell the
user this before a live run.

## Medical and emergency boundaries

- The agent asks the playbook's questions, offers the playbook's public-health advice lines, and stops.
  No diagnosis, no medication doses, no reassurance that contradicts a red flag.
- Red flags (confusion, fainting, hot dry skin, breathing difficulty, chest pain, a device without
  power) lead to one instruction: call the local emergency number now, and the emergency contact is
  being alerted.
- Canopy never contacts emergency services. An `emergency_services` ticket is a recommendation that a
  human approves on the dashboard.
- A contact who says "yes, I will go" is recorded as a commitment, not a verified visit. Vague answers
  ("maybe", "later") are not commitments and lead to a door-knock ticket.
- An unknown answer never becomes green. Low completion confidence never closes a single-recipient check.

## Data retention

The ledger holds masked timeline entries and short transcript excerpts in the person's own words.
Purge `data/runs/<event>/` once the event is closed and reviewed.
