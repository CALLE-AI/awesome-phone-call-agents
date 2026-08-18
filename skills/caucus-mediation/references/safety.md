# Safety

## Side effects

- At most **one outbound phone call per step invocation** (`caucus_step_case` over MCP, `caucus run --step` on the CLI, one Enter in the interactive runner). There is no loop that dials on its own, no scheduler, no background retries: every call is a separate, explicit operator or agent decision.
- Real dialing is **doubly opt-in**: the CALL-E client is a deterministic mock unless a live flag is passed *and* `CALLE_API_KEY` is present in the environment. `caucus_open_case` and `open` never dial at all — the first calls a case can ever place are the two consent calls, via a step.
- Every rendered call carries a deterministic idempotency key (`caseId:round:callee:purpose`), so a blind re-step after a crash is deduplicated by the call layer instead of double-dialing a person. A deliberate retry after a failed call is a new operator decision with a fresh key suffix.
- Local files only: the case ledger is a local SQLite file, and memoranda are written to paths the operator names. Nothing is transmitted anywhere except the CALL-E API itself.

## Consent and disclosure

- Consent is a **state the machine cannot skip**: no shuttle or attestation call is reachable until both parties have said yes on their own recorded consent call. This is enforced by the state machine, not by prompt discipline, and is pinned by tests.
- The consent script disclosures are fixed text: the call is recorded and captured as structured notes; the mediator is a neutral automated caller working for both parties; the process is voluntary and non-binding; this is not debt collection; the callee may leave at any time. Every later call re-discloses recording.
- Consent extraction is strict: silence, politeness, or staying on the line never count; anything unclear is recorded as `unknown` and the case does not advance. A "no" is terminal for the whole case.
- Either party can exit at any time; the operator can cancel a case; every case carries a TTL after which it expires rather than dialing again.

## Data handling

- Each party's private intake (their reservation bound, their notes) **never enters the other party's call** — enforced by a compile-time type proof plus a runtime scan that throws instead of dialing (see `docs/safety-pattern-information-flow-control.md`). What IS relayed is exactly what a party offered aloud for relay: amount, stated conditions, approved rationale.
- Phone numbers are masked to their last four digits on every export surface: memorandum, dashboard, static replay, MCP status output. The local ledger holds full numbers because a case must be re-dialable from the ledger alone — treat the `.db` file as sensitive, do not commit or share it.
- All sample numbers in this skill are reserved fictional numbers such as +15550000001.
- No credentials are stored: `CALLE_API_KEY` is read from the environment at call time only. Mock mode — the default everywhere — needs no credentials and no network.
- Transcripts contain real people's words. The memorandum quotes only the per-round evidence spans; the underlying call recordings live with the calling platform, under its policy.

## Medical, legal, financial, and emergency boundaries

This skill mediates **money disputes between consenting parties**. Those boundaries are load-bearing:

- **It is not legal advice and produces no binding outcome.** The consent script and every memorandum state this in fixed text: the memorandum is an automated neutral summary, not a contract, and parties should consult a licensed attorney before relying on its terms. The agent is instructed never to make or repeat legal claims or threats, never to predict outcomes, and to say plainly that it cannot advise either party if asked.
- **It is not a collections tool.** Mediation requires a live two-sided disagreement and mutual recorded consent; a non-consenting party dead-ends the case at the consent call. Using the caller to pressure a debtor is exactly the deployment this design refuses: the shuttle protocol is symmetric, and neutrality rules are embedded in every task.
- **It moves no money.** Caucus records what the parties agreed; performing the settlement is entirely between them.
- **No medical content.** Nothing in this skill collects or conveys health information; dispute summaries are drafted by the operator and should stay within the money dispute.
- **Never for emergencies or crises.** This places non-urgent, consent-gated calls and can reach voicemail or nobody.

## Neutrality

Every task string instructs the agent: never pressure, never advise, never share opinions about who is right. The only quasi-evaluative content is a neutral midpoint observation, voiced only when both parties' own public offers already straddle it — and the renderer fails closed if that midpoint would collide with either party's private bound.

## What the artifacts do and do not prove

- A verified dual attestation proves the person answering each party's phone heard the **same recorded terms** (same digest-derived code on two distinct calls). It does not authenticate who that person was, and it cannot prove ASR heard the speaker perfectly — on a real settled case, a spoken "keys" was captured as "kids", and the parties attested to the terms as captured. Read the memorandum's terms before relying on them.
- The ledger is tamper-evident, not tamper-proof: verification detects any single-entry mutation, but not a rewrite of the whole tail by someone with write access, and a refused attestation attempt leaves no ledger entry (that evidence lives in the calling platform's logs).

## Retention

The ledger and memoranda contain real numbers (ledger) and real people's quoted words (both). This skill imposes no retention policy of its own because it does not know the operator's regime; delete case databases and memoranda when the dispute is closed, and never publish an unmasked ledger.
