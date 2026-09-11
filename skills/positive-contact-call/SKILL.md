---
name: positive-contact-call
description: Place one disclosed critical-notice phone call and confirm that a live human acknowledged it, treating voicemail as unconfirmed. Use when a notice has to be heard by a person rather than merely delivered, such as a utility shutoff, a boil-water advisory, or a recall affecting people who depend on the service. Returns a fail-closed disposition with transcript evidence and hands every commitment to a human.
---

# Positive contact call

Some notices are not delivered until a person has heard them. A utility running a Public
Safety Power Shutoff must confirm **positive contact** with customers on medical
equipment programs: a real person heard the notice. A voicemail is not positive contact. A
text is not positive contact. An unanswered call is not positive contact. When contact
cannot be confirmed before the deadline, somebody has to drive to the door.

This skill places one such call and returns a disposition you can defend.

**The one rule: a contact is confirmed only when transcript evidence shows a human
acknowledged the notice. Every other outcome moves the escalation ladder forward.**

## When to use this

- A critical notice must reach a person before a deadline, and "we called them" is not
  good enough.
- Somebody has to account afterwards for who was reached and who was not.
- The recipient may ask questions the notice should answer, and may ask questions it must
  refuse to answer.

## When not to place the call

Check all of these before dialling. Each one is a refusal, not a warning.

| Condition | What to do instead |
| --- | --- |
| The number is not already in E.164 form | Refuse. Never add a country code, strip punctuation, or otherwise repair a number |
| No IANA timezone for the recipient | Refuse. Never infer a timezone from a phone number, country code, or locale |
| Local time is inside quiet hours | Schedule for the first callable minute, unless the policy carries an explicit emergency override |
| The recipient's language is not supported on the destination line | Open a bilingual human callback. Do not call them in a language they did not ask for |
| The step cannot complete before the field-visit cutoff | Skip straight to the field-visit queue. Do not start a call whose result arrives too late to matter |
| No recorded authorization to call this number for this notice | Refuse |
| The number was retired after a wrong-number outcome, or the recipient refused | Refuse. These never redial |

## Workflow

### 1. Gather what the call needs

Required: the issuing organisation's name, the notice window (start and end, with
timezone offsets), the deadline after which a physical visit is required, the recipient's
first name, their number in E.164, their IANA timezone, their locale, and a short service
address such as "1200 block of Elm St". Optional: an alternate contact number, and the
location and hours of any resource centre.

Ask for anything missing. Do not fill a gap with a default.

### 2. Preview without calling

Run `scripts/preview.py` with the contact and event as JSON on standard input. It prints
the masked plan, the exact words the call will use, and any reason the call should not be
placed. It never opens a network connection.

```bash
python3 scripts/preview.py < contact.json
```

Show the operator that output verbatim. It is the last point at which a mistake is free.

### 3. Get explicit confirmation

A real call is a real-world side effect on a person who did not ask to be called. Show
the masked number and the exact task text, then wait for the operator to confirm in
words. Do not treat "go ahead with the plan" from earlier in a conversation as
confirmation of this specific call.

### 4. Place exactly one call

- One recipient per call. Never batch.
- Derive the idempotency key from what was authorized, not from the attempt:
  `pc:{event_id}:{contact_id}:{ladder_step}:{target}`. A retry reuses the key. A new
  random key per attempt silently disables the protection.
- Persist the intent, with its key, **before** sending anything.
- Send the recipient result schema in `references/result-schema.md`.
- Put correlation ids in `metadata` so the result can be bound back to the intent.
- Once the call id comes back, the call cannot be cancelled. There is no cancel endpoint.
  "Stop" from here means "stop scheduling more calls", never "stop the call in flight".

### 5. Adjudicate fail-closed

Treat a webhook as a wake-up only. Re-read the call by id and adjudicate that read.

Confirm the contact only when **all four** hold:

1. The structured result says a live person answered.
2. The structured result says they acknowledged the notice.
3. Completion confidence is at the gate: label `high`, or score at or above the threshold.
4. The transcript independently contains the acknowledgement, in a recipient turn that
   comes after the notice was delivered.

Anything else advances the ladder or opens human review. In particular:

- A recipient turn matching an answering-machine greeting means voicemail, whatever the
  structured result claims. A structured result claiming a live acknowledgement over a
  machine greeting is a contradiction and goes to a human.
- A missing, malformed, or null result goes to a human. It is never read optimistically.
- A medical question outranks everything: route it to a person, record that it happened,
  and give no advice.

`references/escalation-policy.md` has the full ladder and the disposition table.

### 6. Hand every commitment to a human

The skill may report. It may not promise. A field visit, a callback, a bilingual
follow-up, a number retirement: prepare each one and hand it to a person to approve.
Return the disposition, the reason code, and the transcript spans that produced it, so
the person deciding can see what the machine saw.

## What the call may and may not say

Read `references/safety.md` before writing any call text. In short: disclose who is
calling, that the call is automated, and that it may be recorded, before anything else.
Never ask for an account number, a payment, or an identifying detail. Never give medical,
legal, or financial advice. Never store a condition, device, diagnosis, or medication.

## Reference files

- `references/safety.md` - disclosure, the never-ask rules, the medical boundary, masking,
  retention, and why the call is deliberately easy to tell apart from a scam.
- `references/result-schema.md` - the recipient result schema, the fields that must never
  be used, and the strict local validation that runs after the call.
- `references/escalation-policy.md` - the ladder, quiet hours, the cutoff, and the full
  disposition table.
- `references/examples.md` - three worked examples: a confirmation, a voicemail, and a
  medical question.

## Helper script

- `scripts/preview.py` - standard library only, places no call, prints the masked plan and
  the exact call text for one contact.

## A runnable implementation

`apps/python/positive-contact` implements this workflow end to end for a Public Safety
Power Shutoff: preflight, ledger, escalation ladder, judge ensemble, operator dashboard,
approval-gated field-visit work orders, and a report whose every count carries its
denominator. It runs in fixture mode by default and places no calls.
