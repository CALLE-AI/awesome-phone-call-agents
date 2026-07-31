# Examples

Three worked claims, with the reply to give the user afterwards. Phone numbers come
from the reserved 555-01xx range, so nothing here can ring a real handset.

## 1. A voicemail claiming to be the credit union

The customer got a voicemail about a blocked card with a number to ring back. The
number on the back of the card is a different one. This is the file the app ships as
`examples/claim.example.json`.

```json
{
  "claim_id": "northgate-voicemail-0912",
  "customer": {
    "name": "Dana Whitfield"
  },
  "contact": {
    "claimed_to_be": "Northgate Credit Union",
    "channel": "voicemail",
    "arrived_at": "2026-07-31T09:12:00-07:00",
    "claimed_about": "a card that had been blocked",
    "number_shown": "+14155550188",
    "asked_for": "ring back on that number and read out the card number to unblock the card"
  },
  "trusted_number": {
    "phone": "+14155550100",
    "printed_on": "the back of the debit card",
    "region": "US"
  },
  "policy": {
    "per_call_timeout_seconds": 240,
    "recent_window_minutes": 60,
    "language": "en-US",
    "min_confidence": 0.5
  }
}
```

Preview first, then show the user what will happen:

```text
I will call Northgate Credit Union on +14*******00, the number printed on the back
of the debit card. I will not call +14*******88, the number in the voicemail.

The call says it is an automated assistant calling for you, then asks one question:
did Northgate Credit Union contact Dana Whitfield in the last hour about a card that
had been blocked. It never mentions the card number they asked for. Shall I place it?
```

Reply on exit 10, outcome `no_such_contact`:

```text
Northgate Credit Union has no record of contacting you in the last hour about a
blocked card. Their words: "No, nothing has gone out to that member today."

Treat the voicemail as fake. Do not ring +14*******88 and do not read your card
number to anybody. If you want to report it, call Northgate Credit Union on
+14*******00, the number on the back of your card.
Record hash sha256:9f41c0be...
```

## 2. A text message from a delivery firm

The same shape for a different institution. `policy` is left out, so the defaults
apply: a sixty minute window, a four minute call, `en-US` and a confidence floor of
0.5.

```json
{
  "claim_id": "harbour-parcels-text-0940",
  "customer": { "name": "Dana Whitfield" },
  "contact": {
    "claimed_to_be": "Harbour Parcels",
    "channel": "text_message",
    "arrived_at": "2026-07-31T09:40:00-07:00",
    "claimed_about": "a missed delivery that needs rebooking",
    "number_shown": "+14155550190",
    "asked_for": "follow a link and pay a redelivery fee"
  },
  "trusted_number": {
    "phone": "+14155550111",
    "printed_on": "the delivery note left at the door"
  }
}
```

Reply on exit 0, outcome `confirmed_genuine`:

```text
Harbour Parcels confirmed it. Their words: "Yes, we texted about a missed delivery
this morning."

Rebook on +14*******11, the number on the delivery note. Keep using that number
rather than the one in the text. Record hash sha256:9f41c0be...
```

## 3. A claim file the app refuses

The customer pasted the whole text message in, including the code the scammer wanted.

```json
{
  "contact": {
    "channel": "text_message",
    "claimed_about": "a blocked payment",
    "asked_for": "read back the one time code 883021 to unblock the payment"
  }
}
```

Exit 30, nothing dialled. The refusal names the field (`contact.asked_for`), gives the
kind (a one time code), masks the value and ends with "No call was placed." It never
repeats the code it is refusing to carry.

What you say:

```text
I have not called anybody. The claim file has a one time code in it. The one thing
this must never do is put that on a phone call. Clear that field and I will run it
again. Never read that code to anybody who calls you, including somebody who says
they are the bank.
```

The same refusal fires when `trusted_number.phone` is missing. It also fires when
`contact.number_shown` is that same number. The message says why: a message spoofing
the printed number would be checked by calling itself.

```text
The number that contacted the customer is the same number as trusted_number.phone,
so there is nothing left to verify against: a message spoofing the printed number
would be checked by calling itself. Read the number printed on the card or the bill
by hand, put that in trusted_number.phone, then run this again. No call was placed.
```

## Verifying a run afterwards

```bash
npm run vcc -- verify --record record.jsonl
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
Good: "refused_to_confirm. Northgate Credit Union will not discuss your account
      with an assistant. Nothing is proved either way. Call them on the number on
      your card."
```
