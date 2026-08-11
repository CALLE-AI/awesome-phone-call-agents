# Defect triage and issue quality rubric

Use this reference during classification and again when drafting a confirmed defect.

## Contents

- Consolidate candidates
- Confirm a genuine defect
- Judge investigation clues
- Separate nearby categories
- Preserve evidence accurately
- Keep private diagnostics private
- Draft the public issue
- Review privacy and duplicates

## Consolidate candidates

Extract independently testable claims first, but do not assign an issue ID to every claim. Combine claims when they have the same observable failure, expected behavior, and likely resolution boundary. Assign stable `I1`, `I2`, and so on only after consolidation.

Separate candidates when maintainers could investigate, deduplicate, and close them independently. Common boundaries include:

- runtime behavior versus missing documentation;
- one integration surface versus another, such as CLI, MCP, SDK, Codex, Cursor, Claude Code, or OpenClaw;
- authentication failure versus call execution failure;
- error-message quality versus the underlying failure;
- current defect versus requested capability.

Private support requests, documentation gaps, and feature suggestions that merely contextualize a defect remain unnumbered notes in the default bug workflow. Give them their own ID only when the user separately asks to track that non-bug work. Multiple reports of the same failure are evidence for one issue, not separate issues.

## Confirm a genuine defect

Classify a candidate as `Confirmed defect` only when all of these are adequately supported:

1. **Observed behavior**: the feedback says what happened, including an error, incorrect result, failed workflow, or clear behavior difference.
2. **Expected-behavior basis**: the expectation comes from a public contract, repository documentation, supported workflow, previous working behavior, or an unambiguous invariant. Preference alone is insufficient.
3. **Mismatch**: the actual behavior contradicts that expectation.
4. **Repository scope**: the problem belongs in the selected repository. Describe only the public product surface.
5. **Supportable evidence**: public evidence can describe the mismatch responsibly without invented facts.

Use `Suspected defect` when one of those elements is missing. Ask only questions that could provide a missing element or alter publication safety.

## Judge investigation clues

Judge clue sufficiency separately from defect classification. Inventory every safe, relevant clue and include it in the issue body.

Useful clues include:

- exact call, task, run, plan, trace, request, resource, bot, version, or equivalent identifiers supplied in the original feedback;
- exact public error codes, statuses, messages, commands, flags, and sanitized request fields;
- confirmed integration surface, package version, host or OS, and public environment;
- user-confirmed reproduction steps or a minimal failing request;
- user-observed timestamps and event ordering;
- public documentation links that establish expected behavior.

A generic symptom such as `it failed`, an impact statement, reporter speculation, or an expected-behavior sentence is not by itself an investigation clue. Private account data, secrets, server-side diagnostics, and identifiers discovered only through internal systems never count as publishable clues.

Mark `clues sufficient` only when the included clues give maintainers a concrete starting point to locate or reproduce the failure. Otherwise mark `clues insufficient`, name what is missing, and stop unless the user explicitly acknowledges the insufficiency for the same IDs and actor.

## Separate nearby categories

- `Feature request`: new behavior, convenience, validation, automation, or integration that is not promised today.
- `Documentation problem`: behavior may be correct, but setup, contract, limits, examples, or troubleshooting guidance is absent or misleading.
- `Usage or support problem`: unsupported region or language, invalid configuration, expected authentication requirement, private account state, or misunderstanding unless the product contract promises otherwise.
- `No follow-up`: no independently actionable problem, out of scope, praise only, or already captured with no new evidence.

A single comment may contain a confirmed defect plus a feature request and a documentation gap. Keep boundaries explicit so only approved defects enter the default creation workflow.

## Preserve evidence accurately

During private discussion, distinguish:

- **Observed**: explicitly stated by sanitized feedback.
- **Inferred**: a labeled interpretation used to guide the next decision.
- **Unknown**: not provided.

Quote relevant original evidence with stable evidence IDs. Preserve source language, spelling, punctuation, error text, status values, timestamps, command flags, versions, public API names, and reporter-supplied correlation identifiers. Redact only sensitive spans. Do not translate or silently correct inside a quote.

Do not invent versions, environments, steps, frequency, severity, affected-user counts, technical causes, or product commitments.

## Keep private diagnostics private

Internal diagnostics may raise private confidence, but they never become publication evidence. Do not publish server logs, database records, telemetry, traces, counters, inferred backend states, voice or model signals, latency, internal services, infrastructure, configuration values, or identifiers found only through internal systems.

Public issue content may include:

- the public product or integration surface;
- the action the reporter took;
- the visible or audible result;
- the expected user-visible outcome and its public basis;
- non-sensitive environment facts supplied by the reporter;
- exact non-sensitive technical identifiers supplied by the reporter.

If the observable report is not actionable enough, keep it in private support and request more user-visible detail.

## Draft the public issue

Write the title and body in English. Use a concise title describing the observable failure without a generic `[Bug]` prefix.

Use only useful sections from this schema:

```markdown
## Summary

One factual paragraph describing the failure and affected integration surface.

## Actual behavior

State only what the reporter observed, including a sanitized exact visible error when available.

## Expected behavior

State the supported or documented expectation and its basis.

## Steps to reproduce

1. Include only steps supplied or confirmed during discussion.

## Environment

- Integration surface: CLI | MCP | SDK | Codex | Cursor | Claude Code | OpenClaw | Other
- Package/version: confirmed value or `Not provided`
- Host/OS: confirmed value or `Not provided`

## Impact

Describe only the user-visible consequence supported by feedback.

## Sanitized source feedback

> One or two short, anonymized excerpts translated to English when necessary.

Source: Discord community feedback manually provided to the maintainer; reporter anonymized.

## Investigation clues

List exact safe clues used to locate or reproduce the failure.
```

Do not add speculative acceptance criteria or prescribe an implementation unless the feedback contains a confirmed technical requirement. The helper appends a hidden fingerprint; never add or edit it manually.

## Review privacy and duplicates

Before previewing or creating, confirm that title, body, labels, and evidence contain no personal identity, contact data, secret, private link, raw log, recording, private transcript, internal diagnostic, infrastructure detail, internal identifier, or unsupported accusation.

Preserve every relevant technical identifier present in the original feedback because maintainers may need it to investigate. Redact phone numbers even when used as identifiers. Never treat tokens, credentials, or directly identifying account data as technical evidence.

Search open and closed issues before confirmation. Inspect titles, bodies, and comments. Compare observable failure, expected behavior, and resolution boundary rather than title wording alone. Search exact statuses, errors, commands, activity text, and user-visible outcomes. An empty automated result is a signal, not proof that no duplicate exists.

The bundled helper can match exact fingerprints, similar titles, declared investigation clues, and exact technical evidence in ordinary prose or code spans. It does not perform semantic inference. Use the agent or an authenticated connector to search behavior descriptions and paraphrases before marking `semantic_duplicate_review_complete` as true.

Treat an exact fingerprint or normalized-title match as a duplicate. Treat a strong behavior or evidence match anywhere in the issue thread as a possible duplicate requiring user review. Never silently create a second issue or add a comment.

When the user chooses a separate issue, record every reviewed matching issue number. Re-check immediately before creation and stop if the current match set differs. Bind final creation to the approval fingerprint from the exact reviewed payload so later edits require a new confirmation.
