# calle-invoice-recovery — Operator Guide

> Long-form guidance for the `calle-invoice-recovery` skill. (The repo validator
> forbids `README.md` in a skill directory, so this operator guide lives in
> `docs/`. `SKILL.md` is the canonical skill definition.)

A reusable CALL-E skill for outbound invoice-recovery calls. The skill phones a
named client about a specific unpaid invoice, holds a structured multi-turn
conversation to understand their situation, offers a payment arrangement when
appropriate, and records a typed outcome — all behind a human approval gate.

Designed for freelancers and small agencies that chase overdue payments from
overseas clients in CALL-E-supported regions.

---

## Who this is for

- Freelancers and small agencies with outstanding invoices owed by overseas clients.
- Operators who need a repeatable, professional call script without building one from
  scratch.
- Agent-host developers who want a portable invoice-recovery skill they can drop into
  their own scheduling system.

The reference implementation uses Next.js, Supabase, and the CALL-E TypeScript SDK
(`@call-e/calle`), but the skill itself is host-agnostic: the conversation flow and
outcome schema work with any platform that can invoke the CALL-E API.

---

## What this skill does

1. Accepts a structured invoice record (reference, amount, currency, due date, client
   phone number, and region).
2. Generates a call brief and surfaces it for operator review before any credit is spent
   — draft-then-approve, not autonomous.
3. On approval, dispatches the call via CALL-E using the five-phase conversation flow
   defined in `SKILL.md`.
4. Extracts a typed outcome (`paid_now`, `committed_to_date`, `disputed`, `refused`,
   `no_answer`, `voicemail`, `wrong_person`) and stores it alongside the call record.
5. Logs every call with timing, the CALL-E call ID, and the outcome — no silent
   failures.

No call is ever placed without explicit operator approval. No retries or follow-ups are
scheduled automatically — that is the host scheduler's responsibility.

---

## Prerequisites

- A CALL-E account with a valid `CALLE_API_KEY`.
- The client's phone number in E.164 format (`+[country code][number]`) — see
  `references/safety.md` for why malformed numbers are a real risk.
- The client's country must be in the CALL-E supported region list (US, SG, MY, IN, AE,
  AU, CA, GB, VN, DE, JP, FR, MX, BR, ID, PH, KE, and BD/Bangladesh — English only).
  Calls to a region CALL-E does not support cannot be placed; use a different channel.
- Node.js 20+ (24 LTS recommended), or the runtime your host uses.
- If using the reference implementation: a Supabase project with the schema from
  `supabase/migrations/` applied.

---

## Quick start

### 1. Copy the skill folder

Copy `skills/calle-invoice-recovery/` into your own repository or agent-host project.
If you are building on top of the full reference implementation, clone the entire repo
and follow the setup in the project root.

### 2. Verify the skill folder structure

```bash
pnpm verify-skill
```

This runs the same rules the target repository's validator enforces on a skill folder:
required files, SKILL.md frontmatter (`name`/`description`, `name` == folder, lowercase
slug, description length and phone/call mention), `references/safety.md` +
`references/examples.md`, no `README.md`, no CJK characters, no old repository-name
strings, and that every local path SKILL.md references actually exists.

### 3. Set environment variables

Copy `.env.example` to `.env.local` and set:

| Variable | Value |
|----------|-------|
| `CALLE_API_KEY` | Your CALL-E API key (from your CALL-E dashboard). |
| `CALLE_MODE` | `mock` during development; `live` only when placing real calls. |
| `SUPABASE_URL` | Your Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service-role key (API tab, project settings). Server-side only — never expose to browser clients. |

Set `CALLE_MODE=mock` (or `CALLE_MODE=dry-run`) during development and testing. Set
`CALLE_MODE=live` only when you are ready to spend a real call credit. Never commit
`.env.local` or any file containing your API key.

### 4. Run the dry-run preview

Before placing any real call, verify the full execution path:

```bash
pnpm dry-run
# or directly:
npx tsx skills/calle-invoice-recovery/scripts/dry-run.ts
```

Pass `--invoice-ref` to preview a specific sample invoice:

```bash
npx tsx skills/calle-invoice-recovery/scripts/dry-run.ts --invoice-ref INV-2026-038
```

The dry-run script prints the full API payload and agent script that would be sent to
CALL-E, but makes no network request and consumes no credit. All output is labelled
`[DRY RUN]`. PII (phone numbers, client names) is masked in all dry-run output.

### 5. Place a real call

When you have confirmed the dry-run output looks correct and the approval gate is wired
up in your host:

1. Set `CALLE_MODE=live`.
2. Invoke the skill with a real invoice record and a real E.164 recipient number.
3. Approve the call brief when it surfaces for review.
4. The skill dispatches the call, logs the result, and stops.

---

## Adapting for your context

See `references/adaptation-guide.md` for the full walkthrough. The key seams:

| What to change | Where |
|----------------|-------|
| Business name and agent name | `operator_name`, `agent_name` skill input parameters |
| Callback contact for clients | `callback_contact` skill input parameter |
| Invoice data source | Write a thin adapter to map your system's fields to the required shape (see the guide) |
| Script tone and phrasing | Phase 2–5 script lines in `SKILL.md` |
| Jurisdiction-required disclosures | Add to Phase 2 script; see `references/safety.md` (Jurisdiction Warning) |

Things you must not change without understanding the implications:

- The Phase 1 identity-confirmation gate (must run before any financial information is disclosed).
- The draft-then-approve requirement (removing the approval gate violates the safety contract).
- The `result_schema` field names (CALL-E validates these exactly; mismatches cause API errors).
- The `wrong_person` outcome path (must remain a first-class outcome, not merged into `no_answer`).

---

## Supported regions and languages

CALL-E places calls only to the regions it supports. Confirm your client's country is
in this list before adding them to your invoice dataset:

US, SG, MY, IN (English/Hindi), AE, AU, CA, GB, VN, DE, JP, FR, MX, BR, ID, PH, KE,
and BD (Bangladesh, English only).

The skill defaults to English for all regions. Pass the `language` parameter explicitly
if the region supports an additional language (e.g. Hindi for IN).

**Bangladesh (+880) is supported — English only. Bengali is NOT supported**, so calls to
Bangladesh recipients are placed in English. CALL-E routes by the *recipient's* country,
not the operator's location.

---

## What this is NOT

- **Not a production debt-collection system.** This is a communication and
  record-keeping tool for chasing invoices in existing commercial relationships. It is
  not a licensed third-party debt collector and does not comply with debt-collection
  licensing regimes (e.g. state-by-state US collection licenses).
- **Not legal or financial advice.** Debt-collection law varies significantly by
  country. The skill maintainers make no legal representations. Before placing any
  call, the operator is solely responsible for confirming that outbound invoice-recovery
  calls are lawful in the client's jurisdiction and that required disclosures have been
  added to the script. When in doubt, consult a lawyer.
- **Not autonomous.** Every call requires explicit human approval before it is
  dispatched. The skill does not schedule retries, follow-ups, or recurring calls
  without operator action.
- **Not a research prototype built for the demo.** The conversation flow, outcome
  classification, and safety guardrails reflect months of real-world experience
  designing debt-resolution call flows for live agency clients. The sample dataset and
  transcripts in `references/` are illustrative and fictional; they are not real call
  logs.
- **Not a small-sample benchmark.** Performance metrics (call completion rate, outcome
  distribution, ASR accuracy) will be measured from real calls and added when available.
  No figures are published here that were not measured from an actual run.

---

## Limitations

- **CALL-E region and language coverage.** The skill can only reach clients in
  CALL-E-supported regions. Clients in unsupported countries cannot be called; use
  email or written notice instead.
- **Call duration cap: 20 minutes.** CALL-E caps a call at 20 minutes (per CALL-E's PM
  in Discord, 2026-07-27). Very long disputes or complex arrangements may be cut off; the
  agent is scripted to close gracefully well within that window.
- **Concurrency limit: 1 by default.** CALL-E allows 1 concurrent call on the default
  number, or up to 10 with your own SIP trunk or a purchased number (per CALL-E's PM in
  Discord, 2026-07-27). Rate limits are not publicly documented — for a large invoice
  batch, space calls across time and check current limits before building a batch scheduler.
- **Credit budget.** Free-tier CALL-E accounts have a limited call allowance. Treat
  every call as expensive during development; use dry-run mode to validate the full
  execution path before spending credits.
- **Single-language calls.** The skill is written for English. It does not include
  script variants for other languages; extending it to non-English scripts requires
  adapting the Phase 2–5 copy and verifying that the target region supports the chosen
  language.
- **No payment processing.** The agent arranges payment dates and records commitments;
  it never handles money, card details, or bank account information.

---

## Metrics — TODO

The following metrics will be populated from real call logs when available. No figures
are published before they are measured.

- TODO: call completion rate (calls answered / calls dispatched)
- TODO: outcome distribution across `paid_now`, `committed_to_date`, `disputed`,
  `refused`, `no_answer`, `voicemail`, `wrong_person`
- TODO: median call duration
- TODO: agent confidence score distribution
- TODO: ASR accuracy on a fixed English test set (stated as measured, with sample size)
- TODO: total calls placed in production use

---

## References

- `SKILL.md` — full conversation flow, outcome schema, prohibited behaviours, safety
  contract summary
- `references/safety.md` — E.164 validation, PII masking, jurisdiction warning,
  credential hygiene
- `references/examples.md` — fictional invoice dataset and four illustrative
  transcripts covering all four primary conversation branches
- `references/adaptation-guide.md` — step-by-step guide to deploying the skill in
  your own context

---

## License

MIT. See the repository root for the full license text.
