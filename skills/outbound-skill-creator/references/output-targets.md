# Output Targets

Use this reference before creating files for a generated business skill.

## Design Basis

Popular agent tools separate reusable personal assets from repository-scoped assets:

- Claude Code Skills use user skills in `~/.claude/skills/` and project skills in `.claude/skills/`.
- GitHub Copilot Agent Skills use project skills in `.github/skills`, `.claude/skills`, or `.agents/skills`, and personal skills in `~/.copilot/skills` or `~/.agents/skills`.
- Cursor uses project rules in `.cursor/rules`, user rules as global preferences, and `AGENTS.md` for project or subdirectory instructions.
- Codex uses user-level configuration in `~/.codex/config.toml`, project-scoped overrides in `.codex/config.toml`, and explicit skill paths through `skills.config`.

Follow that same scope split for generated outbound skills.

## Scope-First Output Rule

Choose the scope first, then choose one host-compatible output parent directory, then create `<output-parent>/<business-skill-name>/`.

Do not create generated business skills inside the downloaded `outbound-skill-creator` folder. That folder is the generator, not the output location.

If the user provides an explicit output path, use that path after confirming it is a skills parent directory and that the generated skill will be discoverable or clearly documented as not yet discoverable.

## Target Options

| Scope | Use when | Output parent |
| --- | --- | --- |
| User-level reusable skill | The workflow should be available across projects, the source is an external system such as Google Forms or ttmcp, or the creator was installed by `skills.sh` and the user did not ask for project-local output. | A recognized user skills root |
| Project-local skill | The workflow depends on project files, project-local schemas, checked-in scripts, or should be shared with this repository's team. | A host-compatible project skills root |
| Reference repository contribution | The workflow is being added as a maintained public reference in this repository. | `<repo>/skills` |
| Explicit path | The user gives an exact parent directory. | The user-provided directory |

## User-Level Selection

For an installed creator used from a normal project, default to the user-level root that contains the installed `outbound-skill-creator` folder when that root is clearly a user skills directory, such as:

- `~/.agents/skills`
- `~/.codex/skills`
- `${CODEX_HOME}/skills`
- `~/.claude/skills`
- `~/.copilot/skills`

If the installed creator path is not visible, prefer `~/.agents/skills` when it exists because it is a portable Agent Skills location supported by multiple hosts. If no known user skills root exists, choose the best host-specific default:

| Host target | Default user parent |
| --- | --- |
| Codex or `skills.sh` | `~/.agents/skills`, then `${CODEX_HOME:-$HOME/.codex}/skills` |
| Claude Code | `~/.claude/skills` |
| GitHub Copilot | `~/.agents/skills`, then `~/.copilot/skills` |

Ask before creating a new user skills root if the host is unknown or if creating the directory would be outside the current writable scope.

## Project-Local Selection

Use project-local output only when the user asks for a repo-scoped skill or the generated skill depends on project-local files.

Choose an existing project skill root when one already exists. If no project root exists, choose by target host:

| Host target | Project parent |
| --- | --- |
| Portable Agent Skills or unknown host | `.agents/skills` |
| GitHub Copilot | `.github/skills` or `.agents/skills` |
| Claude Code | `.claude/skills` |
| This reference repository | `skills` |

Do not create a top-level `skills/` directory in an ordinary project unless the repository already uses that convention or the user explicitly asks for it.

## Discoverability Step

After writing the generated skill:

- If the skill was written to a known active skills root, report that it may require a skill reload or a new session before discovery.
- If the host supports a reload command, such as `/skills reload`, tell the user or run it only when the current interface supports it.
- If the skill was written to an explicit or nonstandard directory, do not claim it is discoverable. Record the add-location step, such as adding a skill path in host configuration or using a host command like `/skills add`.

## Required Capture

Record the selected output target in the generated skill creation notes:

- scope: user-level, project-local, reference repository, or explicit path
- output parent directory
- generated skill directory
- why this target was chosen
- host family or discovery mechanism
- whether a reload or add-location step is needed

## Validation Commands

Always run the bundled generated-skill checker against the actual generated directory:

```bash
node <path-to-outbound-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

Run project or repository validation only when the generated skill is written into a repository that provides such a command. For this reference repository, run:

```bash
python3 scripts/validate_repository.py
```

## Source Notes

- Claude Code Skills: https://code.claude.com/docs/en/agent-sdk/skills
- GitHub Copilot Agent Skills: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- Cursor Rules: https://cursor.com/docs/rules.md
- Codex configuration: https://developers.openai.com/codex/config-reference
