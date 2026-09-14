# Examples

Every merchant, order, dispute and phone number below is fictional. Numbers come from the reserved
+1 NPA-555-01XX range, and conversations are synthetic.

## Grounded yes: filed as customer communication

Example Outfitters, order 1042, dispute `du_demo_1042`, customer on record +1 212-555-0101.

```text
caller    Hello, this is an automated assistant calling on behalf of Example Outfitters about
          your order 1042. This call may be recorded.
caller    Did you receive the order?
customer  Yes, I got them last week.
caller    Do you recognise the charge for that order?
customer  Yes, that charge is mine.
```

The provider reports `received=yes` and `recognises_charge=yes`. The disclosure was spoken, the call
completed with confidence 0.93, and each yes matches the customer's own answer. The call is
usable, both answers are accepted, and the evidence document is filed as customer communication.

## Structured yes the customer never said: not filed

```text
caller    Did you receive the order?
customer  Sorry, who is this?
caller    Do you recognise the charge for that order?
customer  Can you call me later?
```

The provider still reports `yes` twice. No customer turn says yes, so both `*_grounded` checks fail
and both answers stay `unknown`. Nothing is filed. A shaped result is a claim, not evidence.

## No disclosure: not usable

The opening says "Hello, I'm calling on behalf of Example Outfitters about your order 1042." and
never says the call is automated. Even though the customer then says yes twice, `disclosure_spoken`
fails, the call is unusable, and nothing is accepted.

## Customer says no: the filing stops

```text
caller    Did you receive the order?
customer  No, nothing arrived.
```

The provider reports `received=no`. A reported no stops the filing even if it could not be matched
to the transcript: a yes needs the customer's words, a no only needs to be possible. A person
reviews the dispute before anything else happens, and the customer is not called again.

## Customer declines: not used, not redialled

The customer says "I don't want to talk about this. Please end the call." and the caller ends the
call. The provider reports `declined_to_talk=yes`. `customer_willing` fails, nothing is used, and
the dispute is not called again.

## No answer: not used, not redialled

The call ends `failed` with `no_answer` and no transcript. Nothing is filed and nothing redials on
its own. A second attempt is a new, deliberate operator decision, and it is refused anyway while
the dispute already has a call on file.

## Refused before dialling

A live run at 23:00 in New York for +1 212-555-0101 without operator intent and without the number
on the allowlist is refused with every reason at once:

```text
Not calling:
  - CALL_WITHOUT_OPERATOR_INTENT: a live call needs the operator's intent on this run: pass --i-have-consent
  - CALL_DESTINATION_NOT_AUTHORIZED: +12*****0101 is not listed in REBUTTAL_CALL_ALLOWLIST
  - CALL_OUTSIDE_LOCAL_HOURS: 23:00 in America/New_York is outside 08:00-21:00
```

No request reaches the provider, so there is nothing to cancel.

## The caller asks for card data: unusable

A caller turn such as "Can you read me the card number?" fails `no_payment_data_requested`. The call
is unusable whatever the customer said, and the script or provider configuration is investigated
before any further call.
