# Information-flow control for multi-party call prompts

**Claim:** a call task rendered for party B structurally cannot contain party
A's private data — enforced by a type the compiler checks, and re-checked by a
runtime scan of the final string that throws instead of dialing.

**Reference implementation:** `src/renderer.ts`. Tests: `test/renderer.test.ts`.

## Problem

A voice-agent prompt is, in the end, one string. If your workflow holds data
about more than one person — two disputing parties, a patient and a clinic, a
buyer and a seller — then every template edit, every `JSON.stringify(record)`
convenience, every "just add the context object" refactor is a chance for one
person's private data to be *spoken aloud to the other person by a phone call
you placed*. Unlike a leaked log line, a spoken leak cannot be revoked, and in
a negotiation it is instantly exploitable: whoever learns the other side's
bottom line has won.

Prompt-injection discussion usually focuses on inputs. This pattern is about
the *output*: proving that a rendered task string cannot carry a secret across
a party boundary, and failing closed when that proof would not hold.

## The pattern

Two independent layers, with disjoint failure modes:

1. **A taint-safe projection type.** Every render function takes, as its *only*
   case input, a view type produced by a single projection function. The view
   has no field that can carry the other party's private data — not "we don't
   put it there", but "there is no key to put it in". A compile-time proof
   walks the view type recursively and fails the build if a forbidden key is
   ever added.
2. **A runtime scan of the final string.** After templating, scan the exact
   string that will be sent to the calling platform for every rendering of the
   other party's secrets (amounts in several formats, distinctive words of
   private notes, phone digits with formatting stripped). Any hit throws;
   the call is never placed.

Plus one rule that makes the scan usable in practice:

3. **The disclosure rule (false-positive rule).** A value the owner has
   *publicly disclosed in this process* — an amount they offered on a call, the
   agreed dispute total — is no longer a secret, even if it numerically equals
   their private bound. Without this exemption the scan false-positives on
   legitimate relays (parties routinely offer exactly their reservation).
   With it, everything undisclosed still fails closed.

## Reference implementation

### Layer 1 — the view type and its compile-time proof

`publicViewFor(rec, callee)` in `src/renderer.ts` projects the full
`CaseRecord` onto the only data a call to `callee` may speak. The other party
appears only as:

```ts
/**
 * The OTHER party as the callee is allowed to know them: display label only.
 * Structurally no `phone` and no `private` — this type is the mechanism.
 */
export interface TaintSafeOtherParty {
  id: PartyId;
  label: string;
}
```

The proof that no nesting of the view can carry private data is a recursive
key-walk at the type level:

```ts
type DeepKeys<T> = T extends readonly (infer E)[]
  ? DeepKeys<E>
  : T extends object
    ? { [K in keyof T & string]-?: K | DeepKeys<NonNullable<T[K]>> }[keyof T & string]
    : never;
type ForbiddenViewKeys = keyof PartyPrivate | "private";
type TaintSafeViewProof = [Extract<DeepKeys<TaintSafeView>, ForbiddenViewKeys>] extends [never]
  ? true
  : "TaintSafeView must not expose party-private fields";
const _taintSafeViewProof: TaintSafeViewProof = true;
```

If anyone adds a field named `private`, `notes`, or `reservationCents` anywhere
inside `TaintSafeView` — at any depth, including inside arrays — the constant
stops typechecking and the build fails. Because `ForbiddenViewKeys` is derived
from `keyof PartyPrivate`, adding a new private field to the contract type
automatically extends the proof.

This guard was verified to be load-bearing, not vacuous: during development a
deliberately leaky type (a `private` object nested inside an array two levels
deep) was compiled and confirmed to break the build. A guard nobody has ever
seen fail is not yet a guard.

### Layer 2 — templates that cannot smuggle

All fixed prose lives in one `SCRIPT` table in `src/renderer.ts`; the render
functions interpolate only view fields and formatted public amounts. So the
vocabulary of a legitimately rendered task is, *by construction*,
(template words) ∪ (public-view words). That property is not just tidiness —
the runtime scan below derives its allow-list (`TEMPLATE_VOCABULARY`) from the
same table, which is what lets it treat any other word as evidence of a leak.

### Layer 3 — the runtime tripwire

Every render path ends in one `finalize()` function, which calls
`assertNoTaint(task, rec, callee)` before returning. The scan checks the
final string for:

- **the other party's phone**: task digits with all formatting stripped, so
  `(555) 000-0002` and `+1 555 000 0002` both hit;
- **the other party's reservation bound**: raw cents (`158900`) and the dollar
  renderings (`1589`, `1,589`, `1,589.00`), digit-boundary-guarded so `1,589`
  does not false-hit inside `$11,589` — *unless* the amount is publicly known;
- **the other party's private notes**: every word token of ≥ 4 characters and
  every digit run of ≥ 3 digits that is not in the allowed vocabulary
  (template words plus words of public case text).

The disclosure rule is one small function:

