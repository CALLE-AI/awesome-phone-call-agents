# Threat model

What could go wrong, what stops it, and what is deliberately out of scope.

The asset being protected is not data. It is **the accuracy of a claim**: that a specific
person heard a specific warning before a specific deadline. Every threat below is a way
that claim could become false while still looking true.

## The primary failure: a false confirmation

A contact recorded as confirmed who was not. The consequence is that no truck is sent, and
somebody on powered medical equipment loses power without warning.

Everything is biased against this. A false negative costs one extra call or one
unnecessary door knock. A false positive is the failure the whole regulatory duty exists to
prevent.

| Route to a false confirmation | What stops it |
| --- | --- |
| Voicemail counted as contact | Voicemail is its own `contact_type` with its own row, and Judge B marks voicemail from the transcript greeting regardless of the structured result |
| A completed call counted as contact | `confirmed` reads `dispositions.disposition = CONFIRMED` only. There is no code path from "call completed" to a confirmed count |
| Extraction hallucinating an acknowledgement | Judge B must independently find the acknowledgement in a recipient turn. Agreement is required, and Judge B returning `unknown` is not agreement |
| A "yes" that answered the wrong question | Judge B only considers turns after the notice turn, so "Yes, this is Maria" cannot confirm a notice that has not been read yet |
| A low-confidence extraction taken at face value | The confidence gate. A null or unrecognised confidence fails it |
| A partial or malformed result read optimistically | Strict local validation. A null, an unexpected key, a bad enum, or an over-long value routes to a human |
| A model tiebreaking its way to a confirmation | Judge C cannot change a disposition. It writes a note |
| A review item quietly expiring | A `NEEDS_HUMAN` contact still on the clock becomes `FIELD_VISIT_PENDING` at the cutoff, automatically |
| An operator clicking confirm without looking | A confirmation requires a named actor and a cited span or typed reason, recorded on the transition, and counted separately in the report |

## Duplicate calls

Calling somebody repeatedly during an emergency is its own harm, and the people being
called are the least able to absorb it.

| Route to a duplicate | What stops it |
| --- | --- |
| A retry after a network timeout | The idempotency key is derived from the authorization (`event:contact:step:target`), not from the attempt, so a retry replays the same key |
| A restart mid-dispatch | Intent ids and keys are deterministic. Re-deriving finds the existing row; `reserve_intent` returns it instead of creating a second |
| A crash between submitting and recording | The call id is written to `attempts` before the state transition. A restart finds the orphaned binding and recovers it rather than dialling |
| An unknown submission "retried" with a fresh key | `SUBMISSION_UNKNOWN` never mints a new key. Reconciliation replays the identical key with a byte-identical body, which the contract answers with the original call |
| Two ladder steps racing | Each step has its own key and its own intent, and `intents.idempotency_key` is UNIQUE |
| A ladder that keeps going | `max_calls_per_contact` is a hard ceiling; wrong numbers and refusals never redial |
| A live run exceeding the operator's ceiling | `--max-calls` is counted across every path including reconciliation, and the run stops rather than exceed it |

The `assert_task_versions_match` guard exists for a subtler one: editing the call script or
the result schema mid-event would change the request body behind an already-used key, which
the contract answers with `409 idempotency_conflict`. The guard refuses to continue an
event on a build that would send a different body.

## Hostile or confused webhook traffic

The webhook receiver is a public HTTPS endpoint and the CALL-E contract publishes **no
authentication** on it. It is therefore treated as an untrusted wake-up signal, never as
evidence.

| Attack | What stops it |
| --- | --- |
| Forged terminal event claiming a confirmation | The receiver appends no transition and reaches no conclusion. The worker re-reads the call from the authenticated API and adjudicates that |
| Replayed delivery | Deduplicated on the webhook event id. A duplicate adds no row and changes nothing |
| Same event id, different payload | Quarantined, not overwritten. The first payload is preserved and the conflict is visible |
| Event id in the header disagreeing with the body | Quarantined. The contract warns that the top-level `id` is the event and `data.id` is the call, and binding to the wrong one attaches callbacks to a call that does not exist |
| Event for a call we never placed | No intent owns that call id, so the row is quarantined |
| A re-read that is not ours | Binding checks compare the returned call id and the echoed `metadata` (event, contact, intent, step, target, task version, schema version) against the stored intent. Any mismatch routes to a human and writes no disposition |
| Unknown event type | Quarantined rather than guessed at |
| Malformed envelope | 400, no row written |

The receiver's whole job is: validate the envelope, insert one row, commit, return 200. A
2xx tells CALL-E the delivery landed; it does not tell it we agreed with anything.

## Exposure of a phone number

The roster is a list of people who depend on medical equipment. That inference is the
sensitive part, and the phone number is the identifier that makes it actionable.

