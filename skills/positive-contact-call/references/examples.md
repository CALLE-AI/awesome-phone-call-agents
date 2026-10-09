# Examples

Three worked examples. Numbers are fictional (`+1<area>555 01XX`), and every address is
in the `example.com` family.

---

## Example 1: a live person acknowledges the notice

### Operator request

> Northbay Power is running a Public Safety Power Shutoff tomorrow. Call Maria on the
> Medical Baseline roster and confirm she has heard the notice. Her number is
> +14155550101, timezone America/Los_Angeles, locale en-US, service address the 1200 block
> of Elm St. The window is 2026-09-11 18:00 to 2026-09-12 20:00 Pacific, and the
> field-visit cutoff is 2026-09-11 12:00 Pacific. Send the report to
> operations@example.com.

### Preview, before anything is dialled

```text
PositiveContact preview
  contact            pc-001 (Maria)
  number             +1415•••0101
  timezone           America/Los_Angeles
  local time now     08:00 (callable, quiet hours are 21:00 to 08:00)
  locale             en-US (supported)
  step               1 of 4, target primary
  idempotency key    pc:psps-demo-2026-09:pc-001:1:primary
  field-visit cutoff 2026-09-11T12:00:00-07:00 (4h 0m from now)
  decision           OK to call
```

The exact call text is printed underneath. The operator confirms in words.

### Result

```json
{
  "contact_type": "live_person",
  "acknowledged": "yes",
  "spoke_with": "customer",
  "needs_assistance": "resource_center_info",
  "callback_window": "",
  "preferred_language": "",
  "notify_alternate_contact": "unknown",
  "notes_for_human": "Asked where the resource center is."
}
```

Transcript, abbreviated:

```text
+0s   bot   This is an automated safety notification from Northbay Power about a possible
            Public Safety Power Shutoff. This call may be recorded. Am I speaking with
            Maria or someone in the household?
+7s   user  This is Maria speaking.
+14s  bot   Power at the 1200 block of Elm St may be turned off starting Friday September
            11 at 6:00 PM PDT ... Can you confirm that you heard it?
+21s  user  Yes, I heard you. When will it come back on?
```

### Disposition

```text
disposition   CONFIRMED
reason        live_human_acknowledged_with_transcript_evidence
confidence    0.93 (high), gate 0.80
judge A       live_person/yes  (structured_result)
judge B       live_person/yes  (acknowledgement_in_transcript, turn 3, +21s)
evidence      "Yes, I heard you. When will it come back on?"
```

All four conditions held: live person, acknowledged, confidence at the gate, and the
transcript independently carried the acknowledgement after the notice turn. The ladder
stops here.

Note what was **not** treated as the acknowledgement: "This is Maria speaking" at +7s
contains no acknowledgement of the notice, and it came before the notice was delivered. An
acknowledgement only counts after the notice turn.

---

## Example 2: voicemail, which is not contact

### Operator request

> Same event. Call Dolores, +14155550106, America/Los_Angeles, en-US, 950 block of Maple
> Dr.

### Result

```json
{
  "contact_type": "voicemail",
  "acknowledged": "unknown",
  "spoke_with": "unknown",
  "needs_assistance": "unknown",
  "notes_for_human": ""
}
```

Transcript:

```text
+0s   bot   This is an automated safety notification from Northbay Power ...
+7s   user  You have reached the voicemail of this number. Please leave a message after
            the tone.
+14s  bot   This is an automated safety notification from Northbay Power. Power in your
            area may be turned off starting Friday September 11 at 6:00 PM PDT to reduce
            wildfire risk. Please call us back or visit a Community Resource Center.
            Thank you.
```

### Disposition

```text
disposition   UNCONFIRMED
reason        voicemail_notice_left_not_confirmation
judge A       voicemail/unknown  (structured_result)
judge B       voicemail/no       (machine_greeting_detected, turn 1, +7s)
next step     step 2, primary, in 45 minutes, at 08:45 local
```

The notice was left. Nobody heard it, as far as anybody can prove. This counts in the
report under "voicemail only", never under "confirmed".

The important variant: had the structured result instead claimed
`contact_type: live_person, acknowledged: yes` over this same transcript, the disposition
would be `NEEDS_HUMAN` with reason
`contradiction_voicemail_greeting_vs_acknowledged`. The machine greeting wins, because a
recording cannot acknowledge anything.

---

## Example 3: a medical question, which the call must refuse to answer

### Operator request

> Same event. Call Walter, +14155550109, America/Los_Angeles, en-US, 540 block of Willow
> St. Route anything he needs to the duty coordinator at coordinator@example.org.

### Result

```json
{
  "contact_type": "live_person",
  "acknowledged": "yes",
  "spoke_with": "customer",
  "needs_assistance": "medical_question",
  "callback_window": "this afternoon",
  "preferred_language": "",
  "notify_alternate_contact": "unknown",
  "notes_for_human": "Asked what to do about powered medical equipment. Routed to a human; no advice given."
}
```

Transcript, abbreviated:

```text
+21s  user  Yes, I heard you. I run an oxygen concentrator at night. What am I supposed
            to do about that?
+28s  bot   I am not able to advise on medical equipment. A member of our team will call
            you back about that. The Community Resource Center at the Glen Ellen Community
            Hall will be open during the outage.
+35s  user  Alright, please have somebody call me.
```

### Disposition

```text
disposition   NEEDS_HUMAN
reason        medical_question_priority_review
contact_type  live_person
acknowledged  yes
callback      this afternoon
```

Walter did acknowledge the notice, and the report counts him under "live human reached".
He is still not closed out automatically, because he asked a question the call was not
allowed to answer and is now waiting on a person.

Three things to notice:

1. The call gave no advice, no reassurance, and no estimate of how long equipment would
   run. It said a person would call back, and it ended.
2. `notes_for_human` routes the question without recording the health fact. "Powered
   medical equipment" is what the operator needs to triage. The specific device is not
   stored in any field.
3. The review item is still on the clock. If nobody resolves it before the field-visit
   cutoff, it becomes a field visit. Human review pauses automation, never the deadline.

---

## What a caller may not do in any of these

- Confirm a contact from a voicemail, however clear the message left.
- Confirm a contact on a structured result alone, with no supporting transcript span.
- Redial a wrong number, a refusal, or a language barrier.
- Answer the medical question, even partially, even to be kind.
- Promise a field visit, a callback, or a restoration time. Those are handed to a person.
- Cancel a call that has already been submitted. There is no cancel endpoint.
