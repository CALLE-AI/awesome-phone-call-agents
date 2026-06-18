# Outbound Call Source Onboarding Design

## Goal

Extend `outbound-call-skill-creator` so generated outbound phone-call skills are usable immediately after creation for concrete runtime requests such as "process data for May 25." Creation should no longer stop at documenting a source contract. For bound workflows, the creator must guide the agent through source authentication, one safe sample fetch, schema confirmation, and default goal definition before writing the generated skill.

The result should be a generated business skill that already knows:

- how the source is authenticated or checked
- which source instance or representative instance was sampled
- which fields map to phone, recipient label, dedupe, date window, consent, and goal inputs
- what default outbound goal contract to use
- which runtime parameters remain acceptable, such as a date window or approved source instance

## Scope

This feature updates the procedural creator skill and generated skill contract. It does not add a general outbound runtime platform and does not require every source family to have a new shared adapter script.

The first implementation should update:

- `skills/outbound-call-skill-creator/SKILL.md`
- `skills/outbound-call-skill-creator/references/data-sources.md`
- `skills/outbound-call-skill-creator/references/generated-skill-contract.md`
- `skills/outbound-call-skill-creator/references/creation-summary.md`
- `skills/outbound-call-skill-creator/references/examples.md`
- `docs/outbound-call-skill-creator/README.md`
- `skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs`
- `scripts/validate_repository.py`

The change should prefer existing source-specific assets when they exist. For Google Forms, the creator can point to the existing `google-form-callback` local OAuth and export scripts as the preferred reference pattern.

## Binding-Level Rule

Creation-time source onboarding depends on binding level:

| Binding level | Required creator behavior |
| --- | --- |
| `fully-bound` | Authenticate or verify the concrete source, fetch a representative sample from that exact source, confirm schema and durable result-output readiness, and block real-call skill generation if this cannot complete. |
| `parameterized-bound` | Authenticate or verify the source family, fetch a representative sample from one approved source instance, confirm the schema contract, and allow only runtime instances that pass the same runtime gate. |

`parameterized-bound` is the minimum source binding contract. If onboarding cannot satisfy it, the creator stops before generating the business skill.

## Creator Workflow

Add a new required phase named **Creation-Time Source Onboarding** after source family and binding level selection, and before final goal and result-output contract generation.

The phase should run in this order:

1. Select the source family and binding level.
2. Determine the source access method and credential location, connector, MCP tool, local file path, or fallback route.
3. Run a non-mutating authentication or access check when tools and permissions are available.
4. Fetch a small representative sample from the selected source or representative runtime source instance.
5. Inspect the sample schema and identify candidate fields:
   - E.164 phone number
   - recipient label
   - dedupe key
   - date-window field and timezone semantics
   - consent or outreach basis
   - goal input fields
   - durable result-output target: source writeback, source-adjacent result artifact, or local result CSV, with session table only as last-resort fallback
6. Show the user the discovered fields and a small redacted sample summary.
7. Prompt the user to confirm or adjust field mapping.
8. Prompt the user to define the default outbound goal using the sampled fields.
9. Record onboarding results in the generated skill and creation summary.

The creator must not place calls or perform real writeback during onboarding. Sample output must redact phone numbers and omit credentials, tokens, cookies, callback URLs, provider confirmation tokens, and full private phone numbers.

## Default Goal Definition

After sample fetch, the creator should help the user define the default goal from actual source fields rather than asking in the abstract.

The prompt should show:

- source family and sampled source instance
- available goal input fields
- one to three redacted sample records or field examples
- any detected consent or outreach basis
- suggested goal skeleton

The goal contract must capture:

- call purpose
- context fields to include in each call
- required questions or statements
- prohibited claims
- completion criteria
- allowed result values
- summary format
- escalation or human-handoff cases
- sensitive-domain boundaries

Generated skills must compile goals from the fixed goal contract and approved source fields. They must not let raw source records provide arbitrary provider goals.