| Route to exposure | What stops it |
| --- | --- |
| A log line | Every log path masks. `tests/test_masking.py` asserts the run log carries no raw number |
| The preflight preview | Masked, and the renderer refuses to print at all if an unmasked number survives into the output |
| The dashboard | Templates receive masked values only. Every page is checked for leaks in tests |
| A report or a work-order export | Masked, both CSV and JSON, checked in tests |
| The audit trail | Transitions carry the contact id and reason codes, never a number |
| A stored provider snapshot | Passed through `redact_snapshot` before it is written |
| Free text coming back from a call | `notes_for_human` is redacted: phone shapes masked, digit runs of 7+ removed, emails removed |
| A recorded replay payload | `pc record` redacts before writing, and a test asserts no `live-redacted` recording carries a raw number |
| An error message | The E.164 validation message deliberately contains no example number, because the leak guard cannot tell a documentation example from a customer |

The one place a raw number exists is `contacts`. A test enumerates every table and asserts
the roster numbers appear there and nowhere else.

## Protected health information

The system must never become a health record. Enrollment in Medical Baseline is a tariff
flag; anything beyond that is out of bounds.

- No field for a condition, device, diagnosis, medication, or treatment exists in any
  model, the result schema, any database column, or any fixture.
- The result schema instructs the extraction model, in the field description, not to record
  medical detail in `notes_for_human`.
- The call script instructs the agent to give no advice and to record no medical detail.
- `tests/test_no_phi.py` scans the pydantic models, the transmitted schema, the SQLite
  columns, every shipped file for a PHI-shaped field declaration, and every fixture
  recursively for a PHI-shaped key. It also asserts the medical-question fixture's note
  routes the question without naming the equipment.

A caller may still say something about their health on the call, and the transcript retains
it for the review window. Nothing extracts it into a field, and nothing surfaces it to a
report.

## Impersonation, in both directions

**Somebody impersonating this system.** Utility impersonation scams are common and work
because a legitimate utility call and a scam sound alike. The countermeasure is behavioural
rather than cryptographic: this call asks for nothing. No account number, no payment, no
card, no date of birth, no "confirm your address". A customer who has been told "we will
never ask for payment or account information" has a rule that distinguishes the real call
from the fake one, and the real call states that rule out loud every time.

**This system impersonating a utility.** The call names the organisation, states that it is
automated, and states that it may be recorded, before anything else. There is no
configuration that suppresses the disclosure.

## Calling the wrong person

| Route | What stops it |
| --- | --- |
| A repaired phone number | Numbers are never repaired. A non-E.164 number is a blocking preflight error |
| A guessed country code | Same. Adding a country code is a guess, and a guess dials a stranger |
| A number that turned out to be wrong | A `wrong_number` outcome retires the number for the event. No step dials it again |
| Somebody who asked not to be called | A refusal never redials |
| Calling at 3am | Quiet hours computed in the contact's own IANA timezone. The override is off by default and printed in the preview |
| A timezone inferred from the number | Timezones come from the roster or the event default. `resolve_zone` raises on anything unknown rather than falling back |
| A call in a language the customer cannot understand | The locale must be on the supported list for the destination line, or the contact is routed to a bilingual callback and never dialled |

## Losing the audit trail

The report may be read by a regulator after an event that hurt somebody. It has to be
reconstructible.

- `transitions` is append-only, enforced by SQLite triggers rather than by convention. A
  test asserts both UPDATE and DELETE abort.
- `Ledger.reconstruct()` replays an intent's history through the same allowed-transition
  table the engine uses, so a hand-edited or corrupted trail is detected rather than
  trusted. Tests cover both a non-contiguous trail and a forged shortcut to `CONFIRMED`.
- A crash between two transitions leaves a state that reopens and resumes, which is tested
  against a real file rather than an in-memory database.
- Every transition records an actor, so operator actions are distinguishable from
  automation.

## The cancellation boundary

CALL-E publishes no cancel endpoint. The risk is an interface that implies otherwise: an
operator hits "stop", believes the calls stopped, and does not follow up.

The mitigation is honesty in three places. There is no `cancel()` method on the transport
interface, and a test asserts its absence. The README states the boundary explicitly. The
polling timeout message says the call may still be running and tells the reader to reuse the
call id rather than submit a new one.

## Deliberately out of scope

- **Authentication and multi-tenancy on the dashboard.** It binds to `127.0.0.1` by
  default and assumes a trusted operator network. A deployment on a shared network needs a
  reverse proxy with real authentication in front. This is a hackathon submission, not a
  production control plane, and pretending otherwise would be its own security problem.
- **Encryption at rest.** The ledger is a SQLite file and relies on filesystem
  permissions. A real deployment holding a Medical Baseline roster would need disk
  encryption and access controls that are properly somebody's operational responsibility.
- **Rate limiting the webhook endpoint.** A flood would fill the inbox table. The
  deduplication and quarantine logic keeps it from corrupting anything, but the volume
  itself is a reverse-proxy concern.
- **Verifying that CALL-E is who it says it is on the webhook.** Not possible with the
  published contract. It is why the re-read exists.
- **Retention enforcement.** The retention window is configured and documented; the sweep
  job that enforces it is not built.
