#!/usr/bin/env python3
"""Validate the Awesome Phone Call Skill repository structure.

This script intentionally uses only the Python standard library.
"""

from __future__ import annotations

import re
import sys
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
README_SUBTITLE = "Portable phone-call Agent Skills, apps, adapters, scheduler recipes, and safety patterns for AI agents."
TEXT_SUFFIXES = {".md", ".mjs", ".py", ".ts", ".json", ".toml", ".yaml", ".yml"}
SKIP_TEXT_FILES = {"uv.lock"}
SKIP_TEXT_DIRS = {".venv", "node_modules", ".pytest_cache", "__pycache__", ".mypy_cache", ".ruff_cache"}


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
    if not text.startswith("# Awesome Phone Call Skill"):
        fail("README.md must start with '# Awesome Phone Call Skill'.")
    if README_SUBTITLE not in text:
        fail("README.md must include the approved project subtitle near the top.")
    for snippet in ["skills/", "apps/", "examples/", "mcp-oauth-client", "mcp-broker-client", "python-batch-runner"]:
        if snippet not in text:
            fail(f"README.md must document repository scope or migrated examples: {snippet}")


def validate_english_only() -> None:
    checked_dirs = [
        ROOT / ".github",
        ROOT / "README.md",
        ROOT / "AGENTS.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "SECURITY.md",
        ROOT / "apps",
        ROOT / "docs",
        ROOT / "examples",
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
        "docs/design-principles.md",
        "docs/codex-implementation-plan.md",
        "examples/README.md",
        "examples/mcp-broker-client/README.md",
        "examples/mcp-broker-client/python/README.md",
        "examples/mcp-broker-client/python/client.py",
        "examples/mcp-broker-client/typescript/package.json",
        "examples/mcp-broker-client/typescript/src/client.ts",
        "examples/mcp-broker-client/typescript-standalone/package.json",
        "examples/mcp-broker-client/typescript-standalone/src/client.ts",
        "examples/mcp-oauth-client/README.md",
        "examples/mcp-oauth-client/python/README.md",
        "examples/mcp-oauth-client/python/client.py",
        "examples/mcp-oauth-client/typescript/package.json",
        "examples/mcp-oauth-client/typescript/src/client.ts",
        "examples/python-batch-runner/README.md",
        "examples/python-batch-runner/client.py",
        "examples/python-batch-runner/example_market_alerts.jsonl",
        "examples/shared/fake-mcp-broker-server.mjs",
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
    ]
    for rel in expected:
        read(ROOT / rel)


def validate_apps() -> None:
    apps_dir = ROOT / "apps"
    if not apps_dir.exists():
        fail("Missing apps/ directory.")
    require_text(
        apps_dir / "README.md",
        [
            "runnable phone-call workflow apps",
            "AI agents schedule, monitor, administer, or safely operate phone-call workflows",
            "dry-run or preview behavior",
        ],
    )


def validate_examples() -> None:
    examples_dir = ROOT / "examples"
    if not examples_dir.exists():
        fail("Missing examples/ directory.")
    require_text(
        examples_dir / "README.md",
        [
            "runnable MCP client demos",
            "not a CALL-E SDK",
            "local fake broker/OAuth/MCP server",
        ],
    )
    for example_dir in examples_dir.iterdir():
        if not example_dir.is_dir() or example_dir.name == "shared":
            continue
        read(example_dir / "README.md")

    forbidden_dependency_snippets = [
        '"@call-e/core": "file:',
        "../../../packages/core",
        "../../packages/core",
        "workspace:",
    ]
    for path in examples_dir.rglob("*"):
        if not path.is_file() or path.name in SKIP_TEXT_FILES or path.suffix not in TEXT_SUFFIXES:
            continue
        relative_parts = set(path.relative_to(ROOT).parts)
        if relative_parts & SKIP_TEXT_DIRS:
            continue
        text = read(path)
        for snippet in forbidden_dependency_snippets:
            if snippet in text:
                fail(f"Example depends on source-repository internals in {path.relative_to(ROOT)}: {snippet}")

    for package_json in examples_dir.rglob("package.json"):
        payload = json.loads(read(package_json))
        dependencies = {}
        dependencies.update(payload.get("dependencies", {}))
        dependencies.update(payload.get("devDependencies", {}))
        for name, spec in dependencies.items():
            if isinstance(spec, str) and spec.startswith("file:"):
                fail(f"Example package uses a local file dependency in {package_json.relative_to(ROOT)}: {name}")


def require_text(path: Path, snippets: list[str]) -> None:
    text = read(path)
    for snippet in snippets:
        if snippet not in text:
            fail(f"Missing required text in {path.relative_to(ROOT)}: {snippet}")


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


def main() -> None:
    validate_expected_files()
    validate_readme()
    validate_english_only()
    validate_apps()
    validate_examples()
    validate_skills()
    validate_call_reminder_acceptance_rules()
    print("Repository validation passed.")


if __name__ == "__main__":
    main()
