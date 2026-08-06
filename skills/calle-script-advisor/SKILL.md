---
name: calle-script-advisor
description: Draft and check CALL-E phone-call task text and result schemas for clarity, safety, and extraction quality before any call is placed.
license: MIT
---

# CALL-E Script Advisor

CALL-E's `task` field is free-form natural language, and its quality determines whether a call succeeds. A vague task produces a vague conversation, low extraction confidence, and an unusable result - and by the time that is visible, the call has already been placed and paid for. This skill turns CALL-E's own API guidance into an executable check that catches that before the call happens.

## When To Use

Use this skill whenever you are drafting or reviewing a CALL-E `task` and `result_schema`, before any call is placed. That includes writing a new call from scratch, adapting an existing task for a new scenario, and reviewing a task or schema someone else wrote.

## The Drafting Procedure

Before writing any text, gather:

1. **The goal** - why this call is happening, in one sentence.
2. **The single decision the call must establish** - the one thing that determines what happens next. If there seem to be several, pick the one that matters most and treat the rest as optional context.
3. **Who is calling and why** - the identification line the agent should open with: who they are, who they are calling on behalf of (if anyone), and the reason for the call.
4. **How to close the call** - the instruction that ends the conversation cleanly once the ask is resolved.
5. **What to do on voicemail** - whether to leave a message, what it should say, and whether to try again.

Then, in order:

1. Write the `task` text: identification, purpose, the single ask, edge-case handling, and the close. See `references/script-patterns.md` for the anatomy and a before/after rewrite.
2. Write the `result_schema` to capture exactly the decision the call must establish - not everything that was discussed, just the answer this call exists to produce.

## The Checking Step

Run `scripts/check-call-script.mjs` against the task and schema, and iterate until there are no errors:

```bash
node scripts/check-call-script.mjs --task-file <path> --schema-file <path>
node scripts/check-call-script.mjs --task "..." --schema '{...}'
```

Both arguments are optional independently - lint a task alone, a schema alone, or both. The script prints findings grouped by severity, a score out of 100, and exits 1 if any error-severity finding exists, so it can gate a workflow.

Errors are not negotiable - fix every one. Warnings are judgement calls: read the suggestion, decide whether it applies to this call, and either fix it or consciously accept it. A warning left in place should be a deliberate choice, not an oversight.

See `references/examples.md` for three complete worked examples that pass the linter with zero errors.

## Rules That Are Not Negotiable

- Never invent a phone number. Use only the number the user provided or that the calling system resolved.
- Never infer region, locale, or timezone from a phone number.
- Never solicit sensitive personal data: Social Security numbers, credit card or bank account numbers, CVVs, PINs, passwords, dates of birth, or a mother's maiden name. See `references/safety.md`.
- Always include an `unknown` (or `unclear` / `not_stated` / `undetermined`) enum member for anything the call may fail to establish. CALL-E's own docs recommend this explicitly, and it is what lets a downstream integration tell "the answer is no" apart from "there was no answer" - the sibling `plugins/zapier-calle` refuses to mark a call actionable when a required field comes back with one of these values, so the enum member is not decoration.
- Ask the schema for its own evidence. Beside any field an automation will act on, add a `<field>_quote` string described as *the recipient's exact words that establish the answer above*. It costs nothing - the extraction model is already reading the transcript - and it is the only thing that separates an answer drawn from the call from one drawn from thin air, since both arrive as equally well-formed JSON with equally high confidence. The sibling `plugins/zapier-calle` verifies that quote against the transcript and sends the call to human review when it appears nowhere the recipient spoke. Ask for a full spoken sentence rather than a word: a one-word quote can match by coincidence.
- Mark a field `required` only when the workflow genuinely cannot proceed without it. `required` is a contract: an integration that checks it will send the whole call to human review when the field is absent or unknown. Requiring a nice-to-have field turns every partially-successful call into manual work.
- Never let the script imply a commitment the caller cannot honour - no promised callback times, approvals, or guarantees the agent is not authorized to make.

Read `references/safety.md` before drafting any task that touches consent, disclosure, calling windows, or a do-not-call request.

## Progressive Disclosure

This file stays focused on the workflow. Detail lives in `references/`:

- `references/script-patterns.md` - the anatomy of a good task, with a before/after rewrite.
- `references/safety.md` - consent, disclosure, sensitive data, calling windows, and do-not-call handling.
- `references/examples.md` - three worked examples (appointment confirmation, on-call acknowledgement, lead qualification), each verified against the linter.
