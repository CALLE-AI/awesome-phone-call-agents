# Verify Contact Claim

A voicemail says it was your bank. A text says a parcel is held. A missed call
leaves a number to ring about your account. The advice every regulator gives is the
same: do not use the number in the message, use the number printed on your own card
or bill. That tells you which number to dial. It does not tell you what to ask when
somebody picks up. It leaves you with nothing you can keep either.

This app dials that number once. It says in its first sentence that it is an
automated assistant calling on behalf of a named person, with their permission, that
it is not a person and that what they tell it is written down. It asks one question:
did anyone there contact this customer in the last hour about this. Then it hands back
the verdict, the words the person on the line actually said and the number the
customer should be using.

It verifies a contact event rather than a standing fact. Not "is this number really
the bank" but "did you call this person in the last hour".

The FTC says the costliest impersonation scams often start with a fake security
alert, frequently from a bank, followed by pressure to move money to "protect" it
(FTC press release, June 2026). CrowdStrike's 2025 Global Threat Report recorded a
442% rise in voice phishing between the first half of 2024 and the second half.

## A bank saying no is the answer, not a failure

`refused_to_confirm` is the outcome to expect from a bank rather than the edge case.
It is the institution following the law, not stonewalling.

- Under Regulation P the bare fact that somebody is a customer is protected. 12 CFR
  1016.3(q)(2)(i)(C) counts the fact that an individual is or has been one of your
  customers as personally identifiable financial information.
- 12 CFR 1016.10(a)(1) then bars disclosing that to a nonaffiliated third party
  outside the notice and opt out machinery. An app ringing on a customer's behalf is
  a third party.
- A clinic has a harder rule again. Confirming it called a named person reveals that
  the person is a patient, so HIPAA at 45 CFR 164.514(h)(1)(i) makes a covered
  entity verify the identity and the authority of whoever is asking.

So the app is built to be useful when the answer is no. Every outcome ends with the
number printed on the customer's own card, which is the one number worth ringing
whatever came back. A refusal still tells the customer more than the message did:
the institution would not confirm it either way, so treat it as unverified and ring
them yourself on the printed number.

## Who it is for

- Anybody who got a voicemail, a text or a missed call claiming to be their bank, a
  delivery firm, a school or a clinic.
- Somebody helping a parent or a relative who cannot make that call themselves.
- An agent or a script that needs the answer as an exit code plus a record it can
  replay later.

## The five outcomes

| Outcome | When |
| --- | --- |
| `confirmed_genuine` | a call CALL-E finished cleanly plus a turn from the person on the line that supports "yes we contacted them" |
| `no_such_contact` | a finished call plus a turn that supports "no record of that" |
| `refused_to_confirm` | a finished call where the institution declines to discuss a third party's account |
| `unreachable` | a finished call that reached nobody, reached a machine or ended before the question, with no answer in it either way |
| `outcome_unknown` | a call CALL-E has not finished with, a call this app could not read, an ambiguous create |

Terminal statuses are `completed`, `failed` and `canceled`. A no answer or a
voicemail arrives as `failed` with a failure code, so neither is a status of its own.

A status says how the call ended. It is not a statement about what the transcript
holds, so it is not read as one. A call that ended on `failed` or `canceled` can still
carry the question and the answer to it: the line drops after the person speaks, the
operator hangs up, a carrier error lands late. A denial or a refusal already in that
transcript stands, with the status and the failure code kept on the record. A
confirmation does not. That is the one answer which could leave somebody trusting a
message they should not, so it needs a call CALL-E finished cleanly.
`phone-approval-gate` draws the same line, reading a rejection before it looks at the
call status at all.

## The three refusals

These are the product, so each one runs twice: once when the claim file is loaded,
then again on the claim and the words that are about to be sent. A claim assembled any
other way than through the loader still cannot get past the second one.

