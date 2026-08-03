# Waitlist Backfill

A cancellation just opened a slot. This app phones the waiting list **one person at a time**, stops
at the first person who says yes, and never calls anyone behind them.

Reminder and confirmation calls go out to someone who already has an appointment. Backfill is the
inverse: an appointment nobody has yet, and a short window to give it away. It is the phone task
with an obvious cost attached — an unfilled slot is revenue that simply does not happen — and it is
tedious enough that it usually does not get done at all.

![A completed backfill run: six people on the waiting list, three stopped by guardrails with their
reason codes, one called who declined, one called who accepted, and one never called because the
slot had already gone.](docs/run.png)

Six people on the list, two calls placed, one slot filled, and a written reason for each of the
four phones that never rang. Reproduce it with `CALLE_MODE=simulate node server.mjs` — no account
and no credentials needed.

## Why sequential, and not the API's multi-recipient fan-out

The CALL-E API can take a list of recipients and ring them together. For this task that is the
wrong behaviour, so this app deliberately does not use it.

There is exactly one slot. Fan-out means everyone hears about an appointment that is probably
already gone by the time they pick up, and if two people say yes you have promised the same slot
twice and now have to phone one of them back to take it away. Sequential calling with a hard stop
at the first acceptance is slower in wall-clock terms and correct in every other way.

The suppression is the part worth watching. Priya Raman passes every check and would have been
called; she is not, because the slot went two positions earlier. **Calls not placed are the
feature**, and the log records why for each one.

## Run it

Nothing here needs credentials, an account, or a network connection.

```bash
npm test                  # 45 tests, no credentials, no network, no child processes
node cli.mjs --dry-run    # walk the list, place nothing
node cli.mjs --simulate   # the full loop, acceptance and suppression, against a fake transport
node server.mjs           # web workbench on http://localhost:8787
```

To see the whole run in the browser, including the acceptance:

```bash
CALLE_MODE=simulate node server.mjs
```

### Placing real calls

```bash
npm install
CALLE_MODE=live CALLE_API_KEY=sk_... node server.mjs
```

Live mode is gated three times. The server needs `CALLE_MODE=live` and a key; the request needs the
**operator token** the server prints at startup; and the operator has to name the specific slot id.
A general "yes" does not authorise a call, and neither does merely being able to reach the port.

The token exists because the browser-origin checks answer a different question. `Origin`,
`Sec-Fetch-Site` and the JSON content type establish that a request did not come from another
website; none of them establishes that a person sent it, and a direct HTTP client is not a browser.
So anything that can dial requires authentication, and in live mode the slot id is withheld from
`/api/scenario` as well, since publishing it would hand over half of the confirmation gate.

The server binds **loopback only** by default. Set `HOST` deliberately if you want otherwise; it
warns on startup when you do.

| Variable | Meaning |
| --- | --- |
| `CALLE_MODE` | unset for preview, `simulate` for the full loop with no calls, `live` for real calls. |
| `CALLE_API_KEY` | Required for `live`. Read from the environment only, never stored or logged. |
| `CALLE_OPERATOR_TOKEN` | Optional. Pins the live-mode token across restarts; one is generated per start otherwise. |
| `CALLE_BASE_URL` | Optional override. Defaults to the SDK's `https://api.heycall-e.com`. |
| `HOST` | Defaults to `127.0.0.1`. |
| `PORT` | Defaults to `8787`. |

## Side effects

- **Live mode places real outbound phone calls**, one at a time, stopping at the first acceptance.
- Preview and simulate modes place none, ever. They are the default; live is opt-in twice over.
- No recurring jobs and no scheduling. One run is one slot. Nothing is queued for later, so there
  is nothing that can fire unattended tomorrow.
- Nothing is written outside the process. The audit trail is returned to the caller and streamed to
  the browser; wiring it to storage is left to whoever adopts this.
- Each call carries a deterministic idempotency key, `backfill:<slot>:<contact>:<attempt>`, so
  re-running a slot that appears to have hung will not ring the same person twice.

## Cancellation

`POST /api/cancel` stops the run before the next call. Closing the browser tab does the same, since
the run is bound to the request. Cancellation is checked immediately before each call is placed, so
the worst case is one call already in flight.

