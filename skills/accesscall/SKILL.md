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
3. Call `plan_call` with the goal built from `references/call-task-template.md`, filling in `recipient_name` and `product_or_site_name`. Do not forward the user's full latest message verbatim via `user_input` by default — that field exists on `plan_call` for resolving an ambiguous/malformed phone number, not as a general passthrough. Only populate `user_input` when there's an actual number to disambiguate, and even then pass just the relevant phone-number text, not the user's entire message. The `goal` string alone carries `recipient_name`/`product_or_site_name`/language into the call.
4. Show the `confirm_summary` to the user and wait for explicit confirmation. Do not call `run_call` until the user confirms.
5. Immediately before calling `run_call`, acquire the dispatch lock (`scripts/call-lock.js`, `acquireLock`) keyed on the recipient's phone number and the purpose `"accesscall-intake"`. If a call to this recipient was already dispatched within the lock window (default 10 minutes) — including a retry after a crash or timeout, which will see the same lock a first attempt wrote — refuse to place another and ask the user to explicitly confirm an override before retrying.
6. Call `run_call` with the `confirm_token` exactly as received. Never call it more than once for the same `plan_id`.
7. Poll `get_call_run` every 1-3 seconds while the run is active, then slow down, until a terminal status.
8. This MCP server's `plan_call` has no schema-input parameter for structured extraction (verified against its `inputSchema`). Instead, the call goal (`references/call-task-template.md`) instructs the bot to recap its own answers in a fixed, labeled format at the end of the call. Parse that recap from the transcript using `scripts/parse-recap.js`, which only reads lines attributable to the bot's own final speaking turn (never anything the caller said) and validates the result against `references/intake-result.schema.json` before returning it.
9. If parsing/validation fails — including when the recap never happened because the crisis-safety override in `references/call-task-template.md` triggered, or because the recap couldn't be cleanly attributed to the bot — do not guess field values. Report the crisis disclosure (if that's what happened) as its own distinct, clearly flagged outcome. Otherwise, surface a redacted excerpt of the transcript via `scripts/redact-transcript.js` — never the raw, unredacted transcript, which may contain the caller's spoken phone number or email address.
10. If `followup_contact` is present, it must only be trusted when `followup_contact_confirmed` is `true`, meaning the bot spelled the contact back letter-by-letter and the caller explicitly confirmed it. If not confirmed, do not carry it into VPAT output; note "Contact unconfirmed, verify manually" instead.
11. Optionally run `scripts/format-to-vpat.js` to insert the validated result into a VPAT 2.4 template as a new row. Every auto-matched row (matched at the WCAG principle level, not the specific success criterion) gets an "AUTO-MATCHED AT PRINCIPLE LEVEL, HUMAN REVIEW REQUIRED BEFORE AUDIT USE" note in Remarks, so it can never be mistaken for a final placement.

## Safety Rules

[#safety-rules](#safety-rules)

- Never place a call without the user explicitly confirming the recipient and intent first. Setup/verification steps must never trigger `run_call`.
- Never guess a phone number's country code or region.
- Reject any phone number that fails E.164 validation (`scripts/phone-utils.js`) before it ever reaches `plan_call`; ask the user to correct it instead of silently passing it through.
- Mask phone numbers in any logged output or printed summary (e.g. `+1585414****`, via `scripts/phone-utils.js`'s `maskPhone`) — the only place the full, unmasked number belongs is the actual `plan_call`/`run_call` API invocation itself.
- Never forward the user's full latest chat message to `plan_call`'s `user_input` by default. Only pass the minimum text needed, and only when actually needed to resolve an ambiguous or malformed phone number.
- Acquire the dispatch lock (`scripts/call-lock.js`) immediately before every `run_call` and honor it, including on retries after a crash or timeout. Never place a duplicate call to the same recipient within the lock window (default 10 minutes) without an explicit user override.
- Never surface a raw, unredacted transcript to the user as a validation-failure fallback. Redact it first (`scripts/redact-transcript.js`, which masks phone numbers and email addresses) — it does not detect spoken street addresses, so treat its output as a partial, not complete, redaction.
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
- [`scripts/parse-recap.js`](scripts/parse-recap.js) — extracts the labeled recap from a transcript (bot-attributed final turn only) and validates it against the schema
- [`scripts/phone-utils.js`](scripts/phone-utils.js) — E.164 validation and phone-number masking
- [`scripts/call-lock.js`](scripts/call-lock.js) — durable, file-based dispatch lock preventing a duplicate call to the same recipient within a time window
- [`scripts/redact-transcript.js`](scripts/redact-transcript.js) — masks phone numbers and email addresses in a transcript before it's shown to a user
- [`scripts/format-to-vpat.js`](scripts/format-to-vpat.js) — inserts a validated result into a VPAT 2.4 docx template (see Setup above: requires `npm install` first)
- [`package.json`](package.json) — declares `format-to-vpat.js`'s dependencies (`docx`, `jszip`, `xml-js`)
- [`assets/vpat-2.4-template-generic.docx`](assets/vpat-2.4-template-generic.docx) — genericized VPAT 2.4 template with placeholder preparer/contact fields