```ts
/** Amounts both parties legitimately know: dispute total, every offer, the settlement. */
function publiclyKnownCents(rec: CaseRecord): Set<number> {
  const cents = new Set<number>([rec.dispute.amountCents]);
  for (const round of rec.rounds) {
    const amount = round.offer?.amountCents;
    if (typeof amount === "number") cents.add(amount);
  }
  if (rec.settlement !== undefined) cents.add(rec.settlement.amountCents);
  return cents;
}
```

Any violation throws `TaintViolationError`, naming the callee and every
violation found. The orchestrator (`src/runner.ts`) renders *before* dialing,
with the ordering stated as a comment where it matters:
`// Render first: a taint violation must abort BEFORE a human's phone rings.`

### Why either layer alone is insufficient

- **Types alone** prove the *view* is clean, not the *string*. A future
  template edit can sidestep the view (`task += rec.parties[0].private.notes`
  typechecks fine — `rec` is right there). And types cannot see coincidence:
  when the negotiation engine suggests a midpoint that happens to equal the
  other party's private reservation, the number is derived from public data
  but is textually indistinguishable from a leak. Caucus fails closed on
  exactly this case — the render throws even though no private field flowed —
  pinned by `test/renderer.test.ts` → *"FAILS CLOSED when a straddling
  suggestion collides with the other party's private bound"*.
- **The scan alone** is lexical and heuristic: it matches tokens, not meaning.
  It cannot catch a paraphrase, and its thresholds (≥ 4-char words, ≥ 3-digit
  runs) are tuned against false positives, not completeness. It is the
  tripwire for template regressions and coincidences; the type layer is what
  makes the *data path* incapable of carrying the secret in the first place.

The two layers fail in different ways, which is the point of having both.

### The verification suite (worth copying even if you copy nothing else)

- **Poison tests** — plant each secret directly into a task string and assert
  the scanner names it: `test/renderer.test.ts` → *"assertNoTaint (poison
  tests)"*, including phone formats, cents/dollar/grouped renderings, and
  digit-boundary lookalikes that must *not* fire.
- **Leak-probe self-check** — the test fixture's secrets are planted into
  synthetic tasks first, proving the probes are detectable at all before any
  test relies on their absence (*"leak probe self-check"*).
- **Cross-party isolation sweep** — every call type × every callee × case
  variants, asserting no private token of the other party appears
  (*"cross-party isolation"*), including notes crafted to look like public text.
- **Property test** — with fast-check, random private notes and reservations
  either leave the rendered task *byte-identical* or the renderer throws:
  *"no random note or reservation changes the rendered task — or it fails
  closed"*. Private fields are inert: they influence no rendered byte.

## Applying it to your own CALL-E workflow

1. Define a `XxxSafeView` interface per call recipient role. Put in it only
   what that recipient may hear. Write one projection function from your full
   record to the view; make it the *only* argument your prompt builders accept.
2. Add the `DeepKeys` proof (copy it verbatim; it is ten lines) with
   `ForbiddenViewKeys` derived from your private-data type via `keyof`.
   Then verify it is load-bearing: temporarily nest a forbidden key deep in
   the view and confirm the build breaks.
3. Keep all fixed prose in one table so your scanner can distinguish template
   words from injected words.
4. Write an `assertNoTaint` for your own secret classes. Phone numbers:
   compare digits-only against digits-only. Amounts: enumerate the textual
   renderings your formatter can produce, and guard digit boundaries. Free
   text: token-level scan against an allow-list of template + public words.
5. Decide your disclosure rule explicitly: which values stop being secret
   because their owner spoke them in this process? Encode that as data
   (a set of exempt values), not as scattered special cases.
6. Render before you dial, and make a scan failure throw. A blocked call is a
   bug report; a completed call is a disclosure.

## What this does not guarantee

- **Cross-party only, by design.** A party's own private data appearing in
  their own call is not a violation (`test/renderer.test.ts` → *"is
  direction-sensitive"*). If your threat model includes the recipient
  themselves, add a second scan direction.
- **Lexical, not semantic.** The scan catches tokens, digit runs, and amount
  renderings. It will not catch a paraphrase of a secret ("they seem willing
  to go much lower") — no string scan can. In Caucus the type layer makes such
  a paraphrase impossible to *derive from the data path*, because the private
  text never reaches the templating code at all; but if an upstream component
  (e.g. an LLM summarizer) ever rewrote secrets into new words and placed them
  in a public field, the scan would not notice.
- **It protects the rendered task, not the live conversation.** The task
  string is an instruction to the calling platform's voice agent. What the
  agent improvises on the call is governed by that platform, not by this
  renderer. The prompt contains no secret to leak — that is the real defense —
  but this pattern makes no claim about the agent's other failure modes.
- **Short-token blind spot.** Note tokens under 4 characters and digit runs
  under 3 digits are not scanned (false-positive control). A 3-character
  secret word would pass the scan; it would still have no path into the
  string through the view.
- **The durable store sees everything.** The ledger genesis payload used by
  `rehydrate()` necessarily carries both parties' private data — the ledger is
  a trusted store, not a shareable artifact. See the
  [threat model](../threat-model.md).
