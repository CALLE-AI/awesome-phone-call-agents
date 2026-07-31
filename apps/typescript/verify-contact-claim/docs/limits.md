# Scope and limits

## The window this fits

This app is for a voicemail, a text or a missed call asking you to ring back. It is
not a rescue while a scam call is live.

Our own call takes minutes. CALL-E has to queue it, dial it, wait for somebody to
pick up, get through a menu, ask the question then finish. Anybody standing on the
line with a caller pressing them to move money does not have those minutes. The right
answer there is to hang up rather than to start a second call. So the case this fits
is the one that arrives and waits: a message left on the handset, a text, a missed
call with a number to ring. The default window in the question is the last 60 minutes,
which is the shape of that case.

## A refusal is the expected answer with a bank

`refused_to_confirm` is not a failure and it is not the institution being difficult.

Under Regulation P the bare fact that somebody is a customer is protected: 12 CFR
1016.3(q)(2)(i)(C) counts the fact that an individual is or has been one of your
customers as personally identifiable financial information, then 12 CFR 1016.10(a)(1)
bars disclosing that to a nonaffiliated third party outside the notice and opt out
machinery. A machine ringing on a customer's behalf is a third party. A clinic is
harder again: confirming it called a named person reveals that the person is a
patient, so HIPAA at 45 CFR 164.514(h)(1)(i) makes a covered entity verify the
identity and the authority of whoever is asking, which is not something this app can
hold.

Two honest notes on that. First, no institution we looked at publishes a policy on
confirming an outbound contact to a third party, so this is the general rule read
onto our case rather than a published refusal we can quote. Second, what the phone
agent in front of you does on the day is their judgement. Some will answer. The
design does not depend on which way it goes.

That is why the app is built to be useful when the answer is no. Every outcome ends
with the number printed on the customer's own card, so a refusal still leaves them
holding the one number worth ringing.

## What each answer is worth

- `confirmed_genuine` means somebody at the institution said the contact was theirs.
  It does not make the number in the message safe to call back. Nobody legitimate
  needs a full card number, a PIN or a one time code on a call the customer did not
  start.
- `no_such_contact` is the strongest result this app produces. Nobody there has a
  record of the contact, so the message should be treated as a scam.
- `refused_to_confirm` verifies nothing either way. It is still an answer.
- `unreachable` and `outcome_unknown` verify nothing at all. They are reported as
  such, never softened into a denial.

## What an operator has to supply

47 CFR 64.1200(b)(2) requires an artificial voice message to state a telephone number
for the party responsible for the call. That number may not be the dialler's own line.
The responsible party here is the customer, not the machine, so a live run has to set
`customer.callback_number` to a number that customer will actually answer. It is the
one number the script reads out loud, digit by digit.

47 CFR 64.1200(b)(1) wants the opening to say who is responsible. The script does
that in its first sentence and says it is not a person.

This app cannot check that the callback number belongs to the customer, that the
trusted number was really read off their card or that the number that made contact was
not theirs. Those three facts come from whoever wrote the claim file. The app checks
what it can: the number that made contact is never the number dialled, nothing the
caller asked for is repeated on the line, no persona is carried.

## Where the detectors stop

The scan over the claim file is pattern based. It catches the realistic mistakes: a
card number pasted out of a text message, a code copied from an app, a persona written
into a field, an instruction to say you are the customer. It cannot catch a secret
written as ordinary prose. It is a safety net rather than a proof, so read the preview.

The scan also reads values rather than subject matter, on purpose. Somebody writing
down what a scam asked them for has to be able to say "they wanted my card number"
without the app refusing to help.

## What has never been tested live

No live call has been placed from this branch. There is no CALL-E account behind it.

Everything in the test suite, the demo and the output quoted in the README comes from
`fake/calle-server.ts`, a local server that speaks the documented wire contract over
loopback: snake_case payloads, 201 on create, `Idempotency-Key` handling, the error
envelope, the terminal statuses. That exercises this app's own logic properly. It does
not prove anything about the real service. Transcript shapes, failure codes and
confidence scores from production may differ from the fake, so treat the first live
run as the real test.

## What this is not

- Not a scam classifier. It asks one institution one question about one contact.
- Not a blocklist or a reputation lookup. It does not score a number.
- Not a report to anybody. Nothing is filed, nothing is blocked.
- Not legal advice. The rules cited above explain why an institution may refuse. They
  are not a reading of anybody's obligations.
