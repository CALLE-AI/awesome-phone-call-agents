# Git Naming Conventions

This document defines recommended formats for common Git names in this repository, covering branches, commits, tags, pull request titles, remotes, and stashes.

## General Rules

- Prefer English, ASCII, lowercase letters, numbers, and hyphens.
- Use kebab-case for multiple words, for example `google-form-callback`.
- Names should describe intent. Do not use only `new`, `update`, `wip`, `temp`, or `final`.
- Avoid spaces, underscores, mixed case, special characters, and personal names.
- When an existing directory or artifact name can express the scope, prefer it, for example `call-reminder`, `google-form-callback`, `outbound-call-skill-creator`, `apps`, `plugins`, or `docs`.

## Branch Names

Use this format for regular branches:

```text
<type>/<short-kebab-summary>
```

Common `type` values:

- `feat`: new feature
- `fix`: bug fix
- `docs`: documentation change
- `chore`: maintenance change
- `refactor`: behavior-preserving refactor
- `test`: test-related change
- `ci`: GitHub Actions or CI configuration
- `build`: build, packaging, or dependency configuration
- `release`: release preparation branch
- `hotfix`: urgent fix branch
- `spike`: exploratory experiment branch; before merging, rename it to a formal type or close it

Recommended examples:

```text
feat/google-form-callback-writeback
fix/call-reminder-timezone-validation
docs/git-naming-conventions
ci/repository-validation
```

Before creating a branch, validate the candidate locally:

```bash
python3 scripts/check_branch_name.py --branch docs/git-naming-conventions
```

Or create it through the repository helper, which validates the name, checks for an existing local or fetched `origin` branch, then runs `git switch -c`:

```bash
python3 scripts/create_branch.py docs/git-naming-conventions
```

To enable the repository pre-push hook for this clone, run:

```bash
git config core.hooksPath .githooks
```

When `python3 scripts/check_branch_name.py` discovers the current branch automatically, it skips long-lived branches such as `main`. Explicit candidates passed with `--branch` are always validated.

Not recommended:

```text
feature
fix_bug
WIP-callback
ray-test
update
```

## Commit Messages

Commit messages should follow the Conventional Commits style:

```text
<type>(<scope>): <summary>
```

Omit `scope` when there is no clear scope:

```text
<type>: <summary>
```

Common `type` values should stay aligned with branch types:

- `feat`
- `fix`
- `docs`
- `chore`
- `refactor`
- `test`
- `ci`
- `build`
- `perf`
- `revert`

Recommended `scope` values:

- `call-reminder`
- `google-form-callback`
- `outbound-call-skill-creator`
- `apps`
- `plugins`
- `docs`
- `validation`

Recommended examples:

```text
feat(google-form-callback): add dry-run response grouping
fix(call-reminder): clarify late-run skip behavior
docs: add git naming conventions
ci(validation): verify required app documentation
```

Commit summary rules:

- Use present-tense imperative mood, for example `add`, `fix`, or `remove`.
- Start with a lowercase letter and do not end with a period.
- Keep the summary short. Put complex context in the commit body.
- Use `!` for breaking changes and include `BREAKING CHANGE:` in the body.

Breaking change example:

```text
feat(call-reminder)!: require explicit scheduler adapter

BREAKING CHANGE: Scheduled reminder setup now requires an adapter id when no client adapter can be detected.
```

## Pull Request Titles

PR titles should reuse the commit message format when possible:

```text
<type>(<scope>): <summary>
```

Recommended examples:

```text
docs: add git naming conventions
fix(google-form-callback): clarify Sheets writeback setup
ci(validation): check required plugin documentation
```

When multiple commits are combined into one PR, the PR title should describe the final result that is visible to users or important to maintainers instead of listing all intermediate steps.

## Tags

Release tags should be created by maintainers through the repository release process. Do not manually move, overwrite, or rename tags that have already been published.

Use clear release tags when a whole-repository release is needed:

```text
v<major>.<minor>.<patch>
```

Recommended example:

```text
v0.1.0
```

If a future artifact-specific release process is introduced, document its tag format here before publishing tags that use it.

## Remotes

Use short names that identify ownership or purpose:

```text
origin
upstream
maintainer-name
```

Avoid remotes named after temporary tasks or local machine details.

## Stashes

When creating a stash that may be shared in handoff notes or revisited later, include a short message:

```bash
git stash push -m "docs git naming draft"
```

Use lowercase, plain English, and a concise description of the work in progress.
