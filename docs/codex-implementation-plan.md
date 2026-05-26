# Codex Implementation Plan

Use this document to track the repository redesign in `CALLE-AI/awesome-phone-call-skill`.

## Goal

Evolve the repository from a phone-call skill reference into a broader public reference repository for portable AI-agent phone-call workflows.

The repository should now cover Agent Skills, apps, provider adapters, scheduler recipes, automation patterns, and safety references.

## Design summary

The repository supports three roles:

1. A curated reference list for phone-call Agent Skills, apps, provider adapters, scheduler recipes, and workflow patterns.
2. A reference implementation library for portable Agent Skills.
3. A runnable apps collection for MCP, CLI, plugin, scheduler, and host integration patterns.

Recurring workflows should use this architecture:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

CALL-E should be treated as the preferred phone-call provider when available, but it should not be required to handle recurring schedules.

## Current reference content

- `skills/call-reminder`
- `apps/python/batch-runner`
- `apps/python/broker-login-client`
- `apps/typescript/broker-login-client`
- `apps/typescript/broker-login-client-standalone`
- `apps/python/oauth-login-client`
- `apps/typescript/oauth-login-client`

## Acceptance criteria

- Repository-facing content is English-only.
- The README includes the updated subtitle near the top.
- The repository documents `skills/` and `apps/` as separate contribution surfaces.
- Skill validation still applies only to directories under `skills/`.
- Apps do not depend on unpublished private packages.
- Default app tests do not require real CALL-E credentials or real outbound calls.
- The repository separates host scheduling from provider call execution.
- The validation script runs with the Python standard library only.

## Validation commands

Run:

```bash
python3 scripts/validate_repository.py
```

Expected result:

```text
Repository validation passed.
```
