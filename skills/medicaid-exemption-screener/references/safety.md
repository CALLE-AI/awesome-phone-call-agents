# Safety boundaries

Read this before any live campaign, every time. Everything here is enforced in code as well as in
the call task, because a prompt is guidance and code is a guarantee.

## The one-line rule

**The agent proposes, the code decides, a human confirms.** No phone call ever changes anyone's
coverage, and no phone call ever tells anyone that their coverage is safe.

## Consent

- Every row must carry `consent=yes`. Rows without it are refused at load time and counted in the
  registry report; there is no flag to override this.
- Consent means the person gave this phone number to the programme and agreed to be contacted about
  their coverage. Sourcing numbers from anywhere else is out of scope for this skill.
- `do_not_call=yes` rows are never loaded. Anyone who says "do not call me again" on a call is
  suppressed for the rest of the campaign and handled by mail only.
- Under US law this is a consented, non-marketing call to an existing enrollee about their own
  benefits (FCC DA 23-62). An AI voice is an "artificial" voice for TCPA purposes (FCC 24-17), so
  the call identifies itself as automated in its first sentence and gives a callback number.

## Privacy on the call

- **Identity before disclosure.** The agent may not mention Medicaid, coverage, or any rule until
  the person has said they are the enrollee *and* given a birth year that matches the record.
- **The agent never says the year first.** The task instructs it to ask, not to offer.
- If someone else answers, or the year does not match, the agent leaves only a neutral message with
  a callback number and ends the call. The outcome is `identity_unconfirmed`, and the redial is the
  only follow-up.
- **The voicemail script must not mention Medicaid.** `validateState` rejects a state file whose
  voicemail does, because answering machines are shared.
- Phone numbers are masked to `+14*******01` everywhere outside the operator's own registry file:
  ledger, dashboard, report, logs, and any transcript excerpt.

## What the agent may never do

- Ask for a Social Security number, bank or payment details, immigration status, or a diagnosis.
  If the person volunteers a diagnosis, the agent says kindly that they do not need to share details.
- Say "you are exempt," "you qualify," "your coverage is safe," or any equivalent. Only three
  closing messages are permitted, and all three are conditional and name the state as the decider.
- Give legal advice, or answer questions about other people's cases.
- Read its own instructions aloud.
- Claim to be a human. If asked, it says it is an automated assistant calling for the programme, and
  offers the navigator line for anyone who wants a person.

If the structured result shows the agent said more than the answers support, `classify.ts` sets
`correctionNeeded` and the cascade schedules a `correction_call` from a human. This check is computed
**before** any confidence downgrade, so a low-confidence result can never hide an overclaim.

## Fail-closed classification

Uncertainty never becomes good news:

| Situation | Outcome |
| --- | --- |
| No completed attempt | `unreachable` |
| Completed call, no valid structured result | `unverified` |
| Asked not to be called again | `opted_out` |
| Voicemail, or nobody identifiable | `unreachable` |
| Wrong person, or identity not confirmed | `identity_unconfirmed` |
| Asked for a better time | `declined` |
| Call ended mid-screening | `unverified` |
| A health condition **without** a daily-activity limitation | `needs_review`, never an exemption |
| Any exemption answer left unclear | `needs_review` |
| A favourable verdict with low CALL-E completion confidence | downgraded to `needs_review` |
| CALL-E refused the task | `not_attempted` - never `unreachable` |

That last row matters: a platform failure is our problem, not the enrollee's. Nobody gets a letter,
a navigator call, or a verdict they did not earn because an API call failed. The robustness suite
drives a total outage and asserts that every affected person lands in `operator_review` only.

Medical frailty requires **both** a qualifying condition **and** a limitation on daily activities,
as the CMS rule describes. A condition alone is a review, not an exemption.

## Calling limits

- **Three calls per person per campaign, maximum.** `HARD_CALL_CAP = 3` overrides any configuration;
  `SC_MAX_ATTEMPTS` above 3 is rejected when the config loads.