There is no "cancel this specific call" path, because [the CALL-E API does not expose
one](#feedback-for-the-calle-team).

## Guardrails

Every one of these produces a machine-readable reason code that ends up in the audit trail. They
are checked before the call, not after it.

| Check | Refuses when | Reason code |
| --- | --- | --- |
| E.164 | The number is not `+` followed by 8-15 digits | `invalid_phone` |
| Consent | No consent on file, revoked, or granted for a different purpose | `no_consent_on_file`, `consent_revoked`, `consent_scope_mismatch` |
| Content boundaries | The operator's message strays into medical, legal, financial or emergency territory | `boundary_*` |
| Quiet hours | Local time is outside the calling window, in **the contact's** timezone | `quiet_hours`, `outside_calling_days` |
| Timezone | The contact's timezone is unknown or is not an IANA zone | `timezone_missing`, `timezone_not_iana`, `timezone_unknown` |
| Frequency cap | This person has already been called too often this week | `frequency_cap` |
| Explicit intent | Live mode was requested without naming the slot | `intent_not_confirmed` |

Phone numbers are masked to `+1********78` everywhere they are logged or displayed. A test asserts
that no raw number from the waitlist appears anywhere in the emitted events.

### The timezone refusal

Tomas Lindqvist is first on the waiting list and is never called, because nobody recorded his
timezone at intake.

Guessing here is easy and wrong. `+1` spans six zones. `EST` is ambiguous between North America and
Australia. A stored UTC offset is correct until the next daylight-saving change and silently wrong
after it. Any of those guesses puts an automated call into somebody's evening, which is precisely
the failure the quiet-hours check exists to prevent — so a guessed timezone is worse than no call at
all.

`resolveTimeZone()` accepts an explicit IANA identifier and nothing else. This is
[design principle P4](../../../docs/design-principles.md) implemented rather than described: no
inference from phone number, country code, locale, language, IP address, abbreviation, or offset.
The fix for Tomas is to ask him and record it, which is a data-entry problem, not a call problem.

## Testing

```bash
npm test
```

45 tests, no credentials, no network, and nothing spawned, so the suite runs identically in a
restricted sandbox. `npm test` names the test files explicitly rather than passing the directory,
because `node --test test/` makes Node try to load the directory itself as a module and fails
before running anything.

`test/http.test.mjs` drives the request handler directly with stub request and response objects,
which is why the rules about who may start a run — the one-run lock under concurrent requests,
operator authentication, the cross-site refusals — are ordinary unit tests rather than something
requiring a live port.

The assertions that matter most are the negative ones — that a call was *not* placed:

- preview mode places zero calls whatever the list says
- a live request whose confirmation names the wrong slot places zero calls
- the person behind the acceptance is never called, even though the fixture scripts her to say yes
- a fake transport never announces that real calls will be placed
- no unmasked phone number reaches the audit trail

Every number in `data/scenario.sample.json` is in the `+1 555 01xx` reserved fictional range.

## Files

```text
waitlist-backfill/
├── server.mjs              web workbench, streams decisions over SSE
├── cli.mjs                 headless runner: --dry-run | --simulate | --execute
├── src/guardrails.mjs      the pre-flight checks, each returning a reason code
├── src/backfill.mjs        the sequential run loop and the suppression rule
├── src/calle.mjs           FakeCalleClient (default) and LiveCalleClient (@call-e/calle)
├── public/index.html       single file, no build step, no external assets
├── data/scenario.sample.json
└── test/backfill.test.mjs
```

## Adapting it

`data/scenario.sample.json` is the whole input: a slot, a message, a policy, an ordered waitlist,
and prior call history for the frequency cap. Point `cli.mjs --scenario <path>` at your own file.

Two fields have no sensible default and must be supplied per contact: `phone` in E.164, and
`timeZone` as an IANA identifier. Contacts missing either are skipped with a reason rather than
guessed at.

`scriptedAnswers` only affects the fake transport. Live mode gets its answers from the callee, via
`recipientResultSchema`, which constrains the reply to `yes`, `no`, or `callback_requested`.

## Feedback for the CALL-E team

Things found while building this, offered as feedback rather than complaint:

1. **`docs/design-principles.md` P6 makes cancellation first-class, but the public API has no cancel
   endpoint.** `CallStatus` includes `"canceled"`, and no documented path reaches it. This app can
   stop *before* the next call but cannot stop one already ringing.
2. **P7 requires a dry-run path, but the API has no test mode.** Every contributor hand-rolls a
   different fake — compare the one in this app with PR #28's and PR #29's. A `calle_test_` key
   prefix, or an official mock server under `apps/shared/`, would make these comparable.
3. **The docs site is a client-rendered shell.** Fetching `docs.heycall-e.com` returns no readable
   content, so an agent has to read the `.d.ts` files in the npm tarball to learn the API. An
   `llms.txt`, or server-rendered docs, would fix this for exactly the audience the product targets.
4. **The `beta` dist-tag is stale.** `@call-e/calle@beta` resolves to `0.1.0-beta.1` while `latest`
   is `0.2.2`. Install instructions that say `@beta` hand people the older package.
5. **`scripts/check-generated-skill.mjs` fails on Windows.** Line 411 tests
   `text.startsWith("---\n")`, while every other line-split in the same file uses `/\r?\n/`. A
   `SKILL.md` written with CRLF endings is reported as having no frontmatter, so
   `validate_repository.py` fails on a clean checkout. Submitted separately as a one-line fix.