## Source-Family Behavior

### Google Form

Prefer the existing local OAuth pattern from `google-form-callback`:

- Run Google auth status or repair flow before export.
- Use local OAuth export, or an explicitly configured Apps Script fallback.
- Fetch form metadata and a small response sample from the concrete or representative form.
- Confirm the form description, terms, or per-response field authorizes phone follow-up.
- Confirm question names or field slugs for phone, recipient, date, dedupe, consent, and goal inputs.
- Confirm linked response spreadsheet availability when source writeback is configured.

For `parameterized-bound`, the generated skill may accept a runtime form ID only when the runtime gate verifies the form matches the sampled schema.

### TikTok Ads

Use only TikTok Ads MCP tools and resources actually exposed by the host. During onboarding:

- verify the connector or MCP server is available
- use `https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp` as the default MCP access route when the host has not already exposed a TikTok Ads connector
- fetch a small sample for the chosen account, campaign, lead scope, or representative runtime scope
- record exact tool or resource names
- identify phone, recipient label, dedupe, date, outreach basis, and goal input fields
- identify whether a writeback tool exists

Do not invent TikTok Ads MCP schemas or assume every returned record is callable.

### Local CSV

For bound CSV workflows:

- read a small sample from the concrete or representative CSV path
- confirm delimiter and header behavior
- map phone, recipient, dedupe, date, consent, and goal input columns
- confirm output CSV path when local writeback is configured

For `parameterized-bound`, runtime CSV files must pass the same header and field contract before real calls.

### Other Sources

For custom sources, ask for exact access and schema details one at a time. If the source cannot be authenticated or sampled safely enough to satisfy the minimum `parameterized-bound` contract, stop before generation.

## Generated Skill Requirements

Every generated bound skill must include a source onboarding section or reference file that records:

- binding level
- source family
- access method
- sampled source instance or representative runtime instance
- authentication or access check result
- sample fetch command, tool, or route when safe to disclose
- sample fetch timestamp or creation-time status
- discovered field mapping
- redaction policy for sample summaries
- default goal contract derived from sampled fields
- runtime parameters still allowed
- runtime gate checks required before real calls

Missing source onboarding is a blocker for skill generation until the source contract is complete enough for at least `parameterized-bound`.

## Runtime Behavior

After this feature, a generated bound skill should accept a concrete runtime request like:

```text
Process data for 2026-05-25.
```

The skill should already know the source family, field mapping, consent rule, dedupe rule, default goal, result-output policy, and provider route. It may ask only for required runtime parameters that were intentionally left parameterized, such as:

- date window
- runtime form ID
- campaign ID
- CSV path
- output path

The runtime gate still reruns source access, required field, consent, dedupe, durable result-output, and provider route checks before real calls.

## Checker Updates

Update `check-generated-skill.mjs` so generated skills must declare source onboarding expectations. The checker should reject:

- generated skills with no source onboarding marker
- bound generated skills with no authentication or access check result
- bound generated skills with no sample fetch result
- bound generated skills with no default goal contract derived from sampled fields
- generated skills that use an unsupported binding level or skip required source onboarding

The checker can remain text-based for now, but the required markers should be precise enough to prevent silent regressions.

## Validation

Repository validation must continue to pass:

```bash
python3 scripts/validate_repository.py
```

The validation smoke tests should include at least one valid generated skill fixture with source onboarding and at least one failing fixture that omits onboarding.

## Risks

The main risk is over-promising automation for source families that do not have stable tools in every host. The design avoids that by making onboarding mandatory before any generated business skill can be written.

Another risk is exposing private sample data. The creator and generated skills must summarize samples with redacted phone numbers and non-sensitive field names, never raw tokens or full private phone numbers.

## Open Decision

The first implementation should not create new generic source adapter scripts. It should update the creator instructions, generated contract, docs, and checker. Source-specific scripts can be added later when a source family needs deterministic parsing or repeated adapter behavior.
