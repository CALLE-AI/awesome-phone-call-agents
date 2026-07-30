# Call On Behalf

Some things can only be arranged by phone. A clinic with no online booking, a
garage, a landlord, a government office where the web form has been "temporarily
unavailable" for two years. If you cannot use a phone line, that is not an
inconvenience, it is a door that does not open.

This app makes one delegated call and hands back what was said. It states in its
first sentence that it is an automated assistant calling on behalf of a named
person with their permission. It says only the details that person authorized. It
can accept a time only inside windows they set. Then it gives them the answers,
exactly what was disclosed about them and the transcript in writing.

It is not a relay service and it does not pretend to be a person. Those two
limits are the design, not a disclaimer.

## Who it is for

- Somebody deaf or hard of hearing, when the business has no text channel.
- Somebody whose language does not match the line they have to call.
- Somebody who cannot manage a phone conversation that day, for whatever reason.
- Anybody delegating a dull errand who still wants a record of what was said
  about them.

## The disclosure budget

Handing over a phone call means handing over the right to say things about you.
So the errand file carries an explicit list and three gates check it.

| Gate | When | What it does |
| --- | --- | --- |
| The request file | at load | A question that carries an identifier nobody authorized is refused. A payment card, a password or a national identifier in the budget is refused outright, whatever the file says. |
| The script | before the call | The generated script is scanned for anything personal that is not in the budget. A finding refuses the call. Nothing is placed. |
| What was said | after the call | Everything the caller actually said is scanned the same way and anything outside the budget is reported to the person it belongs to. |

Findings are masked in every report, because a privacy report that quotes the
leak is not a privacy report.

Only the budget and the person's name go into the call. Why they delegated it stays
in the errand file and on the preview. It is never sent to CALL-E. The preview also
flags clinical, legal and financial wording in the goal and the questions. That is a
warning, not a gate: it catches the words it knows. It cannot read the sentence.
Prose with none of those words in it goes out untouched.

## What the report will not claim

The extraction proposes. The transcript decides.

- A question is answered only when a turn from the callee supports that answer. The
  report prints that turn. An answer nobody can be quoted saying comes back as not
  answered, with a note that CALL-E claimed one.
- Something is agreed only when the transcript shows somebody agreeing. Otherwise
  the commitment reads `unconfirmed` and the next step says to treat nothing as
  booked. The confirmation code belongs to the agreement, so it is dropped too.
- A call this app could not read comes back as `outcome_unknown`, never as a
  failure and never with "nothing was said". Re-running the same errand file reads
  the same call back, because the idempotency key covers the content of the call and
  has not changed.

## Try it without an account

`npm run demo` runs six cases against a local fake CALL-E. No credentials, no
network beyond localhost, nothing rings.

```text
Call report: bayview-checkup-aug

On behalf of  Fatima Haddad
Called        Bayview Family Clinic  +14*******22
Status        completed, a person answered
Outcome       goal_met

What was agreed
  Thursday, August 13 at 9:40 AM
  confirmation 4471

Your questions
  1. What is the earliest appointment you have for a routine check-up?
     answered: Thursday the thirteenth at nine forty in the morning
     they said: Thanks. Earliest for a new patient is Thursday the thirteenth at nine forty.
  2. Do you take Blue Shield PPO?
     answered: yes
     they said: Yes, we take Blue Shield PPO. I can hold that slot, reference four four seven one.

What was said about you
  said          the caller's full name, date of birth, insurance plan name
  not needed    nothing left over
  privacy check nothing outside your list was said
```

The other five cases are the ones that matter: a clinic that will not deal with
an automated caller, a time the caller was not allowed to accept, the three
privacy gates firing, an extraction claiming an agreement nobody made and a call
this app could not read the outcome of.

```text
2. The clinic will not deal with an automated caller
  outcome: callee_declined_automated
  next step: Bayview Family Clinic will not deal with an automated caller. Nothing
  was arranged. Call them yourself, ask somebody to call for you or use a relay
  service if you have one.

4. The three privacy gates
  gate 1, the request file: questions[0].text contains a detail nobody authorized
  gate 2, the script: The call script would say 1 detail(s) nobody authorized:
          email address (fa********) in call script. No call was placed.
  calls placed: 0
  gate 3, what was actually said: 1 finding(s) identifier (AB*******)

5. The extraction says it was agreed and the transcript does not
  outcome: partially_met, commitment: unconfirmed
  confirmation code kept: ""
  questions answered: 3
  next step: Something was reported as agreed and the transcript does not show
  anybody agreeing to it, so treat nothing as booked.

6. The call CALL-E would not report back on
  outcome: outcome_unknown, call id: call_fake1
  next step: CALL-E took the errand and this app could not read what happened, so
  nobody knows yet whether the call was made or what was said.
  calls placed: 1
```

