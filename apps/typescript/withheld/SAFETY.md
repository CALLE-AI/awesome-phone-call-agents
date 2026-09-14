# Safety

Withheld places real phone calls to real businesses on behalf of a real person.
This document is the list of things it will not do, and where in the code each
one is enforced. Where a rule is only an instruction to the model, it says so.

The organising principle: **an instruction to a model is a request, not a
control.** Every rule below that matters is enforced outside the model, before
the call or after it, or both.

---

## 1. Explicit user intent

No call is placed without an errand file, and the errand file *is* the record of
what the person authorised. It names the callee, the goal, the questions, the
exact facts that may be spoken, and the windows in which an arrangement may be
agreed.

- Withheld never invents a callee, a question, or a fact about the person.
- It never dials a number that is not `errand.callee.phone`.
- `preview` shows the complete generated script and every gate result **before**
  anything can dial, so intent can be checked against what will actually be said.
- Real calls require both a CALL-E credential (`CALLE_API_KEY`, or a logged-in
  `calle` CLI) *and* an explicit `--real` flag. Either one missing means fixture
  replay. There is no configuration setting that makes dialing the default.

`src/core/errand.ts`, `src/core/script.ts`, `scripts/withheld.ts`

---

## 2. Phone numbers

**E.164 only.** Both numbers in an errand file must match `^\+[1-9]\d{6,14}$`.
National formats are refused at load: `020 7946 0321` is a different telephone
depending on which country decodes it, and a trunk zero dropped by a spreadsheet
turns one subscriber into another.

**The person's number is never disclosed.** This is the entire product, and it
has four independent enforcement points:

| Where | What happens |
| --- | --- |
| Errand load | A may_say list containing the person's own number is refused; no script is generated. |
| Script generation | `buildScript` refuses to emit a script containing the number. `safeToDial` is false and the CLI will not proceed. |
| Request construction | The result schema sent to CALL-E has no field for a phone number in either direction. There is nothing to fill in. |
| After the call | Every leg re-scans the caller's turns for the number in any form — punctuated, regrouped, or read aloud as "oh double seven oh oh…". |

A leg that discloses the number becomes `outcome_unknown` and stops the chain,
**even if the errand was otherwise completed successfully.** A booking obtained
by giving out the number is not a success.

**Unattributed turns are scanned too.** CALL-E labels a turn `unknown` when
diarisation fails. Such a turn can never *confirm* anything — no window, no
answer — but it is still scanned for the number, because a number audible on an
open line was disclosed whoever said it. Findings from unattributed speech are
labelled `unattributed_speech` so a report never claims the agent said something
it may not have.

`src/core/errand.ts`, `src/core/budget.ts`, `src/core/script.ts`, `src/core/leg.ts`

---

## 3. Masking in summaries

Every finding is masked before it is reported. `maskSecret` keeps the first two
and last two characters and replaces the rest.

A privacy report that quotes the leak is not a report — it is a second copy of
the leak, now in a log file that is easier to read than the transcript.

The transcript itself is **not** edited. It is evidence: the record of what was
actually said. The *report* is masked; the record is not, or the leak could
never be investigated.

`src/core/budget.ts`, `src/app/boundary.test.ts`

---

## 4. Categories refused outright

These are refused **whatever may_say says**, because a list that
authorises them is a malformed list, not permission:

- payment card numbers — any card-shaped run of 13–19 digits
- passwords, API keys, and other credentials
- national identifiers
- the person's own phone number, and phone-shaped text generally

The card check is deliberately **not** Luhn-validated. Luhn would make the scan
*less* sensitive: a mistyped or partially redacted card number fails Luhn and
would sail through, while still being a card number as far as the person on the
other end of the line is concerned. For a fail-closed scanner, catching too much
is the correct direction of error.

Refusal happens at errand load, so no script is generated and no call is placed.

`FINDING_KINDS_REFUSED` in `src/core/budget.ts`

---

## 5. Medical, legal, financial, and emergency content