| Refusal | What it does |
| --- | --- |
| The number dialled never comes out of the contact | The only number this app rings is `trusted_number.phone`. A file whose `number_shown` is that same number is refused. So is a file that carries no trusted number. So is one where the number to dial also appears in a field describing the contact, which is what a "ring us straight back on this other number" voicemail leaves behind. So is one whose `trusted_number.printed_on` says the number was read off the message, the handset, a caller id, a link or a search result. The message explains that the trust anchor is the card in the customer's hand. |
| Nothing the caller asked for is repeated | The whole file is scanned for card numbers, account numbers, one time codes, PINs, passwords, dates of birth and national identifiers. A hit names the field it was found in and masks the value. `asked_for` stays in the file and is never spoken on the call. |
| The app never claims to be the customer | A field that sets a persona is refused. So is prose asking the caller to be the account holder. The script says it is an automated assistant calling for a named person, it cannot answer a security question and it says so on the line. |

The scan reads values rather than subject matter. "They wanted my card number" is
fine to write down. "They wanted 4111 1111 1111 1111" is the one that refuses.

Comparing the number to dial with the number that made contact catches one version of
a missing anchor and misses the commoner one. A voicemail that says to ring back on a
different number leaves two numbers behind. They do not match each other, so the app
would dial the one the scammer chose. So the number to dial is also read out of every
field describing the contact, on digits. Then `printed_on` is read for a source that is
the thing being checked. That second half reads words rather than meaning, so a note
that mentions the message in passing is refused too. Whether the number was really
read off the card is still the customer's word.

## What this app will not claim

CALL-E's extraction proposes. The transcript decides.

- A verdict comes only from a terminal call status. A confirmation comes only from a
  call CALL-E finished cleanly. A call still `queued` or `in_progress` is
  `outcome_unknown` with the call id kept, never a decision.
- The sentence the customer reads is a claim about the call, so it is written from the
  reason rather than from the outcome alone. `unreachable` does not say nobody was
  reached when a machine answered or when somebody picked up and the call ended before
  the question.
- An answer needs a specific turn from the person on the line that supports it. That
  turn has to come after our question was asked in the transcript. No supporting turn
  means no answer.
- `structured_result` corroborates the transcript. It never replaces it. It is
  printed with CALL-E's name on it, it is never treated as evidence and it can be
  null on a healthy call.
- A completion time that is missing, unparseable or the wrong type is not a time. The
  run records the reason and refuses to decide the window on it.
- A create that came back ambiguous is replayed under the same idempotency key, which
  returns the call CALL-E already has for that key rather than ringing the line
  twice. Reading the call back is then the only thing that resolves it: any failure of
  that replay leaves the state unknown with both failure codes in the record, whatever
  class the second failure is. A definite refusal on the replay says nothing about the
  request that went unanswered, because that one may already have been accepted and a
  401 or a 403 can be decided before the key is looked up.

## What already exists

Checking whether your bank really called you is solved when the institution has
joined something first.

- Google's verified financial calls asks the bank's own app on the handset whether an
  incoming call is genuine. It needs the bank enrolled, its app installed and the
  call still live.
- Monzo shows a call status inside its own app, for its own customers.
- US 12,147,992 B2, granted to Capital One Services LLC in November 2024, addresses
  the same problem with a cryptographic handshake: an app registered with the company
  in advance, a one time code generated on the device and the company's
  representative reading it back.

All three need the institution to have implemented something. This app needs nothing
from the institution except the number printed on the customer's card. It also works
for a voicemail, a text or a missed call hours after the fact, which is when a live
call check has nothing left to say.

## Try it without an account

`npm run demo` places six calls against a local fake CALL-E, reaching all five
outcomes, then fires the three refusals. No credentials, no network beyond loopback,
nothing rings.

```text
1. The bank says the contact was theirs
---------------------------------------
  Calling Northgate Credit Union on +14*******00, from the back of the debit card.
  Call call_fake1 created.
  Outcome confirmed_genuine.
  outcome:     confirmed_genuine
  they said:   "Yes, that was us. We rang her about the card at ten past nine."
  dialled:     +14*******00, the back of the debit card
  what to do:  Northgate Credit Union says the contact was theirs. That does not
  make the number that contacted Dana Whitfield safe to use: if you need to talk to
  them, call the number printed on the back of the debit card. Nobody should ever
  ask you for a full card number, a PIN or a one time code on a call you did not
  start yourself.
```

