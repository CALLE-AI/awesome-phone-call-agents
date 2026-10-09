# QuoteDesk

RFQ-to-quote for trading businesses. A customer email containing a product
link becomes parallel disclosed CALL-E calls to the company's distributors;
each returned quote is verified to be for the *same configuration* the
customer asked for, and a margin-loaded customer quote is drafted for a human
to send.

The core is **configuration identity resolution**: "Predator Helios 16 AI" is
a family, not a SKU. A distributor quoting the RTX 5070 variant when the
customer asked for the 5080 is a wrong answer wearing a cheaper price tag.
QuoteDesk grades every quote `verified_match`, `wrong_configuration`, or
`unverified` — and a human scanning four quotes for the lowest number would
have sent the wrong one.

This is not supplier sourcing. It starts earlier (inbound RFQ intake from an
unstructured email plus an arbitrary product URL) and ends later (margin,
drafted customer quote, per-distributor scorecard) than call-and-rank tools.

## Why the phone, not the distributor API

Portal price is never the real price: special bid, deal registration,
allocation on constrained SKUs, volume asks, and honest backorder ETAs are all
phone conversations. And the sub-distributor tier that Indian, MENA, SEA and
LATAM trading houses actually buy from has no portal at all.

The *customer-facing* reply goes out as **email, not a call** — a call is
used only where a call is the right channel (the distributor side).

## How it works

```text
customer email + product URL
        │  intake: deterministic parsing + catalog stub (no LLM, no fetch)
        ▼
RequestedSpec ──► one CALL-E call task, all distributors as recipients
        │         (recipient_result_schema forces per-field transcript
        │          evidence spans + confidence levels)
        ▼
reconcile (fail-closed) ──► identity verdict per distributor
        │                    verified_match / wrong_configuration / unverified
        ▼
margin + draft customer quote (human sends) + hash-chained ledger + scorecard
```

Every extracted field carries the transcript span that supports it and a
confidence level (`confirmed` = read back by the callee, `heard_once`,
`unstated`). Two fail-closed rules decide everything:

1. **Unstated is never a match.** If the distributor never said the GPU, the
   verdict is `unverified`, not `verified_match`.
2. **The misheard-number guard.** "Forty-two five" and "forty-two fifty" are
   one vowel apart and one of them is a hole in your margin. Price and ETA
   must be `confirmed` (read back on the call) or the row cannot enter the
   customer quote.

## Setup

```bash
pnpm install
pnpm build
pnpm test        # comparison matrix + pipeline; zero credentials, zero calls
```

Node 20+. Dependencies: `@call-e/calle`, `zod` (dev: TypeScript, Vitest).

## Usage

```bash
node dist/index.js intake --email fixtures/rfq-sample.txt   # parse the RFQ
node dist/index.js preview --rfq RFQ-2026-0914              # call plan, no call
node dist/index.js run --rfq RFQ-2026-0914                  # DRY-RUN on fixtures (default)
node dist/index.js quote --rfq RFQ-2026-0914                # draft customer quote
node dist/index.js scorecard                                # distributor reliability
node dist/index.js dashboard --rfq RFQ-2026-0914            # static HTML report
node dist/index.js verify-ledger                            # check the hash chain
```

Or run the whole fixture demo: `pnpm demo`.

## Dry-run and preview behavior

**`--dry-run` is the default.** `run` without flags reconciles a canned call
result from `fixtures/responses/call-result.json` — including the wrong-GPU
distributor — and never touches the network. `preview` prints the exact task
text, recipients (masked), schemas, and idempotency key without creating
anything. A live call happens only with the explicit `--live` flag.

## Credential handling

- `CALLE_API_KEY` — required for `--live` only. Read from the environment,
  never stored, never logged.
- `QUOTEDESK_PHONE_D1..D4` — E.164 numbers for the (fictional) distributors.
  Real phone numbers are never stored in fixtures, code, or the ledger; live
  mode reads them from these variables and refuses to start if any is
  missing, malformed (including a zero-leading country code such as `+0…`),
  or a duplicate of another distributor's number — fail-closed *before* any
  call is created, never mid-wave.
- Distributor numbers are shown masked. Free text from calls and the
  provider (transcript spans, part numbers, quote notes, error messages) is
  redacted for display — console output, the dashboard and the customer
  draft mask phone-number-like digit runs and email addresses
  (`src/redact.ts`). The raw evidence in `data/ledger.jsonl` and
  `data/rows-*.json` is kept unmodified and is private: do not share `data/`.
  Redaction is pattern-based and can miss unusual formats; review a display
  copy before forwarding it.

## Real-world side effects

`run --live --attest-recipient-authorization` creates **one** CALL-E call
task with all four distributors as recipients (the idiomatic multi-recipient use: one `recipient_result_schema`
per-distributor extraction plus one cross-call `result_schema` rollup).
Each recipient receives a real phone call. The first line of every call
script discloses that the caller is an AI assistant calling on behalf of the
company.