**Never for emergencies.** Withheld must not be used for 999, 911, 112, or any
urgent medical, safety, or crisis call. It is asynchronous by construction — it
declines callbacks and schedules calls for later, which is the exact opposite of
what an emergency needs. Use the relay services built for it; in the US, [FCC
TRS / 711](https://www.fcc.gov/trs).

**No advice, in either direction.** The script instructs the agent not to give
medical, legal, or financial advice or opinions, and not to answer anything
outside may_say — it offers to check with the person instead.

This one is an *instruction*, and instructions are not guarantees. The
complement is `advisoryFlags`, which scans the errand file before dialing and
raises a flag on clinical, legal, or financial wording so a human reads the
script first. It is deliberately **advisory, not a gate**: booking a medical
appointment legitimately involves clinical wording, and refusing the errand
would break the use case it exists for. It surfaces; a person decides.

**The agent never claims to be a person.** It identifies itself as automated in
its first sentence, must not claim to be the person it acts for, and must say no
if asked directly whether it is human. Withheld is not a relay service and does
not present itself as one.

`src/core/script.ts`, `advisoryFlags` in `src/core/budget.ts`

---

## 6. The most sensitive field never leaves the process

`errand.reason` explains *why* a person cannot use a phone — a disability, a
medical condition, a circumstance. It is the most sensitive field in the file
and the callee does not need it to book an appointment.

It is never included in the script, never sent to CALL-E, and never included in
any provider request. `preview` prints `reason field sent: no` so this is
checkable rather than merely claimed.

---

## 7. No hidden schedules, and no hidden calls

**Withheld runs no scheduler, no daemon, and no cron.** When a window is agreed
it emits a `ScheduledIntent` — `not_before`, `not_after`, the number to dial, and
the exact sentence that justifies it — and stops.

An app that decides both *whether* to call and *when* to call is an app that can
ring a stranger at three in the morning because of a parsing bug. Handing the
intent to a scheduler is the host's decision, made with the reason visible.

**Nothing is calculated silently.** Every scheduled intent carries the callee
turn that produced it. A window with no supporting turn is not a window.

**A window outside the person's stated hours is never accepted.** It is surfaced
with `halted_reason` for a human to widen or refuse. The agent does not decide
the person is probably free.

`src/core/chain.ts`

---

## 8. No duplicate calls

Every leg carries `idempotencyKey: <errand_id>:leg-<n>`, stable across retries.
A crash between submitting a call and recording it cannot put a second call
through to the same person.

A chain also stops after `maxLegs` (default 3) whatever happens. An errand that
will not converge is an errand for a human, not a reason to keep dialing.

`src/core/chain.ts`, `src/core/calle.ts`

---

## 9. Cancellation

There is nothing running to cancel.

Because Withheld holds no timer and no queue, cancelling a pending leg means
discarding the `ScheduledIntent` — there is no background job to kill, no
subscription to end, and no state that keeps dialing if you walk away. A process
that is not running cannot call anybody.

An in-flight call can be stopped with Ctrl-C, and `run --real` waits three
seconds after announcing the callee before dialing, specifically so that is
possible.

---

## 10. Credentials

Two surfaces, two credentials; both are treated the same way.

- `CALLE_API_KEY` is read from the environment, used server-side only.
- The `calle` CLI's OAuth token is held by the CLI in its own cache. Withheld
  never reads it, never copies it, and never passes it as an argument — it only
  asks the CLI whether the login is `usable`.
- Neither is ever logged, written to disk by this app, or sent to the browser.
- No `.env` file is committed, and none is required.
- The tests, the CLI in replay mode, and the console all run with no credential
  at all.
- The SDK base URL is pinned to `https://api.heycall-e.com` or a loopback
  simulator. Anything else throws before the key is used, because a mistyped
  `CALLE_BASE_URL` is otherwise a silent credential leak.
- The CLI binary is resolved explicitly, skipping `node_modules` on `PATH`,
  because the SDK package installs a different binary under the same name.
  `CALLE_CLI_BIN` overrides the choice.

`CalleProvider` and `approvedBaseUrl` in `src/core/calle.ts`

---

## 11. The dry-run path is the default

Every command except `run --real` replays recorded transcripts. The full test
suite, the whole CLI, and the entire console run with no API key, no network,
and no calls. The CLI provider takes an injectable runner, so no test can shell
out to the real `calle` binary even by accident.

`run --real` is the only code path that can make a telephone ring. It:

1. refuses to construct a provider without a usable credential — `CALLE_API_KEY`
   for `--via=sdk`, or a `calle auth status` reporting `usable: true` for
   `--via=cli`. A pending or expired login is a refusal, not a retry;
2. requires the literal `--real` flag;
3. prints the callee's name and the surface it will dial through, then waits
   three seconds first.

### Re-dialling is not a safe default

The CLI has no idempotency key, so a failed submission is genuinely ambiguous:
the call may or may not already be placed. When the CLI reports
`call_started: "unknown"` with `retry_safe: false`, Withheld stops and hands off
to a human rather than resubmitting. The cost of stopping is a delayed errand;
the cost of guessing is phoning a real person twice.

---

## 12. Numbers committed to this repository

Every number in every committed file is from a range regulators have guaranteed
can never be allocated to a subscriber — Ofcom's `07700 900xxx` and
`020 7946 0xxx`, and NANP `(XXX) 555-01xx`.

`src/core/numbers.test.ts` walks every errand file and fixture on each test run
and fails on anything outside those ranges.

---

## 13. What Withheld cannot protect against

Stated plainly, because a safety document that only lists successes is marketing.

- **It cannot stop a business recording the number by other means.** It controls
  what its own agent says. That is the part it can control, so it controls it
  completely.
- **It cannot guarantee the model phrases a refusal well.** It can guarantee the
  model has no number to give, and it verifies afterwards that none was given.
- **It does not obtain consent.** The errand file is the record of what the
  person authorised; Withheld enforces that record, it does not create it.
- **Window parsing is English and rule-based.** When it cannot read a phrasing it
  returns `window_unconfirmed` rather than guessing — the correct failure, but a
  failure.
- **A call still involves a stranger on a phone line.** Nothing here makes that
  risk-free for either party.

---

## Reporting a problem

Open an issue. If it concerns a disclosure path — any route by which the
person's number could reach the callee — say so in the title and it will be
treated as the highest priority thing in the project, because it is.
