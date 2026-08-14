# Safety pattern: consent-first mediation

When a workflow calls two people who are in conflict with each other, no
substantive call may be placeable until *both* have said yes on a recorded
consent call — not as policy, but because the state machine has no path to a
substantive call before both consents are recorded. Every later call
re-discloses recording; declining, cancelling, and expiry are terminal states.

**Reference implementation:**
[`apps/typescript/caucus`](../apps/typescript/caucus/) — consent gates in
`src/state.ts`, work scheduling in `src/runner.ts` (`pendingWork`), fixed call
scripts in `src/renderer.ts` (the `SCRIPT` table). Tests:
`test/state.test.ts` → *"consent"*, `test/renderer.test.ts`.

## Problem

An outbound voice agent that discusses money with strangers is one prompt away
from being a harassment machine. The failure modes are specific:

- calling someone about a dispute they never agreed to discuss;
- recording and structurally extracting what they say without telling them;
- an agent nominally "mediating" that in practice pressures one side —
  a collections call wearing a mediator's badge;
- a workflow with no way for a participant to leave, or that keeps calling
  after the matter should have lapsed.

None of these are solved by good intentions in a prompt. They are solved by
making the unwanted call *unreachable* in the orchestration, and by putting
the disclosures in the fixed part of the task text where every call gets them.

Several apps in this repository are consent-first toward a single principal.
The two-party case is harder: the parties are opposed, so consent cannot be
assumed transitive — each party must consent separately, and the workflow must
be structurally unable to start relaying offers until both have.

## The pattern

1. **Consent is a state, not a checkbox.** The case starts in a consent state
   per party. The only call renderable in those states is the consent call.
   Substantive calls exist only in states reachable *after* every party's
   consent has been recorded.
2. **Consent is recorded evidence.** The "yes" is spoken on a recorded call,
   extracted as structured data, and written to an append-only log with the
   call id — so "they agreed to this process" is provable later, from the
   same evidence chain as everything else.
3. **Ambiguity is not consent.** An unclear answer leaves the case exactly
   where it was; only an explicit yes advances it, and an explicit no
   terminates it.
4. **Disclosure on every call, not just the first.** Recording and structured
   capture are disclosed prominently on the consent call and re-disclosed in
   brief on every subsequent call.
5. **Neutrality lives in the fixed template.** The neutrality rules are part
   of every call's task text — not a per-case judgment an operator could skip.
6. **Exit is always available and always terminal.** Decline, cancellation,
   and TTL expiry each land in a terminal state from which no further call is
   ever rendered.

## Reference implementation

### The consent gate in the state machine

Case flow (`src/state.ts` header):
`created → consent_pending_a → consent_pending_b → rounds_active → … → settled`.

`handleConsent` accepts a consent result only in a consent state, only from
the party being waited on:

```ts
const expected: PartyId | null =
  rec.state === "consent_pending_a" ? "A" : rec.state === "consent_pending_b" ? "B" : null;
if (expected === null || ev.party !== expected) return noop(rec);
if (ev.result.outcome !== "completed" || ev.result.structured === null) return noop(rec);
const parsed = consentResultSchema.safeParse(ev.result.structured);
if (!parsed.success || parsed.data.consent === "unknown") return noop(rec); // retry is the caller's job
```

An explicit "no" commits `declined_consent` — a terminal state — and drafts a
`consent_declined` ledger entry carrying the party and the call id. A "yes"
drafts `consent_recorded` with the same provenance. Pinned by
`test/state.test.ts` → *"a refusal terminates the case as declined_consent"*,
*'an "unknown" consent is a no-op that leaves the record untouched'*, and the
idempotency tests (a re-delivered consent webhook changes nothing).

The orchestrator side (`src/runner.ts` → `pendingWork`) maps states to work:
consent states render only consent calls; shuttle calls are rendered only in
`rounds_active`, which is unreachable until both `consent_recorded` events
exist. There is no code path that renders a shuttle or attestation call
earlier — the gate is structural, not conventional. On the app's live settled
case (13 real CALL-E calls), the two recorded consent calls preceded all six
negotiation rounds, in exactly this order, with both `consent_recorded`
entries in the verified hash chain.

### Disclosure and non-coercion, verbatim from the template

The consent call (`renderConsentCall` in `src/renderer.ts`) is assembled from
fixed `SCRIPT` entries. The load-bearing ones:

- **Recording, before anything else is asked:** *"Disclose clearly, before
  asking anything else: this call is recorded, and the key points of what the
  callee says are captured as structured notes used to run the mediation."*
- **Not legal, not binding:** *"Caucus is not a law firm, it never gives legal
  advice, and nothing in this process is legally binding on its own."*
