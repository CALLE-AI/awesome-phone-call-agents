# The disclosure budget

Delegating a phone call means handing somebody the right to say things about you.
This app treats that as a budget with a fixed list and checks it three times.

## Gate 1, the request file

Runs when the errand file is loaded, before anything else.

- A `disclosure` item whose key or label looks like a payment card, a card
  verification value, a PIN, a password, a national identifier, a sort code, a
  routing number, an IBAN or an account number is refused. So is any value that
  passes a Luhn check at card length. There is no flag to override it. A delegated
  errand does not need a card number and an app that will read one out loud is a
  worse idea than an inconvenient one.
- A question is text that will be spoken, so it goes through the same detectors as
  the script. `Is her file under 123-45-6789?` is refused with a message that says
  what to do: put it in `disclosure` if the callee may hear it or take it out.

## Gate 2, the script

Runs after the script is generated and before any call is created. The script is
built from the goal, the questions, the windows and the budget, so a finding here
means a detail arrived through a field nobody checked, usually the goal summary.

A finding at `block` severity refuses the errand. `runErrand` throws, the CLI exits
30 and no call is created. The demo shows this with `calls placed: 0`.

## Gate 3, what was actually said

Runs on the caller's own turns after the call. This is the gate that catches the
thing you cannot test for in advance: a caller that volunteers a detail it was
given for a different field or repeats something the callee asked for.

It does not undo anything. The call already happened. What it does is tell the
person whose detail it was, in the report, in the same place they read the answers.

## What the detectors catch

| Kind | Severity | Example |
| --- | --- | --- |
| email address | refuse | `fatima.haddad@example.com` |
| national identifier | refuse | `123-45-6789` |
| identifier | refuse | `AB-994512`, `PT88213` |
| street address | refuse | `42 Bayview Street` |
| long number | refuse | `4915 6612 3300` |
| date | report only | `2026-08-12`, `12/08/2026` |
| clinical, legal or financial wording | report only | `biopsy`, `eviction`, `arrears` |

Specific detectors claim a token first, so `123-45-6789` is a national identifier
rather than a long number and `2026-08-12` is a date rather than either. A date on
its own is usually an appointment, not a birthday, so it is reported and left to
the person rather than blocking the call.

The number being called and any number in the budget are stripped before the
checks run, in national form as well as full form, because that is how people say a
number out loud.

## What is not sent at all

`on_behalf_of.reason_for_delegation` is the consent record, not part of the call.
"She is deaf and this clinic takes bookings by phone only" is a disability
disclosure. No callee needs it to answer a question about appointments. It is
printed in the preview, marked as staying local, then dropped: it never reaches the
task, the metadata or the transcript. The only things about the person that go out
are their name and the disclosure list.

It is inside the preview receipt, because the receipt has to cover what the preview
showed. That is a hash computed on this machine and compared on this machine, so
the field is bound to the consent without ever leaving.

## The sensitive topic warning

Clinical, legal and financial subject matter can walk in through `goal.summary` or
a question. None of it looks like an identifier. So the goal and every question are
scanned for that kind of wording and any hit is printed in the preview, next to the
field it came from, before anybody consents.

It warns and never blocks. "Book a routine check-up" is the errand, so a gate that
refused clinical words would refuse the app's own example. What the warning is for
is the sentence somebody wrote without thinking: put the words in front of them
while nothing has been sent yet.

It is a keyword list, so be honest about the size of it. "She has been unwell since
the spring" trips nothing and no list of words will ever catch that. The defence
there is the script, which refuses to discuss anything but the errand, plus the
preview, which shows the whole script before anything rings.

## When the budget covers a token

A token inside an authorized value is covered, so `88213` out of `PT 88213` is
fine. An authorized value inside a longer token is covered only when it makes up at
least 60 percent of it, so `Fatima Haddad` does not quietly authorize
`fatima.haddad@example.com`. That threshold is a judgment call and it is the reason
the email gate in the demo fires.

## What this cannot do

Pattern detection is a safety net, not a proof.

- It cannot catch a detail that reads as ordinary prose. "She has been coming here
  since her divorce" contains no identifier. The topic warning only sees a word it
  already knows. The defence against that is the script, which refuses to discuss
  anything but the errand.
- It cannot know that an authorized value is wrong. If the file says the date of
  birth is April, April is what gets said.
- It will sometimes flag something harmless. That is the direction to be wrong in
  for a refusal gate and every finding names the field so it takes seconds to fix.

## Why findings are masked

Every finding carries a kind and a masked token: `identifier (AB*******)`. A
privacy report that quotes the leak in full has copied it into a second place. The
kind plus the field is enough to find and fix it.
