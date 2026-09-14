# Withheld

**A callback is a door you cannot open. So never accept one.**

Every errand ends the same way: *"we'll call you back."* For most people that is
mildly annoying. For someone who cannot answer a phone — Deaf, non-speaking, a
speech disability, or simply no ability to hold a spoken conversation with a
stranger at an unannounced moment — that sentence ends the errand. Not delays
it. Ends it.

Withheld is an errand engine built on CALL-E. It places the call, and when the
other side offers to ring back, **it declines and asks for a time window
instead** — then calls back itself, inside that window. The person never
answers a phone, at any point, and the business never has a number to ring.

The number is not withheld by asking the model nicely. It is never put in the
model's reach.

---

## What it actually does

```
$ npm run withheld -- replay data/errands/clinic-referral.json

  Leg 1  fixture:window-agreed
    status            window_agreed
    number disclosed  false

    answers (transcript-bound)
      q_slot: Dr Mwangi has Tuesday the fifteenth at half nine, or the Thursday afternoon.
        ↳ "Dr Mwangi has Tuesday the fifteenth at half nine, or the Thursday afternoon."
      q_interpreter: I would have to check with the coordinator about the interpreter.
        ↳ "I would have to check with the coordinator about the interpreter. I can ring you back once I know."
      q_referral: not answered

    agreed window
      Tuesday 15 September, 10:00 to 12:00
        ↳ "Try me tomorrow between ten and twelve, I'll have spoken to her by then."

  Leg 2  fixture:errand-complete
    status            errand_complete
    number disclosed  false

  Errand complete.
```

Two calls, one appointment booked and an interpreter arranged. Amina answered
neither call, and the practice never had a number for her.

---

## The idea in one paragraph

Existing agents that call on your behalf are **outbound-only and one-shot**.
They place a call, get an answer, and return. But real errands are rarely one
call, and the second leg almost always arrives as an *inbound obligation* — "the
nurse will phone you", "our manager will call you back this afternoon". For the
people who most need an agent to make calls for them, an inbound call is exactly
the thing they cannot do. The agent solves the easy half of the problem and
hands back the hard half.

Withheld closes the loop by refusing the inbound leg on principle. Every
callback becomes a scheduled outbound call. Non-disclosure of the number stops
being a privacy nicety and becomes the mechanism.

---

## Why the number is safe

Four independent layers, none of which is "we told the model not to".

| | |
| --- | --- |
| **It is never in the script** | `buildScript` refuses to emit a script that contains the person's number, and the CLI's `preview` shows you the gate result before anything dials. A model cannot say what it was never given. |
| **There is no field to put it in** | The result schema sent to CALL-E has no slot for a phone number in either direction. There is nothing to fill in. |
| **The transcript is re-scanned afterwards** | Every leg checks the caller's turns for the number in *any* form — punctuated, regrouped, or read aloud as "oh double seven oh oh…", which is how a number would actually leak on a phone call. |
| **A leak outranks everything** | A leg that discloses the number is `outcome_unknown` and stops the chain, even if the appointment was booked. A successful errand with a leaked number is not a successful errand. |

The number lives in the errand file for exactly one reason: so the app can
**prove** it was never said. It never reaches CALL-E, never reaches the browser,
and never appears unmasked in any report.

---

## Quick start

```bash
npm install
npm test          # 123 tests. No API key, no network, no calls.
npm run dev       # the console at http://localhost:3000
```

The console opens on the ordinary case and runs entirely on recorded calls. Each
scenario is linkable — `?s=leaked` goes straight to the call where the number
gets out, which is the one worth looking at.

Nothing above places a phone call or needs a credential.

### CLI

```bash
# Show the script CALL-E would receive, and every gate it passed. No call.
npm run withheld -- preview data/errands/clinic-referral.json

# Run the full errand against recorded transcripts. No call.
npm run withheld -- replay data/errands/clinic-referral.json
npm run withheld -- replay data/errands/clinic-referral.json --legs=number-demanded

# List the recorded calls and what each one stages.
npm run withheld -- fixtures

# Place real calls. Requires a CALL-E credential and the explicit flag.
CALLE_API_KEY=sk_... npm run withheld -- run data/errands/clinic-referral.json --real

# ...or use the `calle` CLI you already logged into, with no API key at all.
npm run withheld -- run data/errands/clinic-referral.json --real --via=cli
```

`run --real` is the only command that can make a telephone ring. It refuses to
start without a usable credential, prints the callee's name and which surface it
will dial through, and waits three seconds so you can stop it.

---

## How CALL-E is used

CALL-E ships two surfaces, and which one you can use depends on how you
installed it. Withheld supports both, because the published installation guide
ends at `calle auth login` and never produces an API key — so an SDK-only
integration would be unreachable for most people following the official path.

| Surface | Package | Endpoint | Credential | Flag |
| --- | --- | --- | --- | --- |
| Developer API | `@call-e/calle` `0.7.0` | `api.heycall-e.com` | `CALLE_API_KEY` | `--via=sdk` |
| MCP CLI | `@call-e/cli` | `seleven-mcp-sg.airudder.com` | brokered OAuth | `--via=cli` |