A call nobody answered, a voicemail, a bank that will not discuss the account and a
call CALL-E could not be read back on all print the same way, then the run ends on
counts rather than a tick:

```text
Counts from this run
--------------------
  calls placed                 6
  outcomes reached             5 of 5: confirmed_genuine, no_such_contact, refused_to_confirm, unreachable, outcome_unknown
  refusals fired               3 of 3
  calls placed after a refusal 0
  records appended             6
  outcomes recomputed and held 6
  problems in the chain        0
  record file mode             0600
  credentials used             none. The key was the string calle_demo_key on 127.0.0.1
```

`calls placed after a refusal 0` is measured, not asserted. That beat starts a fake
that would happily answer on the number from the message, then checks that nothing
was placed.

## Setup

Node 20 or later.

```bash
cd apps/typescript/verify-contact-claim
npm install
npm run check   # tsc --noEmit
npm test        # 172 tests, no credentials, no outbound calls
npm run demo    # six calls against the local fake CALL-E
```

`npm test` takes about a minute. One test waits out the shortest per call timeout the
policy allows, which is 60 seconds, to prove a call CALL-E never finishes comes back
as `outcome_unknown` rather than as a denial.

The scripts run `node --import tsx`, so the suite works in a sandbox that will not
give `tsx` its own IPC socket.

## Preview, which is the consent step

```bash
npm run vcc -- preview --claim examples/claim.example.json
```

Preview prints every word the call will say, the one question, the number it will
dial with where that number was read from, the number it will never dial, the result
contract and a receipt over all of it. It contacts nothing and needs no credentials.

`npm run check` is `tsc --noEmit`. The subcommand that places the call is
`npm run vcc -- check`. Two different things on one word, so they are written out in
full everywhere below.

## One live call

