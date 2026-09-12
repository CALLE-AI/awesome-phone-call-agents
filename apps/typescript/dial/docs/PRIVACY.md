# Privacy

> This document describes what the software does. It is **not** legal advice,
> and the user-facing policy text at the end requires review by a qualified
> lawyer before publication.

## What Dial collects, and why

| Data | Why | Retention |
| --- | --- | --- |
| Email, name, password hash | Account identity | Until deletion |
| Task instruction | It is the request | Until deleted |
| Location (coordinates or place name) | To find nearby businesses | With the task |
| Discovered businesses | Evidence for the result | With the task |
| Call outcomes, structured results | The answer, and proof of it | With the task |
| Call transcripts | So a user can check what was actually said | **User-configurable** |
| Audit events | Security and accountability | With the account |

Dial does not collect continuous or background location. Foreground location is
requested at the moment a task needs it and not before, on both platforms.

## Transcript retention

`transcriptRetentionDays` is user-controlled:

- `0` — transcripts are **never stored at all**. The setting is read at write
  time, so nothing is written and then deleted afterwards.
- `N` — a housekeeping pass in the worker blanks transcripts older than N days.

Tested: with retention set to 0, completed calls carry an empty transcript.

## Deletion

- **A task**: `DELETE /api/tasks/:id`. Cascades to candidates, calls, attempts,
  transcripts and events.
- **The account**: `DELETE /api/account`. Cascades to everything above plus
  settings, sessions and notifications. Available in both clients, behind a
  confirmation step.

## Data minimisation

- Raw phone numbers never leave the server. API responses carry `+35***00`.
- Attempt records store only the masked number; the raw one lives on the call
  row, server-side.
- Logs redact secrets and transcripts, and mask phone numbers.
- The call brief tells CALL-E only the facts the task needs, and explicitly
  forbids disclosing anything not listed in it.

## AI call disclosure

Every call brief opens with an instruction to identify as an AI assistant
calling on behalf of a customer, and never to claim to be a human or to be the
customer. This is not configurable.

Dial is user-requested task completion, not outbound marketing. There is no bulk
calling, no contact-list upload, no caller-ID spoofing, and no
retry-until-answer.

## Sensitive categories

For medical, financial and legal tasks Dial will not fabricate identifying
details — date of birth, account numbers, prescription numbers, ID numbers. The
brief instructs the agent to say it does not have the detail and that the
customer will follow up directly.

A business refusing to disclose something is recorded as a legitimate outcome
(`refused`, with the stated reason), not as a failure to be retried.

Emergencies are never routed through the pipeline.

---

## Draft user-facing policy — REQUIRES LEGAL REVIEW

> **[LEGAL REVIEW REQUIRED]** The text below was written by an engineer, not a
> lawyer. It has not been reviewed against GDPR, CCPA, TCPA, state two-party
> consent recording laws, or any sector-specific rule such as HIPAA. Do not
> publish it as-is.

**What we do.** When you ask Dial to do something, we use your request and, if
you provide it, your location to find relevant businesses. We then telephone
some of them on your behalf and record what they told us.

**Who we call.** Only businesses relevant to your request, and only as many as
are needed to answer it. We identify ourselves as an AI assistant on every call.

**What we keep.** Your account details, your tasks, the businesses we found, and
what each call established. Call transcripts are kept only for as long as you
choose in Settings, including not at all.

**What we share.** On a call, only the details necessary for your request, and
only within the permissions you have set. We do not sell your data.

**Your control.** You can delete any task, change what Dial is allowed to do
without asking, turn transcript storage off entirely, and delete your account
and all associated data at any time.