- **Not collections:** *"Make clear that this is a voluntary mediation of a
  disputed amount, not a debt collection call, and that the callee may leave
  the process at any time."*
- **Explicit consent, ambiguity fails safe:** *"…wait for a clear answer in
  the callee's own words… Do not treat silence, politeness, or simply staying
  on the line as consent. If they decline, thank them and end the call
  politely."*

Every shuttle and attestation call includes `SCRIPT.recordingBrief` — a
re-disclosure that the call, like the earlier ones, is recorded and captured.

### Neutrality as template, and refusal to be a collections agent

`SCRIPT.neutrality` is appended to **all three call types** (consent, shuttle,
attestation): never pressure, never advise, never predict outcomes, never make
or repeat legal claims or threats, never share opinions about who is right;
if asked for advice, say a neutral go-between cannot advise either party.

Structure backs the words. The system requires *both* sides' consent before it
will relay a single number, either side can end the process at any time, and
the relay itself is symmetric — `SCRIPT.relayLead` instructs the agent to
convey proposals *"exactly as stated, without commentary or embellishment"*.
Even the negotiation engine's midpoint hint is only voiced when it is
justifiable from both parties' own public offers (the straddle rule,
`test/renderer.test.ts` → *"engineHint straddle rule"*). A one-sided
collections workflow cannot be expressed in this state machine: there is no
state in which one party is called repeatedly about an amount the other party
never engaged with.

### Cancellation and expiry

- **Cancel:** a `cancel` event moves any non-terminal state to `cancelled`
  and records the reason (`case_cancelled` ledger entry). Terminal states
  ignore it — no resurrection.
- **Expiry:** every case has `policy.ttlHours`. A clock tick at or past the
  deadline commits `expired`; `test/state.test.ts` → *"expiry wins over any
  other pending work"* pins that an expired case expires even when a call
  would otherwise be owed.
- Terminal means terminal: `pendingWork` returns `{ kind: "none" }` for every
  terminal state, so no call is ever rendered for a declined, cancelled,
  expired, settled, or impasse case.

### Dialing discipline around the gate

Two adjacent safeguards are part of the same story:

- The CLI cannot dial a real number by accident: the CALL-E client is a mock
  unless `--live` is passed *and* `CALLE_API_KEY` is set (`src/cli.ts`). The
  no-call mode is the default, matching this repository's rule that live
  verification is opt-in.
- `runStep` performs exactly one unit of work per invocation, and `runCase`
  takes a hard `maxSteps` bound — no loop is handed open-ended authority to
  redial humans (`src/runner.ts`).

## Applying it to your own CALL-E workflow

1. Model consent as one state per consenting party, ahead of every substantive
   state. Let your "what call is owed next" function be total over states —
   then the gate is enforced by construction, not by review.
2. Extract consent as a three-valued enum (`yes` / `no` / `unknown`) and treat
   `unknown` as a no-op, never as yes. Let the retry policy live with the
   caller, not inside the state machine.
3. Log consent and decline with the call id, in the same append-only log as
   the rest of the case, so consent is auditable evidence.
4. Put recording disclosure and your non-coercion rules in the fixed template,
   and re-disclose briefly on every later call. Write tests that assert the
   disclosure strings are present in every rendered task.
5. Give every case a TTL and a cancel path, both terminal, and make your
   work-scheduler return "nothing" for all terminal states.

## Limits

- **The task text instructs an LLM; it does not mechanically constrain it.**
  Disclosure and neutrality are in the prompt of every call, and the prompt is
  the strongest lever a CALL-E integration has — but what is literally said
  on the line is produced by the platform's voice agent. The renderer's tests
  prove the instructions are present, not that they are followed.
- **Consent extraction is model-mediated.** A "yes" reaches the state machine
  through ASR and structured extraction. A misextraction is possible in both
  directions; the fail-safe direction is covered (`unknown` and malformed
  results are no-ops), and the recorded call remains the ground truth a human
  can audit.
- **No verification of who answered.** Consent is given by whoever answers the
  party's phone. Voice is not identity — see the app's
  [threat model](../apps/typescript/caucus/docs/threat-model.md) non-goals.
- **Quiet hours and retry pacing are policy, not yet enforcement.**
  `CasePolicy` declares a callee-local call window, cooling-off minutes, and a
  retry ladder, and tested helpers exist (`withinCallWindow`, `nextRetryAt` in
  `src/calle.ts`) — but `runStep` does not consult them; honoring them is
  currently the operator loop's responsibility. If you adopt this pattern,
  wire the window check directly in front of your dial call.
