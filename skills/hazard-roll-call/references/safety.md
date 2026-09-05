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

## Credentials

`CALLE_API_KEY` is read from the environment or a local `.env` and never written, echoed or committed.
The fake server needs no credential. Webhook deliveries from CALL-E are unsigned; the receiver checks
`CALL-E-Event-Id` against the body, de-duplicates, and re-fetches the call through the authenticated
API before acting.

## No duplicate calls

Every call task carries an idempotency key (`canopy:<event>:wave<n>:attempt<m>`,
`canopy:<event>:escalation:<person>`). Re-running an event whose ledger exists is refused. A person is
dialled at most twice per event plus one follow-up per explicit `follow-up` invocation.

## No hidden schedules

Canopy has no internal recurring scheduler. `watch` polls only while the process runs. Recurrence
belongs to the host scheduler, which must document its own cancellation.

## Cancellation

The CALL-E Developer API cannot cancel a call once created, so Canopy limits blast radius: sequential
waves of at most `CANOPY_WAVE_SIZE` people, and Ctrl+C stops every wave not yet created. Tell the
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
- An unknown answer never becomes green. Low completion confidence never closes a check.

## Data retention

The ledger holds masked timeline entries and short transcript excerpts in the person's own words.
Purge `data/runs/<event>/` once the event is closed and reviewed.
