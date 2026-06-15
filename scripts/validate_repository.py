#!/usr/bin/env python3
"""Validate the Awesome Phone Call Agents repository structure.

This script intentionally uses only the Python standard library.
"""

from __future__ import annotations

import re
import sys
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REPOSITORY_TITLE = "Awesome Phone Call Agents"
REPOSITORY_SLUG = "awesome-phone-call-agents"
OLD_REPOSITORY_TITLE = "Awesome Phone Call " + "Skill"
OLD_REPOSITORY_SLUG = "awesome-phone-call-" + "skill"
README_SUBTITLE = "A community hub for reusable phone-call Agent Skills, runnable apps, workflow plugins, adapters, scheduler recipes, and safety patterns."
SKILLS_INSTALL_COMMAND = f"npx -y skills add CALLE-AI/{REPOSITORY_SLUG} --skill call-reminder -g"
TEXT_SUFFIXES = {".md", ".mjs", ".py", ".ts", ".json", ".toml", ".yaml", ".yml"}
SKIP_TEXT_FILES = {"uv.lock"}
SKIP_TEXT_DIRS = {".venv", "node_modules", ".pytest_cache", "__pycache__", ".mypy_cache", ".ruff_cache"}
OUTBOUND_CALL_SKILL_CHECKER = ROOT / "skills" / "outbound-call-skill-creator" / "scripts" / "check-generated-skill.mjs"
OUTBOUND_MCP_ROUTE = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    if not path.exists():
        fail(f"Missing file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def parse_frontmatter(text: str, path: Path) -> dict[str, str]:
    if not text.startswith("---\n"):
        fail(f"Missing YAML frontmatter: {path.relative_to(ROOT)}")
    end = text.find("\n---", 4)
    if end == -1:
        fail(f"Unterminated YAML frontmatter: {path.relative_to(ROOT)}")
    block = text[4:end].strip()
    result: dict[str, str] = {}
    for line in block.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        if ":" not in line:
            fail(f"Invalid frontmatter line in {path.relative_to(ROOT)}: {line}")
        key, value = line.split(":", 1)
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def validate_readme() -> None:
    text = read(ROOT / "README.md")
    if not text.startswith(f"# {REPOSITORY_TITLE}"):
        fail(f"README.md must start with '# {REPOSITORY_TITLE}'.")
    if README_SUBTITLE not in text:
        fail("README.md must include the approved project subtitle near the top.")
    if SKILLS_INSTALL_COMMAND not in text:
        fail("README.md must include the approved skills.sh install command.")
    forbid_text(
        ROOT / "README.md",
        [
            f"CALLE-AI/{OLD_REPOSITORY_SLUG}",
            f"{OLD_REPOSITORY_SLUG}/",
            f"npx skills add CALLE-AI/{OLD_REPOSITORY_SLUG}",
        ],
    )
    for snippet in [
        "skills/",
        "apps/",
        "plugins/",
        "[`outbound-call-skill-creator`](skills/outbound-call-skill-creator/)",
        "npx -y skills add CALLE-AI/awesome-phone-call-agents --skill outbound-call-skill-creator -g",
        "`node skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs --skill-dir <path>`",
        "[`skills/outbound-call-skill-creator/references/output-targets.md`](skills/outbound-call-skill-creator/references/output-targets.md)",
        "[`apps/python/batch-runner`](apps/python/batch-runner/)",
        "[`apps/python/broker-login-client`](apps/python/broker-login-client/)",
        "[`apps/typescript/broker-login-client`](apps/typescript/broker-login-client/)",
        "[`apps/typescript/broker-login-client-standalone`](apps/typescript/broker-login-client-standalone/)",
        "[`apps/python/oauth-login-client`](apps/python/oauth-login-client/)",
        "[`apps/typescript/oauth-login-client`](apps/typescript/oauth-login-client/)",
    ]:
        if snippet not in text:
            fail(f"README.md must document repository scope or migrated apps: {snippet}")


def validate_repository_name_references() -> None:
    checked_dirs = [
        ROOT / ".github",
        ROOT / "README.md",
        ROOT / "AGENTS.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "SECURITY.md",
        ROOT / "apps",
        ROOT / "docs",
        ROOT / "plugins",
        ROOT / "scripts",
        ROOT / "skills",
    ]
    forbidden = [
        OLD_REPOSITORY_TITLE,
        OLD_REPOSITORY_SLUG,
        f"CALLE-AI/{OLD_REPOSITORY_SLUG}",
    ]
    for item in checked_dirs:
        if not item.exists():
            continue
        paths = [item] if item.is_file() else [path for path in item.rglob("*") if path.is_file()]
        for path in paths:
            relative_parts = set(path.relative_to(ROOT).parts)
            if relative_parts & SKIP_TEXT_DIRS:
                continue
            if path.name in SKIP_TEXT_FILES or path.suffix not in TEXT_SUFFIXES:
                continue
            text = read(path)
            for snippet in forbidden:
                if snippet in text:
                    fail(f"Old repository name found in {path.relative_to(ROOT)}: {snippet}")


def validate_english_only() -> None:
    checked_dirs = [
        ROOT / ".github",
        ROOT / "README.md",
        ROOT / "AGENTS.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "SECURITY.md",
        ROOT / "apps",
        ROOT / "docs",
        ROOT / "plugins",
        ROOT / "skills",
    ]
    for item in checked_dirs:
        if not item.exists():
            continue
        paths = [item] if item.is_file() else [path for path in item.rglob("*") if path.is_file()]
        for path in paths:
            relative_parts = set(path.relative_to(ROOT).parts)
            if relative_parts & SKIP_TEXT_DIRS:
                continue
            if path.name in SKIP_TEXT_FILES or path.suffix not in TEXT_SUFFIXES:
                continue
            text = read(path)
            if CJK_RE.search(text):
                fail(f"CJK text found in repository-facing content: {path.relative_to(ROOT)}")


def validate_skills() -> None:
    skills_dir = ROOT / "skills"
    if not skills_dir.exists():
        fail("Missing skills/ directory.")
    skill_dirs = [p for p in skills_dir.iterdir() if p.is_dir()]
    if not skill_dirs:
        fail("No skills found in skills/.")
    for skill_dir in skill_dirs:
        if not SLUG_RE.match(skill_dir.name):
            fail(f"Skill directory is not a lowercase slug: {skill_dir.name}")
        skill_md = skill_dir / "SKILL.md"
        text = read(skill_md)
        fm = parse_frontmatter(text, skill_md)
        name = fm.get("name")
        description = fm.get("description")
        if not name:
            fail(f"Missing name in {skill_md.relative_to(ROOT)}")
        if not description:
            fail(f"Missing description in {skill_md.relative_to(ROOT)}")
        if name != skill_dir.name:
            fail(f"Skill name '{name}' must match directory '{skill_dir.name}'.")
        if not SLUG_RE.match(name):
            fail(f"Skill name is not a lowercase slug: {name}")
        if len(description) < 40:
            fail(f"Skill description is too short: {skill_md.relative_to(ROOT)}")
        if "phone" not in description.lower() and "call" not in description.lower():
            fail(f"Skill description should mention phone/call workflow: {skill_md.relative_to(ROOT)}")


def validate_expected_files() -> None:
    expected = [
        "AGENTS.md",
        "CONTRIBUTING.md",
        "SECURITY.md",
        ".github/ISSUE_TEMPLATE/workflow_submission.yml",
        ".github/pull_request_template.md",
        ".github/workflows/validate.yml",
        "apps/README.md",
        "plugins/README.md",
        "docs/design-principles.md",
        "docs/codex-implementation-plan.md",
        "apps/python/broker-login-client/README.md",
        "apps/python/broker-login-client/client.py",
        "apps/python/broker-login-client/uv.lock",
        "apps/typescript/broker-login-client/README.md",
        "apps/typescript/broker-login-client/package.json",
        "apps/typescript/broker-login-client/src/client.ts",
        "apps/typescript/broker-login-client-standalone/README.md",
        "apps/typescript/broker-login-client-standalone/package.json",
        "apps/typescript/broker-login-client-standalone/src/client.ts",
        "apps/python/oauth-login-client/README.md",
        "apps/python/oauth-login-client/client.py",
        "apps/python/oauth-login-client/uv.lock",
        "apps/typescript/oauth-login-client/README.md",
        "apps/typescript/oauth-login-client/package.json",
        "apps/typescript/oauth-login-client/src/client.ts",
        "apps/python/batch-runner/README.md",
        "apps/python/batch-runner/client.py",
        "apps/python/batch-runner/example_market_alerts.jsonl",
        "apps/shared/fake-mcp-broker-server.mjs",
        "scripts/validate_repository.py",
        "skills/call-reminder/SKILL.md",
        "skills/call-reminder/references/client-adapters.md",
        "skills/call-reminder/references/runtime-prompt.md",
        "skills/call-reminder/references/calle-cli-bootstrap.md",
        "skills/call-reminder/references/safety.md",
        "skills/call-reminder/references/examples.md",
        "skills/call-reminder/scripts/detect-client.mjs",
        "skills/call-reminder/scripts/render-runtime-prompt.mjs",
        "skills/call-reminder/scripts/validate-reminder-input.mjs",
        "skills/outbound-call-skill-creator/SKILL.md",
        "skills/outbound-call-skill-creator/references/data-sources.md",
        "skills/outbound-call-skill-creator/references/generated-skill-contract.md",
        "skills/outbound-call-skill-creator/references/mcp-provider-route.md",
        "skills/outbound-call-skill-creator/references/output-targets.md",
        "skills/outbound-call-skill-creator/references/safety.md",
        "skills/outbound-call-skill-creator/references/examples.md",
        "skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs",
    ]
    for rel in expected:
        read(ROOT / rel)


def validate_templates() -> None:
    require_text(
        ROOT / ".github" / "ISSUE_TEMPLATE" / "workflow_submission.yml",
        [
            "phone-call skill, runnable app, workflow plugin, adapter, scheduler recipe, or safety resource",
            "Name of the skill, runnable app, workflow plugin, adapter, scheduler recipe, or resource",
            "- Runnable app",
            "- Workflow plugin",
        ],
    )
    forbid_text(
        ROOT / ".github" / "ISSUE_TEMPLATE" / "workflow_submission.yml",
        [
            "app, example",
            "- Example",
        ],
    )
    require_text(
        ROOT / ".github" / "pull_request_template.md",
        [
            "- [ ] New runnable app",
            "- [ ] New workflow plugin",
            "Phone numbers are masked in documentation and test fixtures unless they are clearly fictional.",
        ],
    )
    forbid_text(
        ROOT / ".github" / "pull_request_template.md",
        [
            "- [ ] New example",
        ],
    )


def validate_apps() -> None:
    apps_dir = ROOT / "apps"
    if not apps_dir.exists():
        fail("Missing apps/ directory.")
    if (ROOT / "examples").exists():
        fail("Top-level examples/ directory is no longer supported; put runnable demos under apps/.")
    require_text(
        apps_dir / "README.md",
        [
            "runnable phone-call workflow apps",
            "AI agents schedule, monitor, administer, or safely operate phone-call workflows",
            "dry-run or preview behavior",
            "[`python/batch-runner`](python/batch-runner/)",
            "[`python/broker-login-client`](python/broker-login-client/)",
            "[`typescript/broker-login-client`](typescript/broker-login-client/)",
            "[`typescript/broker-login-client-standalone`](typescript/broker-login-client-standalone/)",
            "[`python/oauth-login-client`](python/oauth-login-client/)",
            "[`typescript/oauth-login-client`](typescript/oauth-login-client/)",
        ],
    )
    app_dirs = [
        apps_dir / "python" / "batch-runner",
        apps_dir / "python" / "broker-login-client",
        apps_dir / "typescript" / "broker-login-client",
        apps_dir / "typescript" / "broker-login-client-standalone",
        apps_dir / "python" / "oauth-login-client",
        apps_dir / "typescript" / "oauth-login-client",
    ]
    for app_dir in app_dirs:
        read(app_dir / "README.md")

    forbidden_dependency_snippets = [
        '"@call-e/core": "file:',
        "../../../packages/core",
        "../../packages/core",
        "workspace:",
    ]
    for path in apps_dir.rglob("*"):
        if not path.is_file() or path.name in SKIP_TEXT_FILES or path.suffix not in TEXT_SUFFIXES:
            continue
        relative_parts = set(path.relative_to(ROOT).parts)
        if relative_parts & SKIP_TEXT_DIRS:
            continue
        text = read(path)
        for snippet in forbidden_dependency_snippets:
            if snippet in text:
                fail(f"App depends on source-repository internals in {path.relative_to(ROOT)}: {snippet}")

    for package_json in apps_dir.rglob("package.json"):
        payload = json.loads(read(package_json))
        dependencies = {}
        dependencies.update(payload.get("dependencies", {}))
        dependencies.update(payload.get("devDependencies", {}))
        for name, spec in dependencies.items():
            if isinstance(spec, str) and spec.startswith("file:"):
                fail(f"App package uses a local file dependency in {package_json.relative_to(ROOT)}: {name}")


def validate_plugins() -> None:
    plugins_dir = ROOT / "plugins"
    if not plugins_dir.exists():
        fail("Missing plugins/ directory.")
    require_text(
        plugins_dir / "README.md",
        [
            "no-code and low-code workflow-platform plugins",
            "nodes, actions, connectors, templates, or recipes",
            "trigger, configure, monitor, or review phone-call agent workflows",
            "preview, dry-run, or confirmation behavior",
            "cancellation, rollback, or disable instructions",
        ],
    )


def require_text(path: Path, snippets: list[str]) -> None:
    text = read(path)
    for snippet in snippets:
        if snippet not in text:
            fail(f"Missing required text in {path.relative_to(ROOT)}: {snippet}")


def forbid_text(path: Path, snippets: list[str]) -> None:
    text = read(path)
    for snippet in snippets:
        if snippet in text:
            fail(f"Forbidden text in {path.relative_to(ROOT)}: {snippet}")


def validate_call_reminder_acceptance_rules() -> None:
    skill_dir = ROOT / "skills" / "call-reminder"
    skill_md = skill_dir / "SKILL.md"
    fm = parse_frontmatter(read(skill_md), skill_md)
    if fm.get("name") != "call-reminder":
        fail("call-reminder frontmatter name must be call-reminder.")
    require_text(
        skill_md,
        [
            "scheduler wrapper skill",
            "does not add a CALL-E backend reminder API",
            "auth status -> call plan -> call run -> call status",
            "Do not call any number except the configured E.164 phone number",
            "The default late-run window is 30 minutes",
            "Never state that a schedule exists unless the client scheduler creation actually succeeded",
        ],
    )
    require_text(
        skill_dir / "references" / "calle-cli-bootstrap.md",
        [
            "Repository-Local",
            "Global",
            "Pinned Npx Fallback",
            "node packages/cli/bin/calle.js --help",
            "calle --help",
            "npx -y @call-e/cli@<repo-current-version> --help",
            "Do not replace `<repo-current-version>` with `latest`",
            "If no CLI route works and no CALL-E MCP or skill route is available",
        ],
    )
    require_text(
        skill_dir / "references" / "runtime-prompt.md",
        [
            "{{cadence}}",
            "{{local_time}}",
            "{{timezone}}",
            "{{phone_number}}",
            "{{reminder_message}}",
            "{{late_run_window_minutes}}",
            "{{calle_command}}",
            "{{client_adapter_id}}",
            "You are executing a user-authorized scheduled CALL-E phone reminder.",
            "If this run is more than {{late_run_window_minutes}} minutes late, skip the call.",
            "If CALL-E auth is missing or the CLI is unavailable, do not call. Report the failure.",
        ],
    )
    require_text(
        skill_dir / "references" / "client-adapters.md",
        [
            "id: codex-app",
            "id: codex-cli",
            "id: codex-ide",
            "id: claude-code-desktop",
            "id: claude-code-routine",
            "id: claude-code-loop",
            "id: openclaw",
            "id: github-copilot-vscode",
            "id: github-copilot-cli",
            "id: github-copilot-cloud-agent",
            "id: gemini-cli",
            "id: cursor",
            "id: antigravity",
            "id: windsurf",
            "id: zed",
            "id: cline",
            "id: roo",
            "id: continue",
            "id: opencode",
            "id: goose",
            "id: warp",
            "id: mcp-only",
            "id: external-cron",
            "id: shell-only",
            "schedulerType:",
            "schedulePersistence:",
            "requiresMachineAwake:",
            "callERoute:",
            "canCreateScheduleFromSkill:",
            "lateRunRisk:",
        ],
    )


def validate_outbound_call_skill_creator_acceptance_rules() -> None:
    skill_dir = ROOT / "skills" / "outbound-call-skill-creator"
    require_text(
        skill_dir / "SKILL.md",
        [
            "scope-first output rule",
            "If the installed `outbound-call-skill-creator` folder is inside a recognized user-level skills root",
            "Never write a generated business skill into the downloaded `outbound-call-skill-creator` skill folder itself.",
            "Run repository validation only when the generated skill is being committed to a repository that provides a validation command.",
        ],
    )
    require_text(
        skill_dir / "references" / "output-targets.md",
        [
            "Scope-First Output Rule",
            "Do not create generated business skills inside the downloaded `outbound-call-skill-creator` folder.",
            "For an installed creator used from a normal project, default to the user-level root that contains the installed `outbound-call-skill-creator` folder",
            "Do not create a top-level `skills/` directory in an ordinary project unless the repository already uses that convention or the user explicitly asks for it.",
            "If the skill was written to an explicit or nonstandard directory, do not claim it is discoverable.",
            "Run project or repository validation only when the generated skill is written into a repository that provides such a command.",
        ],
    )


def validate_outbound_generated_skill_checker() -> None:
    checker = OUTBOUND_CALL_SKILL_CHECKER
    read(checker)

    valid_skill_md = f"""---
name: generated-callback-skill
description: Generated phone call workflow skill for outbound candidate callback operations.
---

# Generated Callback Skill

## Purpose and When to Use

Use this generated business skill for user-authorized outbound phone call workflows.

## When Not to Use

Do not use this skill for emergency, medical, legal, or financial advice workflows.
Do not use a CLI bootstrap path.

## Source Contract

The source contract defines the approved data source and row ownership boundary.

## Candidate Fields

Candidate fields include candidate_id, name, phone_e164, timezone, and callback_reason.

## Outbound Goal Contract

The outbound goal contract defines the single-call goal and allowed conversation boundary.

## MCP Provider Route

Use the default MCP provider route: {OUTBOUND_MCP_ROUTE}

## Execution Modes

Supported execution modes are dry run, preview, and confirmed one-off run.

## Serial Candidate Execution

After approval, serially process all ready candidates. For each candidate, plan,
inspect, run, check status when available, record the result, and continue to
the next candidate without another per-candidate confirmation. After all
candidates finish, write configured results or output one final session table.

## Writeback Behavior

Writeback behavior records call status, timestamps, summaries, and masked phone numbers.

## Safety Summary

Safety summary: require explicit user intent, E.164 phone numbers, no duplicate jobs,
no hidden recurring schedules, no credential exposure, and clear cancellation behavior.

## Validation Commands

Run node skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs --skill-dir <skill-dir>.
"""

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(valid_skill_md, encoding="utf-8")
        (references_dir / "safety.md").write_text(
            "# Safety\n\nMask phone numbers and require explicit user intent.\n",
            encoding="utf-8",
        )
        (references_dir / "examples.md").write_text(
            "# Examples\n\nUse fictional E.164 numbers in examples.\n",
            encoding="utf-8",
        )

        success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if success.returncode != 0:
            fail(
                "Generated outbound skill checker smoke test failed: "
                + (success.stderr or success.stdout).strip()
            )

        (skill_dir / "template.md").write_text("Do not use templates.\n", encoding="utf-8")
        template_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        template_output = template_failure.stdout + template_failure.stderr
        if template_failure.returncode == 0:
            fail("Generated outbound skill checker must reject template.md.")
        if "Generated outbound skills must not use template.md" not in template_output:
            fail("Generated outbound skill checker template.md failure message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        extra_frontmatter_md = valid_skill_md.replace(
            "description: Generated phone call workflow skill for outbound candidate callback operations.\n",
            "description: Generated phone call workflow skill for outbound candidate callback operations.\nhost: codex\n",
        )
        (skill_dir / "SKILL.md").write_text(extra_frontmatter_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        extra_frontmatter_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        extra_frontmatter_output = extra_frontmatter_failure.stdout + extra_frontmatter_failure.stderr
        if extra_frontmatter_failure.returncode == 0:
            fail("Generated outbound skill checker must reject extra frontmatter fields.")
        if (
            "Generated skill frontmatter must include only name and description"
            not in extra_frontmatter_output
        ):
            fail("Generated outbound skill checker extra-frontmatter failure message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_section_md = valid_skill_md.replace(
            """## Safety Summary

Safety summary: require explicit user intent, E.164 phone numbers, no duplicate jobs,
no hidden recurring schedules, no credential exposure, and clear cancellation behavior.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_section_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_section_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_section_output = missing_section_failure.stdout + missing_section_failure.stderr
        if missing_section_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing required sections.")
        if "Generated skill SKILL.md must include safety summary" not in missing_section_output:
            fail("Generated outbound skill checker missing-section failure message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_serial_execution_md = valid_skill_md.replace(
            """## Serial Candidate Execution

After approval, serially process all ready candidates. For each candidate, plan,
inspect, run, check status when available, record the result, and continue to
the next candidate without another per-candidate confirmation. After all
candidates finish, write configured results or output one final session table.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_serial_execution_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_serial_execution_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_serial_execution_output = (
            missing_serial_execution_failure.stdout + missing_serial_execution_failure.stderr
        )
        if missing_serial_execution_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing serial execution.")
        if (
            "Generated skill SKILL.md must include serial candidate execution"
            not in missing_serial_execution_output
        ):
            fail("Generated outbound skill checker missing-serial-execution message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            valid_skill_md + "\n" + chr(0x20000) + "\n",
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        supplementary_han_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        supplementary_han_output = supplementary_han_failure.stdout + supplementary_han_failure.stderr
        if supplementary_han_failure.returncode == 0:
            fail("Generated outbound skill checker must reject supplementary Han script.")
        if "Non-English CJK, Japanese, or Korean script found" not in supplementary_han_output:
            fail("Generated outbound skill checker supplementary-Han failure message changed.")


def main() -> None:
    validate_expected_files()
    validate_readme()
    validate_repository_name_references()
    validate_english_only()
    validate_templates()
    validate_apps()
    validate_plugins()
    validate_skills()
    validate_call_reminder_acceptance_rules()
    validate_outbound_call_skill_creator_acceptance_rules()
    validate_outbound_generated_skill_checker()
    print("Repository validation passed.")


if __name__ == "__main__":
    main()