A business refusing an automated caller is a legitimate answer. The app reports it
and stops, because arguing with a receptionist is not a feature.

## Setup

Node 20 or later.

```bash
cd apps/typescript/call-on-behalf
npm install
npm run check   # tsc --noEmit
npm test        # 87 tests, no credentials, no outbound calls
npm run demo    # the six cases against the local fake CALL-E
```

The scripts run `node --import tsx`, so the suite works in a sandbox that will not
give `tsx` its own IPC socket.

## Preview, which is the consent step

```bash
npm run errand -- preview --errand examples/errand.example.json
```

Preview prints the exact script, the details the caller may give, the windows it
may accept, the result contract, the privacy check and a receipt for that exact
preview. It contacts nothing. The person sees what will be said about them before
anything rings.

## One live call

The receipt is what carries consent from the preview to the call.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run errand -- preview --errand your-errand.json          # prints the receipt
npm run errand -- call --errand your-errand.json --live --receipt <hash> --report report.json
npm run errand -- show --report report.json
```

`call --live` refuses without the receipt for the errand file as it stands. Edit
the file and the receipt changes, which is the point: the consent belongs to a
preview somebody read.

Reports are written with mode `0600`. They hold the full transcript on purpose:
the person is entitled to what was said on their behalf.

## The errand file

| Field | Notes |
| --- | --- |
| `errand_id` | Stable per errand. The idempotency key is this plus a hash of the call content, so a retried run reuses the call instead of ringing again and an edited errand is a new call instead of a conflict. |
| `on_behalf_of.name`, `on_behalf_of.reason_for_delegation` | Both required. The name is spoken. The reason is the consent record only: it is printed in the preview and never sent to CALL-E. |
| `callee.published_source` | Required. Where the number came from. A number nobody published is not an errand target. |
| `goal.summary` | Read out loud, 200 characters. |
| `goal.commitment` | `none`, `slot_within_windows` or `confirm_existing`. Nothing else can be agreed. |
| `authorized_windows[]` | Required for `slot_within_windows`. Full ISO 8601 instants with an offset. A time outside them is reported, never accepted. |
| `disclosure[]` | Up to 6 items, each with a label and a value. This is the whole list the caller may say about the person. |
| `questions[]` | Up to 4. A phone call is not an interview. |
| `policy.language` | BCP 47, passed to CALL-E as the recipient locale. |
| `policy.leave_voicemail` | Off by default. On, the voicemail message carries no detail beyond who called. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | the errand did what it was asked |
| 10 | partly done or something was offered that needs the person to decide |
| 20 | nothing arranged: they refuse automated callers, a machine answered, nobody answered, the call failed |
| 30 | usage error, a receipt that does not match the errand file or a privacy refusal |
| 40 | the call may have run and its outcome could not be read |

## Who you may point this at

Call a business on a number it published, about business the person asked for.

The FCC ruled on February 8 2024 that "calls made with AI-generated voices are
'artificial' under the Telephone Consumer Protection Act", which puts them under
the same robocall rules as any other artificial voice. Those rules are about calls
to consumers. This app has no way to check that a number belongs to a business, so
that judgment stays with the person running it and `callee.published_source` is
required to make them write it down.

## Side effects, credentials, data

- One CALL-E call per errand, nothing recurring, so there is no schedule to clean
  up. Stopping the process stops the run and a connected call finishes on the
  CALL-E side.
- `preview` and `show` place no calls and need no credentials.
- `CALLE_API_KEY` is read from the environment only, never from the errand file.
- The key goes out on every request, so the base URL is checked before the client
  is built. HTTPS anywhere, plain HTTP only on `localhost`, `127.0.0.1` or `::1`
  for the local fake. Anything else is refused by name and the key is not sent.
- The report holds the transcript and the disclosure record. Numbers are masked.
  Findings are masked. Keep the file the way you keep anything with your own
  details in it.

## Reading further

- [`docs/privacy-budget.md`](docs/privacy-budget.md): the three gates, what the
  detectors catch and what they cannot.
- [`docs/scope-and-limits.md`](docs/scope-and-limits.md): why this is not a relay
  service, what it refuses to say and where it stops.
- [`examples/report.example.json`](examples/report.example.json): the report the
  demo produced, unedited.

This is a demo app for a workflow pattern, not a CALL-E SDK and not a supported
product API.
