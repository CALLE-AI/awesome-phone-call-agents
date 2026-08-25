# Safety rules for ghost-network-audit

This workflow calls medical offices. That makes it higher-risk than most directory
checks, and the rules below are what keep it inside a safe boundary. They are not
defaults to be tuned. If a run cannot satisfy one of them, the run does not happen.

## 1. The call is administrative, never clinical

Every question is about the office's own published business facts: who practices here,
which plans are accepted, whether the panel is open, how far out scheduling runs.

Never ask, and never record if volunteered:

- anything about a patient, named or described
- symptoms, diagnoses, conditions, medications, or test results
- treatment options, clinical advice, or referral appropriateness
- pricing for a specific person's care

If the person on the line begins describing a patient or a clinical matter, the call
redirects once ("I only need to confirm the directory listing") and then ends. That
material is dropped, not summarized into the result.

## 2. No patient identity, and no impersonation

The call never claims to be a patient, a patient's family member, or a referring
clinician. This is a disclosed directory audit, not a secret-shopper study. An audit
that lies about who is calling cannot be defended to the office it called, and offices
have every right to know why their front desk is being asked questions.

The call also never supplies a real patient's name, date of birth, member id, or any
other identifier. There is no field for one, and no run needs one.

## 3. Disclosure comes first

Before any question, the call states:

- that it is an automated call
- the real name of the auditing organization
- that the purpose is verifying a public directory listing
- a callback number the office can use to confirm the audit is genuine

A run without a real `auditing_organization` and a real `callback_number` is refused.
These are not cosmetic — they are how an office verifies the caller is who it says.

## 4. Emergency, crisis, and triage lines are never dialed

Any listing whose number is flagged as an emergency line, after-hours line, nurse
triage line, crisis or suicide line, or answering service is skipped permanently. There
is no override flag and no dry-run exception, because the failure mode — occupying a
crisis line with an automated survey — is not recoverable by apologizing afterward.

When line type is unknown, the auditor does not guess. Unknown line types are dialed
only if the listing is a normal published office number; anything that looks like an
urgent-care, on-call, or after-hours number is skipped and flagged for human review.

## 5. Consent, refusal, and do-not-call

- A refusal ends the call immediately. The listing becomes `unverified / declined`.
- A refusal is never retried, in this run or a later one. The number is added to the
  suppression list.
- A number on the suppression list is never dialed, including in a dry run. A dry run
  previews timing decisions safely because a preview has no timing; suppression is
  about the number itself, so previewing a call to a suppressed number is the wrong
  behavior wearing a preview's clothes.

## 6. One office, one call

Offices are de-duplicated by phone number before dialing. A practice with nine listed
clinicians gets one call that asks about nine names. Calling a front desk nine times to
ask nine variants of the same question is the behavior that gets automated callers
blocked, and it is avoidable with a grouping step.

Within an audit window, an office is called at most once. A no-answer earns at most one
retry on a later day, and never more than two total attempts.

## 7. Calling window

Calls are placed in the *office's* local time, on weekdays, within business hours.
Timezone is taken from the listing, never inferred from the area code — number
portability makes area-code inference wrong often enough to matter. A listing with no
timezone is deferred for human scheduling rather than dialed on a guess.

## 8. Unknown is not "no"

The result schema requires `yes`, `no`, or `unknown` for every field, with no default.

These are all `unknown`, never `no`:

- voicemail, hold-forever, or hangup
- an answering service that cannot speak to the listing
- "I'd have to check with the billing office"
- a language barrier the call cannot bridge
- any answer the schema could not parse

A listing is marked a ghost only when a person at the office said the provider is not
there or the plan is not accepted. Every metric in the report is computed over
confirmed rows only, and the unverified share is always reported next to it.

The reason this rule is absolute: a false ghost removes a working clinician from a
directory, and a false confirmation leaves a patient dialing a dead number. Both come
from treating "we could not tell" as a finding.

## 9. Credentials

`CALLE_API_KEY` is read from the environment only. It is never accepted as a command
flag, never written to an output file, never logged, and never included in a report. If
an API error message happens to contain the key, it is redacted before the error is
shown.

## 10. Masking

Phone numbers are masked everywhere output is produced — reports, logs, summaries, and
error text — showing only the country code and last two digits. Sample and test data
use fictional reserved numbers only.

## 11. Live calls are opt-in, four times over

A live run requires `CALLE_API_KEY`, `CALLE_LIVE_CALLS_ENABLED=1`, an explicit `--live`
flag, and real disclosure inputs. Missing any one of them previews instead of dialing.

Absence never means consent. An unset variable, an empty string, and an unrecognized
value all mean preview.

## 12. No hidden recurrence

One run is one pass over one list. The skill never installs a schedule, never re-runs
itself, and never leaves a background job behind. Re-auditing quarterly is a real need,
but it belongs to the host's scheduler where the owner can see and cancel it — not
inside a skill that was invoked once.

To cancel an in-flight run: stop the process. Calls already placed cannot be recalled,
which is exactly why the gates run before dialing rather than after.