Default: `sdk` when `CALLE_API_KEY` is set, otherwise `cli`. Both go through one
`CallProvider` interface, so the chain logic below is identical either way — and
so every gate is enforced regardless of which surface placed the call.

### The SDK path

Withheld uses the official TypeScript SDK, [`@call-e/calle`](https://www.npmjs.com/package/@call-e/calle) `0.7.0`.

```ts
const call = await client.calls.createAndWait(
  {
    task: script.goal,              // generated, and gated before it is sent
    recipient: { phones: [to], locale: 'en-US' },
    recipientResultSchema: RECIPIENT_RESULT_SCHEMA,
    metadata: { app: 'withheld' },
  },
  { idempotencyKey: `${errand_id}:leg-${n}`, timeoutMs },
);
```

Three decisions worth naming, because they are where the work is:

**CALL-E's own verdict is recorded and never used.** `taskCompleted` and
`completionConfidence` are the provider's assessment of whether it succeeded.
They are stored as telemetry and no decision reads them. Every answer Withheld
reports is re-derived from `transcriptTurns` and carries the turn that supports
it. If CALL-E returns `errand_resolved: "yes"` and no turn says so, the report
says *not answered — CALL-E returned an answer, and no turn supports it.*

**`unknown` speakers stay unknown.** CALL-E labels each turn `bot`, `user`, or
`unknown` when diarisation fails. Rounding `unknown` to either side would invent
evidence: read as `user` it could confirm a booking nobody made; read as `bot` it
could convict the agent of a leak it did not cause. An unattributed turn can
never confirm a window or bind an answer — but it is still scanned for the
number, because a number audible on an open line was disclosed whoever said it.

**No-answer is folded up from the attempt, not read off the call.** CALL-E's call
status is `queued | in_progress | completed | failed | canceled` — there is no
call-level "nobody picked up", because one call task can hold several recipients
and several attempts. A `completed` task in which the callee never spoke is
reported as a no-answer rather than as a call where nothing was agreed, because
those are not the same thing and the second one quietly becomes *"they said no"*.

### The CLI path

`--via=cli` shells out to the `calle` binary with `execFile` and an argument
array — never a shell, because the goal text is assembled from an errand file
and a stray backtick in a clinic's name would otherwise be command execution.
It starts a run, then polls `calle call status` every ten seconds until the
status is terminal.

The CLI gives less than the SDK does, and each gap is closed by giving up
capability rather than by guessing:

- **The transcript arrives as one string, not labelled turns.** The parser
  attributes a line only when it carries a speaker label it recognises. Anything
  else becomes an `unknown` turn, and — deliberately — an unlabelled line is
  *not* appended to the previous speaker. The two ways of being wrong are not
  symmetric: wrongly crediting the callee could confirm a booking nobody
  offered. Unknown turns are still scanned for the number.
- **There is no `recipientResultSchema`.** So there are no provider claims at
  all on this path. It costs nothing, because Withheld never trusted them.
- **There is no idempotency key.** When the CLI reports `retry_safe: false`, a
  submission may already be in flight, so Withheld stops rather than retrying.
  Re-dialling a person to be safe is not safe.

> **A name collision worth knowing about.** Both `@call-e/cli` and the SDK
> `@call-e/calle` install a binary called `calle`, and they are not
> interchangeable. With the SDK as a project dependency, `node_modules/.bin`
> shadows the real CLI and every command fails with `Unknown command: auth`,
> which reads like a broken install. Withheld resolves the binary itself and
> skips `node_modules` on `PATH`; `CALLE_CLI_BIN` overrides it. This is
> reported in the feedback survey.

---

## What the report will not claim

Withheld says *unproven* more often than it says *yes*. These are deliberate,
and each is a test.

- **A window needs someone to name a time.** The caller must have asked, and a
  *callee* turn after that point must name an actual time. "Sure, that's fine"
  names nothing and confirms nothing → `window_unconfirmed`.
- **A no-answer is a disposition, not a finding.** Nobody picking up is not the
  clinic declining. No verdict is drawn.
- **An unfinished call yields nothing.** `queued` and `in_progress` produce no
  verdict, no window, and no privacy finding, because there is nothing yet to be
  right or wrong about.
- **Holding the line is the success, not the errand.** When the callee demands a
  number and the agent has none, that is `number_demanded` — the invariant held,
  and the errand still goes to a human. It is not dressed up as progress.
- **A window outside the person's stated hours is not agreed.** It is surfaced
  for a human to widen or refuse. The agent does not decide the person is
  probably free.

---

## Side effects, cancellation, and scheduling

**Side effects.** `run --real` places outbound phone calls through CALL-E and
consumes call credits. Nothing else in this repository contacts anything.

**Cancellation.** Withheld runs **no scheduler, no daemon, and no cron.** When a
window is agreed it emits a `ScheduledIntent` — a description of a call to be
placed, with `not_before`, `not_after`, and the exact sentence that justifies it
— and stops. Handing that to a scheduler is the host's job.

That separation is deliberate. An app that decides both *whether* to call and
*when* to call is an app that can ring a stranger at three in the morning
because of a parsing bug. To cancel, discard the intent; there is no background
job to kill and nothing to unsubscribe from.

**Repeat calls.** Every leg carries `idempotencyKey: <errand_id>:leg-<n>`, so a
crash between submitting a call and recording it cannot put a second call
through to the same person.

**Ceiling.** A chain stops after `maxLegs` (default 3) whatever happens. An
errand that will not converge is an errand for a human.

---

## Credentials

`CALLE_API_KEY` is read from the environment, used server-side only, and never
logged, never written to a file, and never sent to the browser. There is no
`.env` in this repository and no key is required to run the tests, the CLI in
replay mode, or the console.

The base URL is pinned: Withheld will only talk to `https://api.heycall-e.com`
or a loopback simulator, and throws otherwise. A mistyped `CALLE_BASE_URL` is
otherwise a silent credential leak.

---

## Phone numbers in this repository

Every number in every committed file is from a range regulators have guaranteed
can never be allocated:

- Ofcom drama ranges — `07700 900xxx` mobile, `020 7946 0xxx` London landline
- NANP — `(XXX) 555-01xx`

`src/core/numbers.test.ts` walks every errand file and fixture and fails the
build on anything outside those ranges. A plausible number in a public sample is
a real telephone in someone's house, which would be a peculiar way for an app
about not disclosing numbers to fail.

---

## Layout

```
src/core/
  types.ts        domain types; terminal statuses
  budget.ts       the speech gate — spoken-digit expansion, masking, scanning
  callback.ts     the callback gate — offers, number demands, window extraction
  transcript.ts   evidence binding; provider claims that nothing supports
  script.ts       script generation, and the gate that can refuse to dial
  leg.ts          one call → one verdict
  chain.ts        multi-leg errands and scheduled intents
  calle.ts        FixtureProvider (default) and CalleProvider (SDK, --via=sdk)
  calle-cli.ts    CalleCliProvider (the `calle` CLI, --via=cli)
src/app/          the console; the server/client boundary the number cannot cross
scripts/          the CLI
fixtures/legs/    eight recorded calls, doubling as test vectors
data/errands/     the demo errand
```

---

## Prior art, and what is different

[`call-on-behalf`](../call-on-behalf) in this repository already makes a
delegated call for someone who cannot make it themselves, and it is the closest
neighbour by a wide margin. Read it before this one.

**What the two share, and why.** Both authorise a list of facts the caller may
state, scan the script before dialling and the transcript afterwards, mask
findings in the report, bind every reported answer to a callee turn, accept
commitments only inside declared windows, and keep the person's reason for
delegating out of the call entirely. That convergence is not coincidence and is
not a claim of originality on this side: those are close to the only defensible
answers to "what may a machine say about someone on a call," and anyone
building carefully in this space arrives at most of them. Where the two
overlap, treat `call-on-behalf` as prior art.

**What is actually new here** is one sentence and its consequences: *"we'll call
you back."* `call-on-behalf` makes one call and ends when the call ends — a
callback offer is a fine outcome for it, because its user can take the callback.
Withheld's user cannot, so the offer is a dead end, and the app is built around
converting it: the agent declines the callback, asks for a window to call *in*,
and the errand continues across legs until it is done or a human is handed it.
Two things fall out that `call-on-behalf` does not need and does not have — a
**callback gate** with its own status ladder and refusal path, and a **multi-leg
chain** that proposes when to dial next instead of scheduling it. Because no
callback is ever accepted, there is also no number to give, so the
never-disclose property stops being a promise the model has to keep and becomes
a fact about the schema.

Adjacent but not overlapping: [`is-it-accessible`](../../../skills/is-it-accessible)
and [`accesscall`](../../../skills/accesscall) ask venues about access and run
accessibility intake. They are about gathering access information, not about the
callback asymmetry.

---

## Limits

- **Window parsing is English and rule-based.** It reads "tomorrow between ten
  and twelve", "Tuesday afternoon", "after two". It will not read every phrasing
  a person can produce — and when it cannot, it returns `window_unconfirmed`
  rather than guessing, which is the correct failure.
- **Withheld cannot stop a business writing the number down elsewhere.** It
  controls what its own agent says. That is the part it can control, so it
  controls it completely.
- **Consent is presumed to exist before the errand file does.** The file is the
  record of what the person authorised. Withheld enforces that record; it does
  not obtain it.
- **This is a demo, not a supported product API.**

---

## When not to use this

- **Emergencies.** Never for 999/911/112 or any urgent medical, safety, or
  crisis call. Use the relay services designed for it — in the US, [FCC
  TRS/711](https://www.fcc.gov/trs); most countries have an equivalent.
- **As a relay service.** Withheld is not a relay and does not pretend to be a
  person. The agent identifies itself as automated in its first sentence and
  says so again if asked directly.
- **Anything requiring identity verification, payment, or legal consent** on the
  call. The may_say list is a list of facts, not a mandate.
- **Calling someone who has asked not to be called.**

---

## Licence

MIT.