The receipt carries consent from the preview to the call.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run vcc -- preview --claim your-claim.json                 # prints the receipt
npm run vcc -- check --claim your-claim.json --live --receipt <hash> --record record.jsonl
npm run vcc -- verify --record record.jsonl
```

`check --live` refuses without the receipt for the claim file as it stands. The
refusal does not print the right one. Edit the file and the receipt changes, which is
the point: consent belongs to a preview somebody read.

Every run appends one record, including the runs that answered nothing, because those
are the ones somebody asks about later. Records are one JSON line each, hash chained,
written with mode `0600` re-applied on every append. `verify` re-links the chain,
re-reads the stored words and recomputes every outcome with the same functions that
ran live, so a verdict edited by hand fails.

[`examples/record.example.jsonl`](examples/record.example.jsonl) is the demo's own
output, unedited: six records covering all five outcomes, from six calls to a local
fake server about a fictional customer. Replay it with
`npm run vcc -- verify --record examples/record.example.jsonl`.

## The claim file

| Field | Notes |
| --- | --- |
| `claim_id` | Stable per claim. The idempotency key is this plus a digest of the call payload, so a retried run reads the same call back while an edited claim is a new call. |
| `customer.name` | Spoken. Up to 80 characters. |
| `customer.callback_number` | Optional, E.164. Read out digit by digit so the institution can reach the customer rather than the machine. See the note on 47 CFR 64.1200(b)(2) below. |
| `contact.claimed_to_be` | Who the message said it was. Spoken. |
| `contact.channel` | `voicemail`, `text_message`, `missed_call` or `answered_call`. |
| `contact.arrived_at` | Full ISO 8601 with an offset. The call says the wall clock the file wrote, not this machine's. |
| `contact.claimed_about` | What it claimed to be about, up to 80 characters. Spoken. |
| `contact.number_shown` | The number that made contact. Kept in the file, printed in the preview, never dialled. |
| `contact.asked_for` | What the message wanted the customer to do, up to 300 characters. Never spoken, never sent to CALL-E. It is scanned. |
| `trusted_number.phone` | E.164. The only number this app dials. |
| `trusted_number.printed_on` | Where the customer read it, for example "the back of the debit card". It is printed in every result, so a source that is the message, the handset, a caller id, a link or a search result is refused. |
| `trusted_number.region` | Optional, passed to CALL-E with the recipient. |
| `policy.recent_window_minutes` | 15 to 240, default 60. The window the question asks about, read out in words. |
| `policy.per_call_timeout_seconds` | 60 to 600, default 240. |
| `policy.language` | BCP 47, passed to CALL-E as the recipient locale. |
| `policy.min_confidence` | 0 to 1, default 0.5. A completion confidence CALL-E reports below this floor makes the run `outcome_unknown` with reason `low_confidence` rather than an answer. |

An unknown key is refused rather than ignored, because a persona under a name this
app has never seen would otherwise ride along quietly.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | `confirmed_genuine`. Also a successful `preview` or `verify` |
| 10 | `no_such_contact` |
| 20 | `refused_to_confirm` |
| 30 | `unreachable` |
| 40 | `outcome_unknown` |
| 50 | usage error, a refused claim file, a missing key or a receipt that does not match |
| 60 | `verify` found a problem in the record chain |

0 means the contact was confirmed. It does not mean the message was safe, so the
result says what to do either way. Progress goes to stderr while the result goes to
stdout, so `--json` stays parseable.

## Who you may point this at

An institution's own published line, about a message that institution is claimed to
have sent, for the customer who got it.

The FCC ruled on February 8 2024 that calls made with AI-generated voices are
"artificial" under the Telephone Consumer Protection Act, which puts this app under
the same rules as any other artificial voice call. Two of those rules shape the
script. 47 CFR 64.1200(b)(1) wants the opening to say who is responsible for the
call, so the first sentence names the customer the call is made for and says it is
not a person. 47 CFR 64.1200(b)(2) wants a callback number for that responsible
party, which is the customer rather than the machine, so `customer.callback_number`
is the one number the script reads out loud.

The opening also says that what the person tells it is written down, because it is:
the record keeps the callee turn the outcome was read from, verbatim.
`phone-approval-gate` tells its approver the call goes into the change log and the
person answering here is owed the same. Two rules keep the call inside the boundaries
`CONTRIBUTING.md` asks of anything in this repository that can place a call. The
caller gives no clinical, legal or financial detail and no opinion on any of it, since
it holds none. Anybody who says there is an emergency, that somebody is hurt or that a
fire, a gas leak or a flood is happening now is told to hang up and call their local
emergency number. Then the call ends.

The same ruling that makes a scammer's cloned voice unlawful classifies this app's
voice as artificial too. That is why the script never claims to be the customer, and
why refusal 3 is checked twice.

## Side effects, credentials, data

- One CALL-E call per run of `check --live`, nothing recurring, so there is no
  schedule to clean up. Stopping the process stops the wait. A connected call
  finishes on the CALL-E side.
- `preview` and `verify` place no calls and need no credentials.
- `CALLE_API_KEY` is read from the environment only, never from the claim file.
- The key goes out on every request, so the base URL is checked before the key is
  read and before any client exists. The host has to be `api.heycall-e.com`,
  `localhost`, `127.0.0.1` or `::1` for the local fake, which is also the only place
  plain HTTP is allowed. Any other host has to be named exactly in
  `CALLE_ALLOWED_HOSTS` or with `--allow-host`: no wildcards, no suffix matching,
  port ignored. Anything else is refused by name and the key is not sent.
- The record file holds the question, the outcome, the quote and the transcript
  excerpt. Numbers are masked in it and the number dialled is stored as a digest.
  Keep it the way you keep anything with your own details in it.

## Reading further

- [`docs/limits.md`](docs/limits.md): what this is for, what it is not for, why a
  bank refusing is the expected outcome and what has never been tested live.
- [`examples/claim.example.json`](examples/claim.example.json): the claim file the
  preview and the demo run on.
- [`examples/record.example.jsonl`](examples/record.example.jsonl): the record chain
  the demo wrote, which `verify` replays.

This is a demo app for a workflow pattern, not a CALL-E SDK and not a supported
product API.
