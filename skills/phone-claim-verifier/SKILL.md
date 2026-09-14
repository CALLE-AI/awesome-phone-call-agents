---
name: phone-claim-verifier
description: Verify claims about offline records over the phone with CALL-E - "call these providers and check they still accept this plan", "confirm these supplier contacts are current", "phone-verify this directory" - returning MATCH / MISMATCH / UNCLEAR / NO_CONTACT for every claim with a mandatory verbatim quote as evidence, plus a corrections file. Never guesses a verdict it cannot quote.
license: MIT
---

# Phone Claim Verifier

Use this skill when the user has a table of records - each with a phone number and one or
more claims attached - and wants those claims checked by calling the number and asking.

Examples: "call each clinic in this CSV and confirm they still take the Northline Health
plan", "phone these suppliers and check the contact name on file is still right", "verify
this community-services directory is still accurate".

The skill is a thin wrapper around CALL-E's one-off call workflow. It does not add backend
APIs, provider-side batches, a daemon, or new MCP tools. Two small standard-library scripts
do the deterministic work; you (the agent) place the calls and read the transcripts.

## The one rule

A `MATCH` or `MISMATCH` verdict is only produced when a **verbatim quote from a recipient
turn** supports it. If you cannot copy such a quote out of the transcript, the verdict is
`UNCLEAR` - stated plainly, not as an error. This is enforced in `scripts/verdict.py`, in
code. Read `references/evidence-rules.md` before resolving any call.

## When To Use

- checking phone-reachable records against claims: does this office accept this plan, is
  this still the contact, are these hours current, is this address right
- batch verification where each record has its own phone number and its own asserted facts
- producing an evidence-backed corrections file a team can act on

## When Not To Use

- placing calls to numbers that are not on a record in the user's own table
- inferring a phone number, region, timezone, or language - ask the user, do not guess
- calling third-party numbers the user has not confirmed they are authorised to contact
- adding a CALL-E backend verification API or a provider-side recurring job
- resolving a verdict from the recipient's tone or your own inference rather than a quote
- installing `calle` globally without the user's explicit approval

## Setup

1. Confirm the user wants real outbound calls placed to the numbers in their table.
2. Get the records. A CSV with `record_id,name,phone,address,region` plus one column per
   claim (values `true`/`false`), or a JSON object per record. See `examples/providers.csv`.
3. Get or write a claim pack (a JSON file listing the questions to ask and how to read each
   answer). See `references/claim-packs.md` and `examples/healthcare.json`.
4. Check CALL-E auth. Resolve a CALL-E command or the MCP route the same way other skills in
   this repository do; the MCP route is `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`.

CALL-E CLI parameters and command flags are documented in [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md).

## Core Workflow

1. Build the plans:

   ```bash
   python3 scripts/plan.py records.csv --pack path/to/pack.json
   ```

   This prints, per record, a JSON object with `dial` (the only number that may be called
   for that record), `goal` (the natural-language instruction for the call, including the
   automated-call disclosure and the questions), `result_schema`, and an `idempotency_key`.
   It never places a call.

2. For each plan, run the CALL-E one-off call workflow:

   ```text
   auth status  ->  call plan  ->  (show the plan to the user)  ->  call run  ->  call status
   ```

   - Plan exactly one call, to `plan.dial`. Do not substitute any other number.
   - Inspect the returned plan. Run it only if it targets `plan.dial` and carries the
     `goal` text.
   - Preserve any returned `plan_id` and `confirm_token` exactly.
   - Poll call status until the call reaches a terminal state and a transcript is available.

3. Read the transcript. For each claim in the pack, decide:
   - `answer`: `yes`, `no`, or `unknown`
   - `evidence_span`: a substring copied **verbatim** from a single recipient turn that
     proves the answer, or `null` if no such substring exists
   - `conflicting`: `true` only if the recipient stated both a yes and a no
   Follow `references/evidence-rules.md`. Do not paraphrase the quote.

4. Resolve each claim:

   ```bash
   python3 scripts/verdict.py \
     --record '<record JSON>' --pack path/to/pack.json --claim <claim_id> \
     --transcript <call output or [{speaker,text}] JSON> \
     --extraction '{"answer":"...","evidence_span":"...","source_role":"...","conflicting":false}'
   ```

   It prints the attestation (verdict, quote, provenance, expiry) and appends a row to
   `corrections.csv` only for an evidence-backed `MISMATCH`. An `UNCLEAR` never becomes a
   correction. Verdict meanings: `references/verdict-taxonomy.md`.

5. Report per record: the verdict for each claim, the quote behind any `MATCH`/`MISMATCH`,
   and the path to `corrections.csv`. Do not present an `UNCLEAR` as a failure - it is the
   skill declining to guess.

For a full runnable walkthrough with sample output, see `references/examples.md`.

## Runtime Notes

- One call per number per run. Do not re-dial a number that already reached a terminal
  state in this run.
- CALL-E has no call-cancellation route: once a call is running it cannot be stopped, only
  left un-polled. Tell the user this before a large batch.
- The recipient may volunteer personal information. Do not ask for it, and do not store more
  of the transcript than the verdict needs. See `references/safety.md`.
- Every call opens with a disclosed automated-call identity and a stated purpose - this is
  built into the `goal` text `plan.py` produces; do not remove it.

## Files

- `scripts/plan.py` - records + pack -> call plans (no calls placed)
- `scripts/verdict.py` - transcript + your extraction -> attestation + corrections row
- `scripts/_pcv.py` - shared logic (standard library only): the verbatim check and the
  four-verdict evaluator
- `references/evidence-rules.md` - how to extract a quote, with worked examples
- `references/verdict-taxonomy.md` - MATCH / MISMATCH / UNCLEAR / NO_CONTACT and the tags
- `references/claim-packs.md` - the claim-pack format and how to extend it
- `references/safety.md` - dial allowlist, disclosure, data handling, the no-cancel limit
- `references/examples.md` - a full runnable walkthrough
- `examples/providers.csv`, `examples/healthcare.json` - a runnable example