**Recipient authorization is the operator's responsibility.** Live mode
refuses to start without `--attest-recipient-authorization`, by which the
operator confirms every configured number is a business line that has agreed
to receive automated AI calls from them. QuoteDesk does not verify that
attestation, does not check DNC registries, and does not determine whether a
call is lawful in the recipient's jurisdiction. The intended use is B2B calls
to distributors under existing trading relationships; that intent reduces but
does not eliminate consent, recording-disclosure, or telemarketing-rule
obligations, which the operator must check for their market.

The generated customer quote is a **text draft only**. QuoteDesk sends no
email and exposes no send path. It does **not** enforce or record a human
approval step: margin review, checking the quoted figures against the call,
and the decision to send are left to the operator, and nothing stops a
draft being sent unreviewed.

## Cancellation

**CALL-E exposes no client cancellation.** Once a call task is created it
runs to completion. QuoteDesk therefore dispatches exactly one controlled
wave per RFQ and never over-dispatches, because an unwanted call cannot be
recalled. The idempotency key is derived from `(rfqId + distributor set)` —
not from the attempt — so an immediate retry of the same command reuses the
same key and should be deduplicated by CALL-E. That protection is **bounded**:
it lasts only as long as CALL-E retains the key, and a different `--rfq` id
or a changed distributor list produces a new key and new calls. Check the
ledger for an existing `call_created` entry before re-running `run --live`.
To stop future runs, simply do not run `run --live` again; there are no
recurring jobs or schedulers in this app.

## Reconciliation and ambiguous outcomes

- The returned call id is appended to the ledger **immediately** on response.
  There is no list-calls endpoint; a lost id is unrecoverable.
- **Unknown outcome.** If the create request errors or times out, the call
  may or may not have been placed, and QuoteDesk has no id to reconcile. Do
  not re-run with a different RFQ id to "try again"; re-running the identical
  command within CALL-E's idempotency window is the only safe retry, and
  otherwise treat the distributors as possibly called.
- A recipient with `structuredResult: null` (voicemail, garbled, nothing
  extractable) is reconciled as an empty quote and graded `unverified` — a
  state to resolve by a human follow-up, **not** an error to retry blindly.
- `failure_code` has no published enum: it is stored raw in the ledger and
  never branched on.
- `completion_confidence` measures confidence in *task completion*, not in
  answer quality — it is recorded but plays no part in the identity verdict.
- **Evidence limits.** Field values, evidence spans and `confirmed` /
  `heard_once` / `unstated` labels are produced by CALL-E's extraction, not
  re-checked by QuoteDesk against the transcript. A verdict is only as good
  as that extraction: a misheard or mislabelled field can still produce a
  wrong `verified_match`. Treat verdicts as a screen that removes known-bad
  quotes, not as proof, and spot-check the transcript before sending.

## Live verification

The live path has been verified end to end on a real CALL-E call to an India
(+91) number: one recipient, a 46-turn transcript, per-field extraction with
evidence spans, `completion_confidence` 0.88. The call graded exactly as
designed — GPU, RAM, storage and price came back `confirmed` with read-back
spans; a delivery estimate said once and never read back graded `heard_once`
and was blocked by the misheard-number guard; and a product family the callee
never named graded `unstated`, leaving the quote ineligible. Fail-closed, on
a real phone line.

## Where results are stored

Everything lands under `data/` (gitignored):

- `data/ledger.jsonl` — append-only, hash-chained event ledger (RFQ parsed,
  call created, terminal result, per-distributor verdict, quote drafted).
  `verify-ledger` re-derives the chain and fails on any modified line.
- `data/rfq-*.json`, `data/rows-*.json`, `data/draft-*.txt` — pipeline
  artifacts per RFQ.
- `data/dashboard-*.html` — a single static HTML file, no framework, no
  external assets.

## Market configuration

`config/market.json` defaults to an India-based trading house (INR, IGST,
freight, forex buffer, margin). Currency conversion APIs are deliberately not
integrated — the rate is a hardcoded config value. Switch the numbers for a
US market; the landed-cost formula reads entirely from this file.

## Not built (deliberately)

- Real inventory/catalog integration — `fixtures/products.json` stands in.
- Auth, multi-tenancy, user accounts.
- A dashboard framework — one static HTML file rendered from JSON.
- Live email sending or IMAP polling — paste the email text in.
- Negotiation on the call — ask, extract, hang up.
- Currency conversion APIs — hardcoded rate in config.

## Tests

`pnpm test` runs without CALL-E credentials and places no calls:

- `test/identity.test.ts` — the comparison matrix: every verdict transition,
  normalization ("NVIDIA GeForce RTX 5080 Laptop GPU" ≡ "RTX 5080", but
  ≢ "RTX 5070"), the unstated-is-never-a-match rule, and the
  misheard-number guard.
- `test/pipeline.test.ts` — email → spec → fixture call result → verdicts →
  draft, end to end, plus dispatch idempotency and fail-closed phone
  resolution against a stub client.
