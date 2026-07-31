# Examples

Three worked claims, with the reply to give the user afterwards. Phone numbers come
from the reserved 555-01xx range, so nothing here can ring a real handset.

## 1. A text claiming to be the bank

The customer got a text about a blocked payment with a number to ring. The number
on the back of their card is a different one.

```json
{
  "claim_id": "northbank-text-2026-07-30",
  "customer": { "name": "Fatima Haddad" },
  "claimed_org": {
    "name": "Northbank",
    "trusted_phone": "+14155550100",
    "trusted_number_source": "the number printed on the back of her debit card"
  },
  "contact": {
    "channel": "text",
    "received_at": "2026-07-30T18:12:00-07:00",
    "suspicious_number": "+14155550188",
    "claimed_subject": "a blocked payment on her current account",
    "asked_for": "ring this number and confirm the payment"
  },
  "policy": { "per_call_timeout_seconds": 300, "language": "en-US" }
}
```

Preview first, then show the user what will happen:

```text
I will call Northbank on +14*******00, the number on the back of your card.
I will not call +14*******88, the number in the text.

The call says it is an automated assistant calling for you and asks one question:
did Northbank contact Fatima Haddad in the last hour about a blocked payment.
It gives them nothing else. Shall I place it?
```

Reply on exit 10, outcome `no_such_contact`:

```text
Northbank has no record of contacting you in the last hour about a blocked
payment. Their words: "No, nothing has gone out to that customer today."

Treat the text as fake. Do not ring +14*******88 and do not reply to it. If you
want to report it, call Northbank on +14*******00, the number on your card.
Record hash sha256:9f41c0be...
```

## 2. A voicemail from a delivery firm

The same shape for a different institution. The trusted number came off the printed
delivery note.

```json
{
  "claim_id": "harbour-parcels-vm-2026-07-31",
  "customer": { "name": "Fatima Haddad" },
  "claimed_org": {
    "name": "Harbour Parcels",
    "trusted_phone": "+14155550111",
    "trusted_number_source": "the number on the delivery note left at the door"
  },
  "contact": {
    "channel": "voicemail",
    "received_at": "2026-07-31T09:40:00-07:00",
    "suspicious_number": "+14155550190",
    "claimed_subject": "a missed delivery that needs rebooking",
    "asked_for": "call back to rebook the delivery"
  }
}
```

Reply on exit 0, outcome `confirmed_genuine`:

```text
Harbour Parcels confirmed it. Their words: "Yes, we left a voicemail about a
missed delivery this morning."

Rebook on +14*******11, the number on the delivery note. Keep using that number
rather than the one in the voicemail.
```

## 3. A claim file the app refuses

The customer pasted the whole text message in, including the code the scammer wanted.

```json
{
  "contact": {
    "channel": "text",
    "claimed_subject": "a blocked payment",
    "asked_for": "read back the one time code 481920 to unblock the payment"
  }
}
```

Exit 30, nothing dialled:

```text
one_time_code in contact.asked_for. No call was placed.
```

What you say:

```text
I have not called anybody. The claim file has a one time code in it. The one thing
this must never do is put that on a phone call. Clear that field and I will run it
again. Never read that code to anybody who calls you, including somebody who says
they are the bank.
```

The same refusal fires when the trusted number is missing. It also fires when the
trusted number is the number that made contact:

```text
claimed_org.trusted_phone equals contact.suspicious_number, so nothing was dialled.
The trust anchor is the number printed on the customer's own card or bill, not the
number that contacted them.
```

## Verifying a run afterwards

```bash
node --import tsx src/cli.ts verify --record record.jsonl
```

```text
1 record(s) verified. Chain and verdicts hold.
```

A verdict edited by hand fails here even when the chain still links, because `verify`
recomputes the outcome from the stored evidence with the same functions that ran live.

## What not to do

```text
Bad:  "I called the number in the text and they confirmed it."     (dialled the caller)
Bad:  "They would not confirm, so I tried the main line as well."  (answer shopping)
Bad:  "I read your code to them so they could look it up."         (never)
Bad:  "The bank is real, so the text is genuine."                  (not a contact event)
Good: "refused_to_confirm. Northbank will not discuss your account with an
      assistant. Nothing is proved either way. Call them on the number on your
      card."
```