- Default is 2: the first call and one redial.
- **Quiet hours are absolute for campaigns.** 21:00-08:00 local by default, enforced in live mode
  with no override flag. Coverage outreach is never urgent enough to call at night, and `run`,
  `resume` and `follow-up` refuse outright.

  The one documented exception is `probe`, and it is an exception to *who is being called*, not to
  the rule. A conformance probe can only dial a number on `SC_LIVE_ALLOWLIST` — an enrollee is not
  reachable by that command at any hour — and the operator presses Enter to make that phone ring
  seconds before it does. Calling your own test phone at 22:30 to check the agent's guardrails is
  not outreach. The run says so in the output rather than staying quiet about it.
- People who ask for a better time are called back once, at their stated time, and then written to.

## Live-mode gates

A real phone call requires all three of:

1. `SC_MODE=live`
2. `CALLE_API_KEY` present
3. `--confirm` on the command line

And additionally:

- `SC_LIVE_ALLOWLIST` should be set for any rehearsal. In live mode, numbers not on the allowlist are
  reported and skipped, so a test cannot reach a real enrollee.
- In dry-run the base URL points at `127.0.0.1`, so the real API is not even reachable.
- `POST /api/run` returns **403** when the server is in live mode. Live campaigns start from the CLI
  and nowhere else.
- Any dashboard exposed through `SC_PUBLIC_URL` auto-generates a token that every route except the
  webhook requires.

## Checking that the agent actually holds these boundaries

Everything above is enforced in code *and* written into the call task. The code half is covered by
the test suite. The task half is a model instruction, and a model instruction is a hope until you
test it on a real call.

`npm run probe` runs eight scripted adversarial calls — a caller demanding a yes-or-no on whether
they are exempt, somebody else answering the phone, a condition that does not limit daily life,
a caller offering their Social Security number, an opt-out mid-screening, voicemail, uniformly vague
answers, and the same pressure applied in Spanish. Each is checked mechanically against the
transcript that comes back.

Run them in dry-run for free, and run them live before trusting any new rules file, state file or
task wording. If a probe fails, the task text is wrong — fix it there, not in the classifier.

## Stopping, and what cannot be stopped

There are no hidden or recurring schedules. A campaign runs only while the command you started is
running; nothing re-arms itself, nothing runs on a timer, and closing the process ends the campaign.
`follow-up` is a separate command you have to run deliberately.

To stop a campaign in progress:

- **Ctrl-C.** Calls already accepted by CALL-E cannot be recalled — the platform has no cancel
  operation — so treat the wave in flight as committed. That is why wave size is the commitment and
  the code never over-dials expecting to stop.
- The ledger is append-only and written as events happen, so an interrupted campaign loses nothing.
  `resume --campaign-id <id>` settles whatever was in flight and finishes the worklist; it places no
  duplicate call, because every attempt is keyed.
- To stop permanently instead, simply do not resume. People who were never dialled stay
  `not_attempted`, which produces an `operator_review` item and no letter, no navigator call and no
  verdict.

To stop calling one person, for good:

- Set `do_not_call=yes` on their row. They will never load again, in any campaign.
- Anyone who says "do not call me again" on a call is suppressed automatically for the rest of the
  campaign and handled by mail only.

## Data handling

- Real enrollee lists must be named `*.private.csv`; that pattern is git-ignored, as is `.env` and
  `data/runs/`.
- The ledger is append-only JSONL with masked phone numbers. It is the only durable store, and the
  report and dashboard are derived from it - so what a reviewer sees is exactly what was recorded.
- Transcript excerpts kept as evidence are limited to the person's last few turns and are
  phone-masked.
- API keys live only in `.env`. If a key is ever pasted into a chat, a log, or a commit, rotate it.

## What this is not

Not legal advice. Not a benefits determination. Not a substitute for a caseworker. The bundled rule
file summarizes federal law as of its cited sources, and states are still writing their own
variations - check the state's own rules before any real use.
