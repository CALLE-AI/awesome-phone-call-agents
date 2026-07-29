# Scope and limits

Read this before pointing the app at anything that matters.

## It is not a relay service

Telecommunications Relay Service is the regulated service, required in the United
States under Title IV of the Americans with Disabilities Act, where a
communications assistant relays a live conversation between somebody who is deaf,
hard of hearing or has a speech disability and a hearing party. The person is on
the call. They say what they want to say and the assistant relays it.

This app does none of that. It runs one delegated errand, from a script the person
approved beforehand, while they are not on the call. It is useful for the same
reason a relay service is useful and it replaces none of it. When a conversation
needs to happen, use a relay service.

## It never claims to be a person

The first sentence of every call says it is an automated assistant calling on
behalf of a named person with their permission and that it is not a person. If it
is asked whether it is a person, the script tells it to say no plainly. There is no
mode that turns that off. An app that lets you impersonate somebody by phone is a
fraud tool, not an accessibility tool.

## The callee is allowed to refuse

Plenty of businesses will not deal with an automated caller. The app detects that,
records `callee_declined_automated`, thanks them, ends the call and tells the
person to call another way. It does not argue, retry or dial back with a different
script. A refusal is an answer.

## It does not discuss clinical, legal or financial detail

The script forbids describing symptoms, conditions, treatment or money, and
forbids agreeing to any payment. The disclosure budget refuses card numbers and
passwords outright. Administrative errands are in scope: book, confirm, reschedule,
ask what to bring, ask whether a plan is accepted, ask whether something arrived.
Anything that needs judgment about a person's health, rights or money is not.

Never use this app for an emergency. It places one call, waits and reports
afterwards. If somebody needs help now, call emergency services directly.

## It commits to nothing it was not authorized to commit

`goal.commitment` is the whole authority the caller has. `none` means it may agree
to nothing. `slot_within_windows` means it may accept a time only inside the listed
windows and a time outside them comes back as a proposal with nothing agreed.
`confirm_existing` means it may confirm what already exists and may not move or
cancel it.

If the extracted result says a time was accepted and that time is outside the
windows, the report marks `outside_authorized_window` and tells the person to check
and cancel it. The app does not hide its own mistake behind a success message.

## Who you may call

Call a business, on a number it published, about business the person asked for.

The FCC ruled on February 8 2024 that "calls made with AI-generated voices are
'artificial' under the Telephone Consumer Protection Act", which holds them to the
same rules as any other artificial voice. Those rules are about calls to consumers
and this app cannot tell a business line from a personal one. That judgment stays
with whoever runs it, which is why `callee.published_source` is required: writing
down where the number came from is a small brake worth having.

## Consent is the person's and it is recorded

The errand file is the consent record: who is delegating, why, what may be said
about them and what may be agreed. `preview` prints the exact script and the
disclosure list so they can read it before anything rings. Nothing in this app
places a call without `--live` on the command line.

## What it stores

The report holds the answers, the disclosure record, the privacy findings, the
CALL-E call id and the full transcript, written with mode `0600`. The transcript is
kept on purpose: a person who could not hear the call is entitled to what was said
on their behalf. Phone numbers are masked. Findings are masked.

Nothing is sent anywhere except CALL-E and the API key is read from the
environment only.

## Where it will disappoint you

- One call, one errand. It does not chase, escalate or call back later.
- It does not navigate long phone menus well. If a line is an eight level menu,
  expect `voicemail` or `not_reached`.
- It reads what came back. If a receptionist was vague, the report says the
  question was not answered rather than guessing what they meant.
