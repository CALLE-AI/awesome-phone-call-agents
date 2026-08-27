# Source Family Extension Guide

Use this guide when adding a built-in source family to
`outbound-call-skill-creator`.

The current built-in source families are:

- `google-form`
- `tiktok-ads`
- `notion`
- `airtable`
- `local-csv`
- `other`

`other` remains the fallback for custom sources that do not yet have a built-in
contract.

## Add A Source Family Checklist

1. Update `SKILL.md` under `Built-In Choices` with the new source family slug
   and one discovery-oriented description.
2. Add a source-family section to `references/data-sources.md`. That section is
   the source of truth for onboarding, schema, runtime gate, and result-output
   rules.
3. Update `references/interaction-flow.md`:
   - Add the source family to the data source examples.
   - Add a source-only recommendation for the likely workflow.
   - Add writeback prompt guidance when the source has source-specific output
     behavior.
4. Add a complete scenario to `references/examples.md` that shows the captured
   contract and a future runtime request.
5. Update `README.md` wherever the built-in choices or supported source
   families are listed, and add the source-family display terms to
   `OUTBOUND_SOURCE_FAMILY_README_TERMS` in `scripts/validate_repository.py`.
6. Update `scripts/check-generated-skill.mjs` only when the new family needs a
   new structural validation rule. Do not add a source-family allowlist unless
   generated skills must fail validation for unknown families.
7. Run repository validation from the repository root:

   ```bash
   python3 scripts/validate_repository.py
   ```

## Source Family Section Template

Use this shape in `references/data-sources.md`:

````markdown
## Source Family Name

Use `<source-family-slug>` when records come from <system or source class>.

Default access route:

```text
source family: `<source-family-slug>`
access method: <OAuth, MCP, local file, API adapter, managed connector, or other>
source route: <route, helper, or "runtime parameter" when applicable>
```

Capture:

- source locator or approved runtime locator parameter
- access method and route used for onboarding
- authentication, connector, file access, or workspace permission check result
- sampled source instance or representative runtime instance
- sample fetch result and redacted sample summary
- date-window fields and timezone semantics
- record identifier or row reference
- E.164 phone-number field
- recipient label field
- dedupe key
- goal input fields
- source-level outreach basis or consent evidence
- result-output options and field mapping

Generated `<source-family-slug>` skills must <family-specific safety rule>.

Do not ask for `<source-family-slug>` field mapping before access has been
verified and a representative sample has been fetched.

For `fully-bound`, capture the concrete source instance and concrete durable
result target. For `parameterized-bound`, capture the required schema and allow
only approved runtime source and output parameters after the runtime gate
confirms the schema and source contract.
````

## Required Invariants

Every built-in source family must preserve these requirements:

- Source onboarding attempts access verification and representative sample fetch
  before asking for full field mapping.
- A real-call generated skill must have an E.164 phone-number field.
- A real-call generated skill must have a source-level outreach basis or consent
  rule.
- A real-call generated skill must have a stable dedupe key or deterministic
  dedupe state rule.
- A real-call generated skill must have durable result output through verified
  source writeback, a source-adjacent result artifact, or a local result CSV.
- Session-table output is only a last-resort non-persistent fallback when
  durable output validation is blocked.
- Creation-time onboarding and preflight must not mutate source records, create
  result artifacts, write result files, or place real calls.
- Runtime gating must verify source access, required fields, outreach basis or
  consent, dedupe, durable output, and provider readiness before real calls.

## When To Update The Checker

Keep source-family behavior in Markdown unless validation needs deterministic
enforcement.

Update `scripts/check-generated-skill.mjs` when a new source family introduces a
structural requirement that generated skills must always declare, such as a new
mandatory onboarding section marker or a new forbidden provider evidence
pattern.

Do not update the checker merely to mirror the built-in family list. The creator
supports `other` for custom sources, so a strict allowlist would make the skill
less extensible unless the repository intentionally changes that policy.
