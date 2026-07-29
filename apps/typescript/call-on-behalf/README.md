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

## Try it without an account

`npm run demo` runs four cases against a local fake CALL-E. No credentials, no
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
  2. Do you take Blue Shield PPO?
     answered: yes

What was said about you
  said          the caller's full name, date of birth, insurance plan name
  not needed    nothing left over
  privacy check nothing outside your list was said

Transcript, verbatim
  [00:00] assistant: Hello, I am an automated assistant calling on behalf of Fatima Haddad, with their permission. I am not a person.
  [00:06] them: Bayview Family Clinic, how can I help?
```

The other three cases are the ones that matter: a clinic that will not deal with
an automated caller, a time the caller was not allowed to accept and the three
privacy gates firing.

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
```

A business refusing an automated caller is a legitimate answer. The app reports it
and stops, because arguing with a receptionist is not a feature.

## Setup

Node 20 or later.

```bash
cd apps/typescript/call-on-behalf
npm install
npm run check   # tsc --noEmit
npm test        # 53 tests, no credentials, no outbound calls
npm run demo    # the four cases against the local fake CALL-E
```

## Preview, which is the default

```bash
npm run errand -- preview --errand examples/errand.example.json
```

Preview prints the exact script, the details the caller may give, the windows it
may accept, the result contract and the privacy check. It contacts nothing. This
is the consent step: the person sees what will be said about them before anything
rings.

## One live call

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run errand -- call --errand your-errand.json --live --report report.json
npm run errand -- show --report report.json
```

Reports are written with mode `0600`. They hold the full transcript on purpose:
the person is entitled to what was said on their behalf.

## The errand file

| Field | Notes |
| --- | --- |
| `errand_id` | Stable per errand. It is the idempotency key, so a retried run reuses the call instead of ringing again. |
| `on_behalf_of.name`, `on_behalf_of.reason_for_delegation` | Both required. The reason is said on the call only if it helps and it keeps the record honest about why a machine is calling. |
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
| 30 | usage error or the privacy check refused the script |

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
