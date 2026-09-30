# Host Install

`call-the-parts` is a standard Agent Skills folder. Any host that loads `SKILL.md` can use it. This file is the only place host-specific paths belong.

Copy or clone the `call-the-parts/` directory. Do not flatten it. `name` in the frontmatter must stay `call-the-parts`.

## Claude Code

Project skill:

```text
.claude/skills/call-the-parts/
```

User-level skill:

```text
~/.claude/skills/call-the-parts/
```

Or the host's `skills add` command pointed at this folder.

## Cursor

```text
.cursor/skills/call-the-parts/
```

or the user skills directory the Cursor docs name for Agent Skills.

## Codex / skills.sh

```bash
npx skills add <path-or-repo> --skill call-the-parts -y --agent codex
```

Use the agent name that host documents (`codex`, `openclaw`, and others).

## Hermes / OpenClaw

Place the folder where that host reads skills (often a project `skills/` directory or the OpenClaw skills path). OpenClaw may declare:

```yaml
requires:
  bins: ["node"]
  anyBins: ["calle", "npx"]
```

Do not auto-install the CALL-E CLI.

## Any Other Agent Skills Host

If the host can load a directory with `SKILL.md` + YAML frontmatter, this skill works. Point it at this folder. Preview and validation need `node` for the scripts. Live calls need a CALL-E CLI or MCP route on that same machine.

## What The Host Must Provide

| Need | Who provides it |
| --- | --- |
| This skill folder | You, via copy or `skills add` |
| `node` | The user's machine, for preview/validate scripts |
| CALL-E CLI or MCP | The user, via CALL-E's install guide |
| CALL-E login | The user (`calle auth login` or host MCP OAuth) |
| Shop search | Optional. The harness native web search only. No Firecrawl. No keys in this skill. |

This skill never phones home, never stores keys, and has no `.env`.
