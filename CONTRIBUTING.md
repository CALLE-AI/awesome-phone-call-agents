# Contributing

Thanks for contributing to Awesome Phone Call Skill.

This repository collects portable phone-call skills, provider adapters, scheduler recipes, automation patterns, and safety references for AI agents.

## What belongs here

Good contributions include:

- Agent Skills for phone-call workflows
- provider adapter references
- host scheduler recipes
- MCP or plugin integration notes
- safe reminder workflows
- examples for Codex, Claude Code, Cowork-style agents, OpenClaw, Hermes, skill.sh-installed agents, and other Agent Skills-compatible environments

Out of scope:

- generic telephony vendor listings with no agent workflow
- marketing-only pages
- projects without clear setup instructions
- tools that require unsafe credential handling
- skills that hide phone calls, recurring jobs, or external side effects from the user

## Submission checklist

Before opening a pull request, check that your contribution:

- uses English-only repository-facing content
- does not include secrets, tokens, private phone numbers, or personal data
- clearly states what host or provider it supports
- clearly describes side effects
- has install or usage instructions
- masks phone numbers in examples unless they are fictional examples
- includes cancellation or rollback behavior for recurring workflows
- passes repository validation

Run:

```bash
python3 scripts/validate_repository.py
```

## Skill folder requirements

A skill should be a directory with a required `SKILL.md` file.

Recommended structure:

```text
skills/example-skill/
├── SKILL.md
├── README.md
├── references/
├── scripts/
└── examples/
```

The frontmatter should include at least:

```yaml
---
name: example-skill
description: What this skill does and when to use it.
license: MIT
---
```

The directory name and `name` should match.

## Awesome list entries

When adding a resource to the README, use this format:

```markdown
- [Project Name](https://example.com) - One sentence explaining why this is useful for AI-agent phone-call workflows.
```

Keep descriptions short, specific, and factual.
