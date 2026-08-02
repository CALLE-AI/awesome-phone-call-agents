---
name: accesscall
description: Conduct phone-based accessibility intake interviews for users who cannot complete web-based accessibility audit forms (screen reader fatigue, motor impairment, low vision, cognitive load), and produce a structured result mapped to VPAT 2.4 / Section 508 conformance reporting fields.
license: MIT
---

# AccessCall

[#accesscall](#accesscall)

Use this skill when a user wants to conduct an accessibility intake interview by phone instead of a web form, typically to support a Section 508 or WCAG conformance audit (VPAT 2.4).

Accessibility intake forms are themselves often inaccessible: screen reader fatigue, motor impairment, low vision, or cognitive load can all block someone from completing the exact form meant to capture their barrier report. AccessCall places a short phone call instead, conducts a structured verbal interview, and returns a result that maps onto standard VPAT 2.4 conformance report fields.

## When To Use

[#when-to-use](#when-to-use)

Use this skill for:

- accessibility intake for someone who cannot use a web-based audit form
- gathering verbal barrier reports to populate a VPAT 2.4 / Section 508 audit report
- "call and ask about accessibility issues" or similar one-off outbound intake requests

## When Not To Use

[#when-not-to-use](#when-not-to-use)

Do not use this skill to:

- place a call without the user explicitly confirming the recipient and their intent first
- guess a phone number's country code or region; ask if ambiguous
- call a third party who is not the requesting user without documented prior consent from that person
- auto-populate a VPAT row when the follow-up contact was never confirmed back to the caller (see Safety Rules)
- treat the auto-selected WCAG criterion row as final without human review; matching is done at the WCAG principle level (Perceivable / Operable / Understandable / Robust), not the specific success criterion

## Setup

[#setup](#setup)

`scripts/format-to-vpat.js` depends on `docx`, `jszip`, and `xml-js` (declared in `package.json`). Run `npm install` inside `skills/accesscall/` before using it — without this step it fails immediately with `Cannot find module 'jszip'`. `scripts/parse-recap.js` and `scripts/phone-utils.js` have no external dependencies and need no install step.

## Core Workflow

[#core-workflow](#core-workflow)

1. Confirm required inputs: recipient phone number, product or site name being audited, preferred language (default English, US). Ask for anything missing; do not fabricate a phone number or product name.
2. Validate the phone number against E.164 (`scripts/phone-utils.js`, `isE164`/`assertE164`) before calling `plan_call`. If it does not match E.164 format, reject it and ask the user to correct it — do not reformat, guess a country code, or silently pass a malformed number through to `plan_call`.
3. Call `plan_call` with the goal built from `references/call-task-template.md`, filling in `recipient_name` and `product_or_site_name`. Always pass the user's latest message verbatim via `user_input` even when other fields are set.
4. Show the `confirm_summary` to the user and wait for explicit confirmation. Do not call `run_call` until the user confirms.
5. Call `run_call` with the `confirm_token` exactly as received. Never call it more than once for the same `plan_id`.
6. Poll `get_call_run` every 1-3 seconds while the run is active, then slow down, until a terminal status.
7. This MCP server's `plan_call` has no schema-input parameter for structured extraction (verified against its `inputSchema`). Instead, the call goal (`references/call-task-template.md`) instructs the bot to recap its own answers in a fixed, labeled format at the end of the call. Parse that recap from the transcript using `scripts/parse-recap.js`, which extracts the labeled lines and validates the result against `references/intake-result.schema.json` before returning it.
8. If parsing/validation fails — including when the recap never happened because the crisis-safety override in `references/call-task-template.md` triggered — do not guess field values. Report the crisis disclosure (if that's what happened) as its own distinct, clearly flagged outcome, or otherwise surface the raw transcript.
9. If `followup_contact` is present, it must only be trusted when `followup_contact_confirmed` is `true`, meaning the bot spelled the contact back letter-by-letter and the caller explicitly confirmed it. If not confirmed, do not carry it into VPAT output; note "Contact unconfirmed, verify manually" instead.
10. Optionally run `scripts/format-to-vpat.js` to insert the validated result into a VPAT 2.4 template as a new row. Every auto-matched row (matched at the WCAG principle level, not the specific success criterion) gets an "AUTO-MATCHED AT PRINCIPLE LEVEL, HUMAN REVIEW REQUIRED BEFORE AUDIT USE" note in Remarks, so it can never be mistaken for a final placement.

## Safety Rules

[#safety-rules](#safety-rules)

- Never place a call without the user explicitly confirming the recipient and intent first. Setup/verification steps must never trigger `run_call`.
- Never guess a phone number's country code or region.
- Reject any phone number that fails E.164 validation (`scripts/phone-utils.js`) before it ever reaches `plan_call`; ask the user to correct it instead of silently passing it through.
- Mask phone numbers in any logged output or printed summary (e.g. `+1585414****`, via `scripts/phone-utils.js`'s `maskPhone`) — the only place the full, unmasked number belongs is the actual `plan_call`/`run_call` API invocation itself.
- Never call a third party without documented prior consent from that person.
- A confirmed contact detail (email or phone for follow-up) requires an explicit letter-by-letter spell-back and a "yes" from the caller. Testing showed the STT layer can introduce transcription errors (e.g. inserting a duplicate word into a domain); the spell-back is a mitigation, not a guarantee, since a caller can still mishear their own readback and confirm an incorrect value. Document this limitation to the end user rather than presenting the mechanism as fully reliable.
- Auto-matched VPAT rows are matched at the WCAG principle level only. Flag rows for manual review rather than guessing the exact success criterion — `scripts/format-to-vpat.js` always writes an explicit "AUTO-MATCHED AT PRINCIPLE LEVEL, HUMAN REVIEW REQUIRED BEFORE AUDIT USE" note into Remarks for these rows.
- If the caller discloses anything suggesting self-harm, suicidal ideation, or a crisis during the call, the accessibility interview must stop — this is a required override in `references/call-task-template.md`, not optional bot judgment. Do not attempt to extract intake fields from that call. Report it to the user as a distinct, clearly flagged outcome, not as a normal or partial intake result.
- Do not expose auth tokens, confirmation tokens, or credentials in any output.

## Known Limitations

[#known-limitations](#known-limitations)

- This skill supports one-off calls only. There is no recurring or scheduled-call capability.
- There is no mid-call cancellation path. Once `run_call` starts, the call runs to a terminal status (`COMPLETED`, `NO_ANSWER`, `DECLINED`, `FAILED`, etc.) — it cannot be stopped or cancelled from within this skill while in progress.

## Output Format

[#output-format](#output-format)

After a completed call, report:

- call status and duration
- the recipient's phone number, masked (e.g. `+1585414****`) — never print the full number in a summary
- the parsed structured result (assistive technology, task attempted, barrier category, severity, consent to follow-up)
- whether follow-up contact was confirmed
- if a VPAT insertion was run, which template row was modified, its new values, and that it is an auto-match requiring human review before audit use

If the call did not complete (no answer, declined, failed), report the status plainly and do not fabricate a result.

If the caller disclosed a self-harm/suicidal-ideation/crisis situation, report that as its own distinct, clearly flagged outcome instead of an intake result — do not attempt to backfill or guess the intake fields that weren't asked.

## References

[#references](#references)

- [`references/call-task-template.md`](references/call-task-template.md) — the call goal template with placeholders
- [`references/intake-result.schema.json`](references/intake-result.schema.json) — structured result schema
- [`references/example-output.json`](references/example-output.json) — example parsed result
- [`scripts/parse-recap.js`](scripts/parse-recap.js) — extracts the labeled recap from a transcript and validates it against the schema
- [`scripts/phone-utils.js`](scripts/phone-utils.js) — E.164 validation and phone-number masking
- [`scripts/format-to-vpat.js`](scripts/format-to-vpat.js) — inserts a validated result into a VPAT 2.4 docx template (see Setup above: requires `npm install` first)
- [`package.json`](package.json) — declares `format-to-vpat.js`'s dependencies (`docx`, `jszip`, `xml-js`)
- [`assets/vpat-2.4-template-generic.docx`](assets/vpat-2.4-template-generic.docx) — genericized VPAT 2.4 template with placeholder preparer/contact fields
