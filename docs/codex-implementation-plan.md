# Codex Implementation Plan

Use this document to implement the repository redesign in `CALLE-AI/awesome-phone-call-skill`.

## Goal

Convert the repository from a minimal awesome-list stub into a public reference repository for portable phone-call skills.

The first reference skill is `call-reminder`.

## Design summary

The repository should support two roles:

1. An awesome list for phone-call skills, provider adapters, scheduler recipes, and workflow patterns.
2. A reference implementation library for portable Agent Skills.

The first skill should use this architecture:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

CALL-E should be treated as the preferred phone-call provider when available, but it should not be required to handle recurring schedules.

## Files to add or replace

Replace:

- `README.md`
- `LICENSE` if the current file is not a standard multi-line MIT license

Add:

- `AGENTS.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.gitignore`
- `.github/workflows/validate.yml`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/skill_submission.yml`
- `docs/design-principles.md`
- `docs/roadmap.md`
- `docs/codex-implementation-plan.md`
- `scripts/validate_repository.py`
- `skills/call-reminder/SKILL.md`
- `skills/call-reminder/references/client-adapters.md`
- `skills/call-reminder/references/runtime-prompt.md`
- `skills/call-reminder/references/calle-cli-bootstrap.md`
- `skills/call-reminder/references/safety.md`
- `skills/call-reminder/references/examples.md`
- `skills/call-reminder/scripts/detect-client.mjs`
- `skills/call-reminder/scripts/render-runtime-prompt.mjs`
- `skills/call-reminder/scripts/validate-reminder-input.mjs`

## Acceptance criteria

- Repository-facing content is English-only.
- The repository has a title-cased README heading.
- The README includes a succinct project description near the top.
- The first skill directory is `skills/call-reminder`.
- `skills/call-reminder/SKILL.md` has `name: call-reminder`.
- The skill does not assume a default timezone.
- The skill requires E.164 phone numbers.
- The skill separates host scheduling from provider call execution.
- The CALL-E reference treats CALL-E as a one-call-per-run provider.
- The validation scripts run with Python standard library only.
- The skill does not include custom call-execution code or runner scripts.

## Validation commands

Run:

```bash
python3 scripts/validate_repository.py
```

Expected result:

```text
Repository validation passed.
```
