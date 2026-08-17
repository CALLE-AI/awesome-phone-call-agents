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
import textwrap
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKILL_LOCAL_REFERENCE_RE = re.compile(r"(?<![A-Za-z0-9_./-])(?:\./)?((?:scripts|references)/[A-Za-z0-9][A-Za-z0-9._/-]*)")
ACTIONABLE_REFERENCE_LINE_RE = re.compile(
    r"\b(?:read|use|using|see|open|load|follow|check|consult|refer to|source of truth)\b",
    re.IGNORECASE,
)
REPOSITORY_TITLE = "Awesome Phone Call Agents"
OLD_REPOSITORY_TITLE = "Awesome Phone Call " + "Skill"
OLD_REPOSITORY_SLUG = "awesome-phone-call-" + "skill"
README_SUBTITLE = "A community hub for reusable phone-call Agent Skills, runnable apps, workflow plugins, adapters, scheduler recipes, and safety patterns."
CLI_REFERENCE_SENTENCE = "CALL-E CLI parameters and command flags are documented in [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md)."
TEXT_SUFFIXES = {".md", ".mjs", ".py", ".ts", ".json", ".toml", ".yaml", ".yml"}
SKIP_TEXT_FILES = {"uv.lock"}
SKIP_TEXT_DIRS = {".venv", "node_modules", ".pytest_cache", "__pycache__", ".mypy_cache", ".ruff_cache"}
EMAIL_ADDRESS_RE = re.compile(
    r"(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])"
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"(?P<domain>[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)"
    r"(?![A-Za-z0-9-])"
)
ALLOWED_SKILL_EXAMPLE_EMAIL_DOMAINS = {
    "example.com",
    "example.net",
    "example.org",
}
OUTBOUND_CALL_SKILL_CHECKER = ROOT / "skills" / "outbound-call-skill-creator" / "scripts" / "check-generated-skill.mjs"
OUTBOUND_MCP_ROUTE = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"
OUTBOUND_SOURCE_FAMILY_README_TERMS = {
    "google-form": "Google Forms",
    "tiktok-ads": "TikTok Ads",
    "notion": "Notion",
    "airtable": "Airtable",
    "local-csv": "local CSV",
    "other": "custom sources",
}


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


def extract_referenced_skill_local_paths(text: str) -> set[Path]:
    paths: set[Path] = set()
    for line in text.splitlines():
        for match in SKILL_LOCAL_REFERENCE_RE.finditer(line):
            raw_path = match.group(1).rstrip(".,;:)]}`'\"")
            path = Path(raw_path)
            if len(path.parts) < 2 or path.parts[0] not in {"scripts", "references"}:
                continue
            if any(part in {"", ".", ".."} for part in path.parts):
                continue
            if path.parts[0] == "references" and not is_actionable_reference_line(line, match.end()):
                continue
            paths.add(path)
    return paths


def is_actionable_reference_line(line: str, match_end: int) -> bool:
    return bool(
        ACTIONABLE_REFERENCE_LINE_RE.search(line)
        or re.match(r"\s*:", line[match_end:].lstrip("`'\" )]"))
    )


def missing_referenced_skill_local_paths(skill_dir: Path, text: str) -> list[Path]:
    return sorted(
        (
            relative_path
            for relative_path in extract_referenced_skill_local_paths(text)
            if not (skill_dir / relative_path).is_file()
        ),
        key=str,
    )


def extract_outbound_source_family_slugs(skill_text: str) -> list[str]:
    marker = "Present these source families by default:"
    start = skill_text.find(marker)
    if start == -1:
        fail("outbound-call-skill-creator SKILL.md must list built-in source families.")
    slugs: list[str] = []
    for line in skill_text[start + len(marker) :].splitlines():
        match = re.match(r"^- `([^`]+)`:", line)
        if match:
            slugs.append(match.group(1))
        elif slugs and not line.strip():
            break
    if not slugs:
        fail("outbound-call-skill-creator SKILL.md must include source family slugs.")
    return slugs


def validate_outbound_source_families_in_readme(readme_text: str, skill_text: str) -> None:
    entry_match = re.search(
        r"^- \[`outbound-call-skill-creator`\]\(skills/outbound-call-skill-creator/\) - (?P<description>.+)$",
        readme_text,
        re.MULTILINE,
    )
    if not entry_match:
        fail("README.md must include the outbound-call-skill-creator resource list entry.")

    entry = entry_match.group("description")
    slugs = extract_outbound_source_family_slugs(skill_text)
    missing_term_mappings = sorted(
        slug for slug in slugs if slug not in OUTBOUND_SOURCE_FAMILY_README_TERMS
    )
    if missing_term_mappings:
        fail(
            "Add README validation display terms for outbound source families: "
            + ", ".join(missing_term_mappings)
        )

    missing_terms = [
        OUTBOUND_SOURCE_FAMILY_README_TERMS[slug]
        for slug in slugs
        if OUTBOUND_SOURCE_FAMILY_README_TERMS[slug] not in entry
    ]
    if missing_terms:
        fail(
            "README.md outbound-call-skill-creator entry must mention built-in source families: "
            + ", ".join(missing_terms)
        )


def iter_skill_dirs() -> list[Path]:
    skills_dir = ROOT / "skills"
    if not skills_dir.exists():
        fail("Missing skills/ directory.")
    skill_dirs = sorted(path for path in skills_dir.iterdir() if path.is_dir())
    if not skill_dirs:
        fail("No skills found in skills/.")
    return skill_dirs


def find_disallowed_email_locations(text: str) -> list[tuple[int, int]]:
    """Return line and column locations without retaining matched addresses."""
    locations: list[tuple[int, int]] = []
    for match in EMAIL_ADDRESS_RE.finditer(text):
        domain = match.group("domain")
        top_level_label = domain.rsplit(".", 1)[-1]
        if not any(character.isalpha() for character in top_level_label):
            continue
        if domain.casefold() in ALLOWED_SKILL_EXAMPLE_EMAIL_DOMAINS:
            continue
        line = text.count("\n", 0, match.start()) + 1
        previous_newline = text.rfind("\n", 0, match.start())
        column = match.start() - previous_newline
        locations.append((line, column))
    return locations


def iter_skill_example_and_script_text_files() -> list[tuple[Path, str]]:
    files: list[tuple[Path, str]] = []
    for skill_dir in iter_skill_dirs():
        examples_path = skill_dir / "references" / "examples.md"
        files.append((examples_path, read(examples_path)))

        scripts_dir = skill_dir / "scripts"
        if not scripts_dir.is_dir():
            continue
        for path in sorted(candidate for candidate in scripts_dir.rglob("*") if candidate.is_file()):
            relative_parts = path.relative_to(scripts_dir).parts
            if path.is_symlink() or any(part in SKIP_TEXT_DIRS for part in relative_parts):
                continue
            if path.name in SKIP_TEXT_FILES:
                continue
            try:
                data = path.read_bytes()
            except OSError:
                fail(f"Could not read skill script: {path.relative_to(ROOT)}")
            if b"\0" in data:
                continue
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                continue
            files.append((path, text))
    return files


def format_disallowed_email_failure(
    locations: list[tuple[Path, int, int]],
) -> str:
    rendered_locations = "\n".join(
        f"- {path.as_posix()}:{line}" for path, line, _column in locations
    )
    return (
        "Non-example email address found in skill examples or scripts:\n"
        f"{rendered_locations}\n"
        "Skill examples and scripts may only use example.com, example.net, or example.org."
    )


def validate_skill_email_checker() -> None:
    allowed_text = "\n".join(
        [
            "contact@example.com",
            "SUPPORT@EXAMPLE.NET",
            "first.last+followup@example.org",
            "Multiple addresses: one@example.com and two@example.net.",
            "Package reference: @scope/package",
            "Version marker: package@1.2.3",
        ]
    )
    if find_disallowed_email_locations(allowed_text):
        fail("Skill email checker rejected an allowed example domain.")

    disallowed_domain = "example." + "invalid"
    disallowed_address = "contact@" + disallowed_domain
    disallowed_cases = [
        disallowed_address,
        "contact@" + "sub.example.com",
        "contact@" + "example.test",
        disallowed_address.upper(),
        f"safe@example.com and {disallowed_address}",
    ]
    for case in disallowed_cases:
        if not find_disallowed_email_locations(case):
            fail("Skill email checker accepted a disallowed example domain.")

    locations = find_disallowed_email_locations(f"Header\n{disallowed_address}\n")
    if locations != [(2, 1)]:
        fail("Skill email checker reported an incorrect location.")

    message = format_disallowed_email_failure(
        [(Path("skills/example/scripts/check.js"), 2, 1)]
    )
    if disallowed_address in message:
        fail("Skill email checker failure message exposed a matched address.")


def validate_skill_example_and_script_emails() -> None:
    violations: list[tuple[Path, int, int]] = []
    for path, text in iter_skill_example_and_script_text_files():
        for line, column in find_disallowed_email_locations(text):
            violations.append((path.relative_to(ROOT), line, column))
    if violations:
        fail(format_disallowed_email_failure(violations))


def validate_readme() -> None:
    text = read(ROOT / "README.md")
    if not text.startswith(f"# {REPOSITORY_TITLE}"):
        fail(f"README.md must start with '# {REPOSITORY_TITLE}'.")
    if README_SUBTITLE not in text:
        fail("README.md must include the approved project subtitle near the top.")
    if CLI_REFERENCE_SENTENCE not in text:
        fail("README.md must include the approved CALL-E CLI reference sentence.")
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


def validate_skill_reference_path_checker() -> None:
    sample = (
        "Use `scripts/render-runtime-prompt.mjs`, read references/runtime-prompt.md, "
        "then run scripts/validate-reminder-input.mjs."
    )
    expected = {
        Path("references/runtime-prompt.md"),
        Path("scripts/render-runtime-prompt.mjs"),
        Path("scripts/validate-reminder-input.mjs"),
    }
    actual = extract_referenced_skill_local_paths(sample)
    if expected - actual:
        fail("Skill local reference checker must find local scripts/ and references/ paths.")

    missing = missing_referenced_skill_local_paths(
        ROOT / "skills" / "call-reminder",
        "Use scripts/does-not-exist.mjs for this workflow.",
    )
    if missing != [Path("scripts/does-not-exist.mjs")]:
        fail("Skill helper-script reference checker must report missing local scripts.")

    root_backed_missing = missing_referenced_skill_local_paths(
        ROOT / "skills" / "call-reminder",
        "Use scripts/validate_repository.py for this workflow.",
    )
    if root_backed_missing != [Path("scripts/validate_repository.py")]:
        fail("Skill local reference checker must not accept repository-root fallback files.")

    dot_prefixed_missing = missing_referenced_skill_local_paths(
        ROOT / "skills" / "call-reminder",
        "Use ./scripts/does-not-exist.mjs and read ./references/missing.md.",
    )
    if dot_prefixed_missing != [
        Path("references/missing.md"),
        Path("scripts/does-not-exist.mjs"),
    ]:
        fail("Skill local reference checker must normalize ./-prefixed local paths.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "missing-reference-skill"
        (skill_dir / "references").mkdir(parents=True)
        (skill_dir / "references" / "safety.md").write_text("# Safety\n", encoding="utf-8")
        missing_reference = missing_referenced_skill_local_paths(
            skill_dir,
            "Read references/binding-contract.md before creating the workflow.",
        )
        if missing_reference != [Path("references/binding-contract.md")]:
            fail("Skill local reference checker must report missing referenced references.")


def validate_skills() -> None:
    allowed_skill_readmes = {
        ROOT / "skills" / "outbound-call-skill-creator" / "README.md",
    }
    for skill_dir in iter_skill_dirs():
        if not SLUG_RE.match(skill_dir.name):
            fail(f"Skill directory is not a lowercase slug: {skill_dir.name}")
        skill_readme = skill_dir / "README.md"
        if skill_readme.exists() and skill_readme not in allowed_skill_readmes:
            fail(
                f"Skill directory must not include README.md; move long-form guidance to docs/: "
                f"{skill_readme.relative_to(ROOT)}"
            )
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
        references_dir = skill_dir / "references"
        if not references_dir.is_dir():
            fail(f"Skill must include references/ directory: {references_dir.relative_to(ROOT)}")
        read(references_dir / "safety.md")
        read(references_dir / "examples.md")
        for missing_script in missing_referenced_skill_local_paths(skill_dir, text):
            fail(
                f"Skill references missing local file: "
                f"{(skill_dir / missing_script).relative_to(ROOT)}"
            )


def validate_expected_files() -> None:
    expected = [
        "AGENTS.md",
        "CONTRIBUTING.md",
        "SECURITY.md",
        ".githooks/pre-push",
        ".github/ISSUE_TEMPLATE/workflow_submission.yml",
        ".github/pull_request_template.md",
        ".github/workflows/validate.yml",
        "apps/README.md",
        "plugins/README.md",
        "docs/design-principles.md",
        "docs/git-naming-conventions.md",
        "docs/outbound-call-skill-creator/README.md",
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
        "scripts/check_branch_name.py",
        "scripts/create_branch.py",
        "scripts/validate_repository.py",
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
            "Branch name, commit messages, and PR title follow `docs/git-naming-conventions.md`.",
            "Phone numbers are masked in documentation and test fixtures unless they are clearly fictional.",
        ],
    )
    forbid_text(
        ROOT / ".github" / "pull_request_template.md",
        [
            "- [ ] New example",
        ],
    )


def validate_git_naming_conventions() -> None:
    require_text(
        ROOT / "docs" / "git-naming-conventions.md",
        [
            "<type>/<short-kebab-summary>",
            "feat/google-form-callback-writeback",
            "python3 scripts/check_branch_name.py --branch docs/git-naming-conventions",
            "python3 scripts/create_branch.py docs/git-naming-conventions",
            "git config core.hooksPath .githooks",
        ],
    )
    require_text(
        ROOT / "AGENTS.md",
        [
            "docs/git-naming-conventions.md",
            "python3 scripts/check_branch_name.py --branch <type>/<short-kebab-summary>",
            "python3 scripts/create_branch.py <type>/<short-kebab-summary>",
        ],
    )
    require_text(
        ROOT / "CONTRIBUTING.md",
        [
            "docs/git-naming-conventions.md",
            "python3 scripts/check_branch_name.py --branch docs/git-naming-conventions",
            "python3 scripts/create_branch.py docs/git-naming-conventions",
        ],
    )
    require_text(
        ROOT / ".githooks" / "pre-push",
        [
            "python3 scripts/check_branch_name.py",
        ],
    )

    from check_branch_name import validate_branch_name

    valid_branch = validate_branch_name("docs/git-naming-conventions")
    if not valid_branch.ok:
        fail(f"Branch name checker rejected a valid branch: {valid_branch.message}")

    invalid_branch = validate_branch_name("bad_name")
    if invalid_branch.ok:
        fail("Branch name checker accepted invalid branch name: bad_name")


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
    validate_dify_template()


def validate_no_trailing_whitespace(path: Path) -> None:
    for line_number, line in enumerate(read(path).splitlines(), 1):
        if line.rstrip(" \t") != line:
            fail(f"Trailing whitespace in {path.relative_to(ROOT)}:{line_number}")


def text_between(path: Path, text: str, start: str, end: str) -> str:
    start_index = text.find(start)
    if start_index == -1:
        fail(f"Missing required text in {path.relative_to(ROOT)}: {start}")
    end_index = text.find(end, start_index)
    if end_index == -1:
        fail(f"Missing required text after {start!r} in {path.relative_to(ROOT)}: {end}")
    return text[start_index:end_index]


def dify_node_section(path: Path, text: str, title: str) -> str:
    title_marker = f"title: {title}"
    title_index = text.find(title_marker)
    if title_index == -1:
        fail(f"Missing Dify node in {path.relative_to(ROOT)}: {title}")
    node_start = text.rfind("\n    - data:", 0, title_index)
    if node_start == -1:
        fail(f"Missing Dify node data in {path.relative_to(ROOT)}: {title}")
    node_end = text.find("\n    - data:", title_index)
    return text[node_start:node_end if node_end != -1 else len(text)]


def dify_variable_binding(section: str, target_variable: str, source_node: str, source_variable: str) -> bool:
    lines = section.splitlines()
    for index, line in enumerate(lines):
        if line.strip() != f"variable: {target_variable}":
            continue
        nearby = "\n".join(lines[max(0, index - 5):index + 6])
        if f"- {source_node}" in nearby and f"- {source_variable}" in nearby:
            return True
    return False


def embedded_python_main(path: Path, section: str):
    marker = re.search(r"(?m)^(?P<indent>[ \t]*)code: \|\n", section)
    if not marker:
        fail(f"Missing embedded Python code in {path.relative_to(ROOT)}.")
    content_prefix = marker.group("indent") + "  "
    code_lines: list[str] = []
    for line in section[marker.end():].splitlines():
        if line.startswith(content_prefix):
            code_lines.append(line[len(content_prefix):])
            continue
        if not line.strip() and code_lines:
            code_lines.append("")
            continue
        break
    code = "\n".join(code_lines)
    if not code.strip():
        fail(f"Empty embedded Python code in {path.relative_to(ROOT)}.")
    namespace: dict[str, object] = {}
    exec(compile(code, str(path), "exec"), namespace)
    main = namespace.get("main")
    if not callable(main):
        fail(f"Embedded Python code has no callable main in {path.relative_to(ROOT)}.")
    return main


def validate_dify_template() -> None:
    plugin_dir = ROOT / "plugins" / "dify-template"
    plugins_readme_path = ROOT / "plugins" / "README.md"
    readme_path = plugin_dir / "README.md"
    dsl_path = plugin_dir / "examples" / "call-e-dify-workflow.dsl.yml"
    manifest_path = plugin_dir / "manifest.json"

    read(readme_path)
    read(plugins_readme_path)
    dsl_text = normalize_dify_code_scalars(dsl_path, read(dsl_path))
    read(manifest_path)
    validate_no_trailing_whitespace(dsl_path)

    require_text(
        readme_path,
        [
            "The Dify End node exposes only:",
            "| `report` | Human-readable final answer returned by the End node. |",
            "`summary_json` remains available inside the `Summarize iteration results` node for debugging.",
            "Only `https://api.heycall-e.com` is enabled by default.",
            "The workflow accepts only exact `true` or `false` for `dry_run`.",
            "`Gate live calls after API preflight` allows live-call creation only when `GET /v1/goals?limit=1` returns a 2xx status code.",
            "only after `GET /v1/goals?limit=1` returns a 2xx status code",
            "The polling sleep is capped below Dify's default 5-second code-node timeout",
            "grouped international phone numbers",
            "display formats with parentheses",
            "`CALL_E_API_KEY`",
            "Dify secret environment variable",
            "code nodes do not receive it as an input",
            "`request_id`",
            "stable per intended live call",
            "It must be 8-120 characters and may contain only `[A-Za-z0-9._:-]`.",
            "safety boundaries are prepended",
            "unknown and possibly created",
            "same idempotency key",
            "use Dify's `default-value` error strategy",
        ],
    )
    forbid_text(
        readme_path,
        [
            "The final answer includes:",
            "| `dryRun` | Whether the workflow ran in dry-run mode. |",
            "| `preview` | Masked phone number, task, metadata, and CALL-E endpoints used for the run. |",
            "| `result` | Parsed status, metadata round trip, polling state, transcript turns, summary, structured result, and redacted raw call result for the live call. |",
        ],
    )

    require_text_content(
        dsl_path,
        dsl_text,
        [
            "from urllib.parse import urlparse",
            "TRUSTED_BASE_URLS = {",
            "\"https://api.heycall-e.com\",",
            "normalize_trusted_base_url",
            "CALL-E base_url must use https.",
            "CALL-E base_url must be a trusted CALL-E API host.",
            "E164_RE = re.compile(r\"^\\+[1-9]\\d{6,14}$\")",
            "PHONE_IN_TEXT_RE = re.compile(r\"\\+[1-9]\\d{6,14}\")",
            "INTERNATIONAL_GROUPED_PHONE_RE = re.compile(r\"(?<!\\w)\\+[1-9](?:[\\s().-]*\\d){6,14}(?![\\s().-]*\\d)\")",
            "PHONE_LIKE_RE = re.compile(r\"(?<!\\d)(?:\\+?1[\\s.-]?)?(?:\\(?[2-9]\\d{2}\\)?[\\s.-]?[2-9]\\d{2}[\\s.-]?\\d{4}|[1-9]\\d{6,14})(?!\\d)\")",
            "text = INTERNATIONAL_GROUPED_PHONE_RE.sub(lambda match: mask_phone_like(match.group(0)), str(value or \"\"))",
            "redact_phone_values",
            "return {redact_phone_text(k) if isinstance(k, str) else k: redact_phone_values(v) for k, v in value.items()}",
            "def parse_dry_run(value) -> bool:",
            "normalized = str(value or \"\").strip()",
            "if normalized == \"false\":",
            "raise ValueError(\"dry_run must be either true or false. Use false only when you intend to create one live outbound call.\")",
            "\"+15555550123\"",
            "poll_interval_seconds = 20",
            "wait_timeout_minutes = 15",
            "seconds = max(0.0, min(seconds, 4.0))",
            "name: CALL_E_API_KEY",
            "value_type: secret",
            "version: 0.6.0",
            "error_strategy: default-value",
            "SAFETY_PREAMBLE =",
            "These safety boundaries override the user-provided task.",
            "medical, legal, financial, and emergency",
            "def build_safe_task(user_task: str) -> str:",
            "\"task\": build_safe_task(call_task[\"task\"])",
            "import hashlib",
            "idempotency_basis = json.dumps(",
            "hashlib.sha256(idempotency_basis.encode(\"utf-8\")).hexdigest()",
            "\"requestId\": request_id",
            "redacted_returned_data",
            "metadata_keys = sorted([str(k) for k in metadata_sent_raw.keys()])",
            "rawLookupJson\": json.dumps(redact_phone_values(final_body), ensure_ascii=False)",
            "raw_call_result_json = json.dumps(redact_phone_values(call), ensure_ascii=False)",
            "safe_call = redact_phone_values(call)",
            "safe_call_payload[\"_dify_metadata_round_trip\"] = metadata_round_trip",
            "\"latest_call_json\": json.dumps(safe_call, ensure_ascii=False)",
            "\"initialCallJson\": redacted_json",
            "\"createResponseJson\": redacted_json",
            "context.get(\"createFailed\")",
            "context.get(\"createOutcomeUnknown\")",
            "\"creation_state\": \"unknown_possibly_created\"",
            "\"created\": None",
            "CALL-E create request ended without a determinate HTTP response.",
            "Replay or reconcile this request only with the same Idempotency-Key",
            "title: Gate live calls after API preflight",
            "api_health_status_code",
            "api_health_ok = 200 <= status_code < 300",
            "health_status = format_health_status(api_health_status_code)",
            "Status: Connectivity error",
            "Check CALL_E_API_KEY, base_url, and CALL-E availability.",
            "def lookup_status_text(lookup, polling) -> str:",
            "if lookup.get(\"skipped\"):",
            "if polling.get(\"errorMessage\"):",
            "created_count = sum(",
            "f\"Live calls confirmed created: {created_count}\"",
            "f\"Call creation outcomes unknown (possibly created): {creation_unknown}\"",
            "\"liveCallsCreated\": 0 if dry_run_enabled else (None if creation_unknown else created_count)",
            "\"creationOutcomeUnknownCount\": 0 if dry_run_enabled else creation_unknown",
            "def documented_call_task(value):",
            "value.get(\"object\") != \"call_task\"",
            "CALL_ID_RE.fullmatch(call_id)",
            "status not in DOCUMENTED_CALL_STATUSES",
            "poll_error = str(poll_error_message or call.get(\"_dify_poll_error\") or \"\").strip()",
            "failed = bool(poll_error) or bool(poll_timed_out)",
        ],
    )
    if not re.search(r"api_key:\s*['\"]\{\{#env\.CALL_E_API_KEY#\}\}['\"]", dsl_text):
        fail("Dify template must pass CALL_E_API_KEY through the HTTP request credential field.")
    forbid_text_content(
        dsl_path,
        dsl_text,
        [
            "def parse_bool",
            "uuid.uuid4",
            "def redact_phone_fields",
            "redact_phone_fields(",
            "{k: redact_phone_values(v) for k, v in value.items()}",
            "metadata_keys = [\"lead_id\", \"notion_page_id\", \"company\", \"property\", \"campaign\"]",
            "f\"Live calls created: {len(safe_results)}\"",
            "\"liveCallsCreated\": 0 if dry_run_enabled else len(safe_results)",
            "line_value('polled until terminal' if not polling.get('timedOut') else 'timed out')",
            "\"latest_call_json\": json.dumps(call, ensure_ascii=False)",
            "\"initialCallJson\": json.dumps(body, ensure_ascii=False)",
            "\"createResponseJson\": json.dumps(body, ensure_ascii=False)",
            "E164_RE = re.compile(r\"^\\+[1-9]\\d{7,14}$\")",
            "PHONE_IN_TEXT_RE = re.compile(r\"\\+[1-9]\\d{7,14}\")",
            "INTERNATIONAL_GROUPED_PHONE_RE = re.compile(r\"(?<!\\w)\\+[1-9]\\d{0,2}(?:[\\s.-]?\\d){7,14}(?!\\d)\")",
            "[1-9]\\d{7,14})(?!\\d)",
            "def main(api_key:",
            "replace_with_calle_api_key",
        ],
    )
    if not re.search(r"^version: 0\.6\.0$", dsl_text, re.MULTILINE):
        fail("Dify template must use Dify DSL compatibility version 0.6.0.")
    if re.search(r"^version: 0\.6\.1$", dsl_text, re.MULTILINE):
        fail("Dify template release version must not replace the top-level DSL compatibility version.")
    env_section = text_between(dsl_path, dsl_text, "environment_variables:", "features:")
    prepare_section = dify_node_section(dsl_path, dsl_text, "Prepare one-shot call")
    start_section = dify_node_section(dsl_path, dsl_text, "Start")
    build_payload_section = dify_node_section(dsl_path, dsl_text, "Build per-call payload")
    health_section = dify_node_section(dsl_path, dsl_text, "Check API connectivity")
    gate_section = dify_node_section(dsl_path, dsl_text, "Gate live calls after API preflight")
    prepare_poll_section = dify_node_section(dsl_path, dsl_text, "Prepare poll context")
    poll_http_section = dify_node_section(dsl_path, dsl_text, "Poll CALL-E call status")
    poll_section = dify_node_section(dsl_path, dsl_text, "Evaluate poll state")
    parse_result_section = dify_node_section(dsl_path, dsl_text, "Parse final call result")
    summary_section = dify_node_section(dsl_path, dsl_text, "Summarize iteration results")
    create_http_section = dify_node_section(dsl_path, dsl_text, "Create CALL-E call")
    extract_section = dify_node_section(dsl_path, dsl_text, "Extract call lookup id")
    extract_node_section = extract_section
    iteration_section = dify_node_section(dsl_path, dsl_text, "Run one-shot call")
    nodes_index = dsl_text.find("nodes:")
    if nodes_index == -1:
        fail(f"Missing Dify workflow nodes in {dsl_path.relative_to(ROOT)}.")
    nodes_section = dsl_text[nodes_index:]

    mirrored_phone_patterns = [
        'PHONE_IN_TEXT_RE = re.compile(r"\\+[1-9]\\d{6,14}")',
        'INTERNATIONAL_GROUPED_PHONE_RE = re.compile(r"(?<!\\w)\\+[1-9](?:[\\s().-]*\\d){6,14}(?![\\s().-]*\\d)")',
        'PHONE_LIKE_RE = re.compile(r"(?<!\\d)(?:\\+?1[\\s.-]?)?(?:\\(?[2-9]\\d{2}\\)?[\\s.-]?[2-9]\\d{2}[\\s.-]?\\d{4}|[1-9]\\d{6,14})(?!\\d)")',
    ]
    for pattern in mirrored_phone_patterns:
        if dsl_text.count(pattern) != 5:
            fail(f"Dify template must keep all five phone redactors aligned: {pattern}")
    grouped_phone_re = re.compile(r"(?<!\w)\+[1-9](?:[\s().-]*\d){6,14}(?![\s().-]*\d)")
    if not grouped_phone_re.search("Call +44 (20) 7123 4567 tomorrow."):
        fail("Dify grouped international redaction must match display numbers containing parentheses.")
    e164_re = re.compile(r"^\+[1-9]\d{6,14}$")
    if not e164_re.fullmatch("+1234567") or e164_re.fullmatch("+123456") or e164_re.fullmatch("+1234567890123456"):
        fail("Dify E.164 validation must accept 7-15 digits and reject shorter or longer values.")

    review_regressions = []
    if (
        "recipient_result_schema = {" not in build_payload_section
        or '"recipient_result_schema": recipient_result_schema' not in build_payload_section
        or '"recipient_result_schema": result_schema' in build_payload_section
    ):
        review_regressions.append(
            "Build per-call payload must use a separate recipient_result_schema instead of reusing result_schema."
        )
    else:
        recipient_schema_section = build_payload_section.split("recipient_result_schema = {", 1)[1].split(
            "request_payload = {", 1
        )[0]
        if '"summary"' in recipient_schema_section:
            review_regressions.append(
                "recipient_result_schema must not declare CALL-E's reserved summary response field."
            )

    loop_count_match = re.search(r"^\s*loop_count:\s*(\d+)\s*$", nodes_section, re.MULTILINE)
    loop_count = int(loop_count_match.group(1)) if loop_count_match else 0
    poll_loop_child_count = len(
        re.findall(r"^\s*parentId:\s*poll_until_terminal\s*$", nodes_section, re.MULTILINE)
    )
    total_node_count = len(re.findall(r"^\s{6}id:\s*[^\s]+\s*$", nodes_section, re.MULTILINE))
    non_poll_node_count = total_node_count - poll_loop_child_count
    if not loop_count_match or loop_count > 100:
        review_regressions.append("Poll until terminal must stay within Dify's default 100-loop limit.")
    if (
        not poll_loop_child_count
        or non_poll_node_count + loop_count * poll_loop_child_count > 500
    ):
        review_regressions.append(
            "Polling child-node executions must stay within Dify's default 500-step workflow limit."
        )
    polling_cadence_snippets = [
        "loop_count: 45",
        "id: wait_before_poll",
        "id: wait_before_poll_2",
        "id: wait_before_poll_3",
        "id: wait_before_poll_4",
        "id: wait_before_poll_5",
        "wait_before_poll-source-wait_before_poll_2-target",
        "wait_before_poll_2-source-wait_before_poll_3-target",
        "wait_before_poll_3-source-wait_before_poll_4-target",
        "wait_before_poll_4-source-wait_before_poll_5-target",
        "wait_before_poll_5-source-get_calle_call_result-target",
    ]
    if any(snippet not in dsl_text for snippet in polling_cadence_snippets):
        review_regressions.append(
            "Polling must use five serial four-second wait slices across 45 rounds."
        )
    if (
        dsl_text.count("seconds = seconds / 5.0") != 5
        or dsl_text.count("seconds = max(0.0, min(seconds, 4.0))") != 5
    ):
        review_regressions.append("Each polling wait slice must cap its sleep at four seconds.")

    if any(snippet in prepare_section for snippet in ['"region":', '"locale":']) or any(
        snippet in build_payload_section for snippet in ['"region":', '"locale":']
    ) or "Region/Locale:" in dsl_text:
        review_regressions.append(
            "The one-shot template must omit optional region and locale routing hints unless Start collects them."
        )

    cancellation_boundary_snippets = [
        "After `POST /v1/calls` succeeds, stopping the Dify execution stops only this workflow's polling; it does not cancel the outbound call.",
        "The CALL-E API used by this template does not provide a call-cancel action, so cancellation is available only before call creation.",
    ]
    if any(snippet not in read(readme_path) for snippet in cancellation_boundary_snippets):
        review_regressions.append(
            "Dify documentation must state the post-create cancellation boundary and lack of a call-cancel action."
        )

    metadata_round_trip_helper = "def compare_metadata_round_trip(call, metadata_sent_json) -> dict:"
    if any(metadata_round_trip_helper not in section for section in [poll_section, extract_section]):
        review_regressions.append(
            "Create and poll handlers must compare raw metadata before redacting stored response copies."
        )
    if "_dify_metadata_round_trip" not in parse_result_section:
        review_regressions.append(
            "Parse final call result must consume the safe raw-metadata comparison recorded upstream."
        )
    if "metadata_sent_raw.get(key) != metadata_returned_raw.get(key)" in parse_result_section:
        review_regressions.append(
            "Parse final call result must not compare raw sent metadata with an already-redacted response."
        )
    structured_result_snippets = [
        'recipient_structured_result = as_obj(recipient.get("structured_result"))',
        'call_structured_result = as_obj(call.get("structured_result"))',
        "structured_result = dict(recipient_structured_result)",
        "structured_result.update(call_structured_result)",
        '"summary": (call_structured_result or {}).get("summary")',
    ]
    if any(snippet not in parse_result_section for snippet in structured_result_snippets):
        review_regressions.append(
            "Parse final call result must preserve task-level structured fields when recipient results omit reserved fields."
        )
    for section_name, section, compare_call, redact_call in [
        (
            "Evaluate poll state",
            poll_section,
            "metadata_round_trip = compare_metadata_round_trip(call, metadata_sent_json)",
            "safe_call = redact_phone_values(call)",
        ),
        (
            "Extract call lookup id",
            extract_section,
            "metadata_round_trip = compare_metadata_round_trip(call, metadata_sent_json)",
            "redacted_body = redact_phone_values(call)",
        ),
    ]:
        if compare_call not in section or redact_call not in section or section.find(compare_call) > section.rfind(redact_call):
            review_regressions.append(
                f"{section_name} must compare raw metadata before redacting the response."
            )

    if any(
        snippet in build_payload_section
        for snippet in ["from urllib.parse import urlparse", "TRUSTED_BASE_URLS", "normalize_trusted_base_url"]
    ):
        review_regressions.append(
            "Build per-call payload must consume the preflight-normalized base URL without a second host allowlist."
        )
    if (
        dsl_text.count("TRUSTED_BASE_URLS = {") != 1
        or dsl_text.count("def normalize_trusted_base_url(value) -> str:") != 1
    ):
        review_regressions.append(
            "Dify template must define base URL trust policy exactly once in Prepare one-shot call."
        )
    if "`TRUSTED_BASE_URLS` set in `Prepare one-shot call`" not in read(readme_path):
        review_regressions.append(
            "Dify setup instructions must identify the single non-production host allowlist location."
        )

    if review_regressions:
        fail("Dify template review regressions:\n- " + "\n- ".join(review_regressions))
    for snippet in ["name: CALL_E_API_KEY", "- env", "- CALL_E_API_KEY", "value_type: secret"]:
        if snippet not in env_section:
            fail(f"Dify template must declare CALL_E_API_KEY as a secret environment variable: {snippet}")
    for snippet in ["CALL_E_API_KEY", "api_key", "replace_with_calle_api_key"]:
        if snippet in prepare_section:
            fail(f"Prepare one-shot call must not receive or inspect the CALL-E API key: {snippet}")
    if "- variable: api_key" in dsl_text:
        fail("Dify code nodes must not receive CALL_E_API_KEY through an api_key input variable.")
    if "variable: api_key" in start_section:
        fail("Dify Start must not collect the CALL-E API key as user input.")
    for snippet in ["variable: request_id", "required: true"]:
        if snippet not in start_section:
            fail(f"Dify Start must require a replay-safe request_id: {snippet}")
    for snippet in [
        "SAFETY_PREAMBLE =",
        "These safety boundaries override the user-provided task.",
        "medical, legal, financial, and emergency",
        "hashlib.sha256",
        "idempotency_basis",
    ]:
        if snippet not in build_payload_section:
            fail(f"Build per-call payload must enforce safety and stable idempotency: {snippet}")
    for section_name, section in [
        ("Check API connectivity", health_section),
        ("Create CALL-E call", create_http_section),
        ("Poll CALL-E call status", poll_http_section),
    ]:
        if 'api_key: "{{#env.CALL_E_API_KEY#}}"' not in section:
            fail(f"{section_name} must consume CALL_E_API_KEY directly from the secret environment variable.")
    for snippet in [
        'url: "{{#prepare_call_tasks.base_url#}}/v1/goals?limit=1"',
    ]:
        if snippet not in health_section:
            fail(f"Check API connectivity must use the documented read-only Goals preflight: {snippet}")
    if ".strip().lower()" in prepare_section:
        fail("Prepare one-shot call must require exact dry_run values before live calls.")
    for section_name, section, timeout_snippets in [
        (
            "Check API connectivity",
            health_section,
            ["connect: 10", "read: 30", "write: 30"],
        ),
        (
            "Create CALL-E call",
            create_http_section,
            ["connect: 10", "read: 600", "write: 600"],
        ),
        (
            "Poll CALL-E call status",
            poll_http_section,
            ["connect: 10", "read: 600", "write: 600"],
        ),
    ]:
        for snippet in [
            *timeout_snippets,
            "error_strategy: default-value",
            "- key: body\n          type: string\n          value: '{}'",
            "- key: status_code\n          type: number\n          value: 0",
            "retry_enabled: false",
            "max_retries: 0",
        ]:
            if snippet not in section:
                fail(f"{section_name} must route HTTP failures downstream without retries: {snippet}")
    for snippet in [
        "status_code = to_int(api_health_status_code)",
        "api_health_ok = 200 <= status_code < 300",
        "call_tasks = original_tasks if api_health_ok and not existing_error else []",
        "CALL-E GET /v1/goals?limit=1 returned HTTP",
    ]:
        if snippet not in gate_section:
            fail(f"Gate live calls after API preflight must block live calls on failed preflight checks: {snippet}")
    if not dify_variable_binding(gate_section, "validation_error", "prepare_call_tasks", "validation_error"):
        fail("Gate live calls after API preflight must receive the original validation_error.")
    if not dify_variable_binding(prepare_poll_section, "validation_error", "gate_live_calls_after_health", "validation_error"):
        fail("Prepare poll context must receive the preflight-gated validation_error.")
    for snippet in [
        "def main(latest_response, poll_status_code, poll_count, started_at_ms, wait_timeout_minutes, max_poll_count, metadata_sent_json, has_live_call) -> dict:",
        "call = documented_call_task(response_body)",
        "if 200 <= poll_status < 300 and not call:",
        "without a documented CallTask",
        "poll_status = int(as_number(poll_status_code, 0))",
        "if not (200 <= poll_status < 300):",
        "CALL-E poll request returned HTTP",
        "CALL-E poll request failed before a response was available.",
    ]:
        if snippet not in poll_section:
            fail(f"Evaluate poll state must handle non-2xx poll responses without waiting for timeout: {snippet}")
    for snippet in ["- gate_live_calls_after_health", "- call_tasks"]:
        if snippet not in iteration_section:
            fail(f"Run one-shot call must iterate over preflight-gated tasks: {snippet}")
    if "normalize_trusted_base_url" in poll_section:
        fail("Evaluate poll state must not carry unused base_url normalization.")
    for snippet in [
        "def main(create_response, create_status_code, base_url: str, metadata_sent_json: str, masked_phone: str, idempotency_key: str, call_item_id: str) -> dict:",
        "status_code = to_int(create_status_code)",
        "if status_code == 0:",
        "if not (200 <= status_code < 300):",
        "\"createFailed\": True",
        "CALL-E create request returned HTTP",
        "root = str(base_url or \"\").strip().rstrip(\"/\")",
    ]:
        if snippet not in extract_section:
            fail(f"Extract call lookup id must require a 2xx create response before polling and redact create errors: {snippet}")
    for snippet in [
        "def create_unknown_context(",
        "return create_unknown_context(",
        "\"createOutcomeUnknown\": True",
        "\"initialStatus\": \"create_outcome_unknown\"",
        "\"idempotencyKey\": idempotency_key",
        "The call may already have been created.",
        "Replay or reconcile only with the same Idempotency-Key",
    ]:
        if snippet not in extract_section:
            fail(f"Extract call lookup id must preserve ambiguous 2xx create outcomes: {snippet}")
    if not dify_variable_binding(extract_node_section, "idempotency_key", "build_iteration_payload", "idempotency_key"):
        fail("Extract call lookup id must receive the exact create-request idempotency key.")
    for snippet in [
        "if context.get(\"createOutcomeUnknown\"):",
        "\"ok\": None",
        "\"created\": None",
        "\"creation_state\": \"unknown_possibly_created\"",
        "\"required\": True",
        "\"idempotencyKey\": idempotency_key",
        "\"next_action\": \"manual_review\"",
    ]:
        if snippet not in parse_result_section:
            fail(f"Parse final call result must report an unknown, possibly-created outcome: {snippet}")
    for snippet in [
        "if status.get(\"ok\") is True:",
        "elif status.get(\"ok\") is False:",
        "creation_unknown += 1",
        "item[\"callStatus\"].get(\"created\") is True",
        "Live calls confirmed created:",
        "Call creation outcomes unknown (possibly created):",
        "None if creation_unknown else created_count",
        "IDEMPOTENCY_KEY_RE = re.compile(r\"^dify-[0-9a-f]{64}$\")",
        "safe_results = restore_reconciliation_keys(raw_results, redact_phone_values(raw_results))",
        "reconciliation_status_text(reconciliation)",
    ]:
        if snippet not in summary_section:
            fail(f"Summarize iteration results must preserve unknown create outcomes: {snippet}")
    if "raise ValueError(\"CALL-E create response did not include a recognized call id." in extract_section:
        fail("Extract call lookup id must return a masked unknown context instead of raising on missing call id.")
    if "call_payload_from_response" in dsl_text:
        fail("Dify CallTask handling must not accept legacy wrapper or call-id response shapes.")
    for snippet in ["from urllib.parse import urlparse", "TRUSTED_BASE_URLS", "normalize_trusted_base_url"]:
        if snippet in extract_section:
            fail(f"Extract call lookup id must not duplicate base URL allowlist checks after POST /v1/calls: {snippet}")
    require_text(
        manifest_path,
        [
            "CALL-E API key stored as the Dify secret environment variable CALL_E_API_KEY before execution.",
            "Blocks live-call creation when the documented API preflight returns a non-2xx status code.",
            "grouped international phone numbers",
            "display formats with parentheses",
            "unknown and possibly created",
            "same idempotency key",
            "indeterminate create transport and force-failed HTTP outcomes",
        ],
    )
    forbid_text(
        manifest_path,
        [
            "Start input",
        ],
    )
    manifest = json.loads(read(manifest_path))
    if manifest.get("template_version") != "0.6.1":
        fail("Dify manifest must retain template release version 0.6.1.")
    manifest_description = str(manifest.get("description") or "").lower()
    if "transcript" in manifest_description or "structured result" in manifest_description:
        fail("Dify manifest must not advertise data that the End node does not expose.")
    require_text(
        plugins_readme_path,
        [
            "resilient polling, and a masked status and summary report",
        ],
    )
    forbid_text(
        plugins_readme_path,
        [
            "masked outputs, polling, transcripts, summaries, and structured results",
        ],
    )

    prepare_main = embedded_python_main(dsl_path, prepare_section)
    invalid_request = prepare_main(
        "https://api.heycall-e.com",
        "true",
        "call-1",
        "+15555550124",
        "Place one authorized test call.",
    )
    if (
        invalid_request.get("call_tasks") != []
        or invalid_request.get("validation_error")
        != "request_id must be 8-120 characters using letters, numbers, dot, underscore, colon, or hyphen."
    ):
        fail("Dify request_id validation must return a normal validation response.")

    gate_main = embedded_python_main(dsl_path, gate_section)
    health_failure = gate_main(
        [{"callItemId": "call_001"}],
        1,
        "",
        "false",
        0,
    )
    if health_failure.get("call_tasks") != [] or not str(
        health_failure.get("validation_error") or ""
    ).startswith("CALL-E GET /v1/goals?limit=1 request failed"):
        fail("Dify API preflight transport failures must block call creation and reach the final report.")

    idempotency_key = "dify-" + "a" * 64
    extract_main = embedded_python_main(dsl_path, extract_section)
    create_unknown = extract_main(
        "{}",
        0,
        "https://api.heycall-e.com",
        "{}",
        "+15****24",
        idempotency_key,
        "call_001",
    )
    create_context = create_unknown.get("call_context", {})
    if (
        not create_context.get("createOutcomeUnknown")
        or create_context.get("idempotencyKey") != idempotency_key
    ):
        fail("Dify indeterminate create failures must preserve the original idempotency key.")

    legacy_create = extract_main(
        '{"call_id":"legacy_123","status":"completed"}',
        201,
        "https://api.heycall-e.com",
        "{}",
        "+15****24",
        idempotency_key,
        "call_001",
    )
    legacy_context = legacy_create.get("call_context", {})
    if not legacy_context.get("createOutcomeUnknown") or legacy_context.get("callId"):
        fail("Dify must treat a successful create response without a documented CallTask as unknown.")

    poll_main = embedded_python_main(dsl_path, poll_section)
    poll_failure = poll_main(
        {"data": {"status": "running"}},
        0,
        0,
        int(time.time() * 1000),
        15,
        45,
        "{}",
        True,
    )
    if not poll_failure.get("done") or not poll_failure.get("error_message"):
        fail("Dify poll transport failures must terminate polling with an error result.")

    invalid_poll_response = poll_main(
        {"callId": "legacy_123", "status": "completed"},
        200,
        0,
        int(time.time() * 1000),
        15,
        45,
        "{}",
        True,
    )
    if (
        not invalid_poll_response.get("done")
        or "documented CallTask" not in str(invalid_poll_response.get("error_message") or "")
    ):
        fail("Dify successful poll responses must require a documented CallTask before completion.")

    parse_main = embedded_python_main(dsl_path, parse_result_section)
    parsed_poll_failure = parse_main(
        {
            "callId": "call-test",
            "lookupUrl": "https://api.heycall-e.com/v1/calls/call-test",
            "initialCallJson": '{"data":{"id":"call-test","status":"running"}}',
            "createResponseJson": "{}",
            "metadataSentJson": "{}",
            "maskedPhone": "+15****24",
            "callItemId": "call_001",
        },
        poll_failure.get("latest_call_json"),
        poll_failure.get("poll_count"),
        poll_failure.get("timed_out"),
        poll_failure.get("error_message"),
    )
    parsed_status = parsed_poll_failure.get("result", {}).get("callStatus", {})
    if parsed_status.get("ok") is not False or parsed_status.get("failed") is not True:
        fail("Dify nested poll payloads with poll errors must be counted as failed results.")

    documented_create = extract_main(
        '{"object":"call_task","id":"call_test","status":"in_progress"}',
        201,
        "https://api.heycall-e.com",
        "{}",
        "+15****24",
        idempotency_key,
        "call_001",
    )
    invalid_poll = parse_main(
        documented_create.get("call_context", {}),
        '{"callId":"legacy_123","status":"completed"}',
        1,
        False,
        "",
    )
    invalid_poll_status = invalid_poll.get("result", {}).get("callStatus", {})
    if (
        invalid_poll_status.get("created") is not None
        or invalid_poll_status.get("creation_state") != "unknown_possibly_created"
    ):
        fail("Dify must not report an invalid 2xx poll response as a confirmed CallTask.")


def require_text_content(path: Path, text: str, snippets: list[str]) -> None:
    for snippet in snippets:
        if snippet not in text:
            fail(f"Missing required text in {path.relative_to(ROOT)}: {snippet}")


def require_text(path: Path, snippets: list[str]) -> None:
    require_text_content(path, read(path), snippets)


def forbid_text_content(path: Path, text: str, snippets: list[str]) -> None:
    for snippet in snippets:
        if snippet in text:
            fail(f"Forbidden text in {path.relative_to(ROOT)}: {snippet}")


def forbid_text(path: Path, snippets: list[str]) -> None:
    forbid_text_content(path, read(path), snippets)


def normalize_dify_code_scalars(path: Path, text: str) -> str:
    """Normalize Dify quoted exported code nodes into block scalars for validation."""
    pattern = re.compile(r'(?m)^(?P<indent>[ \t]*)code: "')
    normalized_parts: list[str] = []
    cursor = 0

    for match in pattern.finditer(text):
        if match.start() < cursor:
            continue
        index = match.end()
        while index < len(text):
            if text[index] == '"':
                slash_count = 0
                probe = index - 1
                while probe >= match.end() and text[probe] == "\\":
                    slash_count += 1
                    probe -= 1
                if slash_count % 2 == 0:
                    break
            index += 1
        else:
            fail(f"Unterminated quoted Dify code node in {path.relative_to(ROOT)}.")

        raw_code = text[match.end():index]
        json_code = re.sub(r"\\\n[ \t]*", "", raw_code).replace("\\ ", " ")
        try:
            code = json.loads(f'"{json_code}"')
        except json.JSONDecodeError as error:
            fail(f"Invalid quoted Dify code node in {path.relative_to(ROOT)}: {error}")

        indent = match.group("indent")
        normalized_parts.append(text[cursor:match.start()])
        normalized_parts.append(f"{indent}code: |\n")
        normalized_parts.extend(f"{indent}  {line}\n" for line in code.splitlines())
        cursor = index + 1
        if cursor < len(text) and text[cursor] == "\n":
            cursor += 1

    normalized_parts.append(text[cursor:])
    normalized_text = "".join(normalized_parts)
    return re.sub(r"'(\{\{#[^']+\}\}[^']*)'", r'"\1"', normalized_text)


def require_text_order(path: Path, earlier: str, later: str) -> None:
    text = read(path)
    earlier_index = text.find(earlier)
    later_index = text.find(later)
    if earlier_index == -1:
        fail(f"Missing required text in {path.relative_to(ROOT)}: {earlier}")
    if later_index == -1:
        fail(f"Missing required text in {path.relative_to(ROOT)}: {later}")
    if earlier_index > later_index:
        fail(
            f"Required text order is wrong in {path.relative_to(ROOT)}: "
            f"{earlier!r} must appear before {later!r}"
        )


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
    validate_outbound_source_families_in_readme(
        read(ROOT / "README.md"),
        read(skill_dir / "SKILL.md"),
    )
    for path in [
        ROOT / "README.md",
        ROOT / "docs" / "outbound-call-skill-creator" / "README.md",
        skill_dir / "SKILL.md",
        skill_dir / "references" / "data-sources.md",
        skill_dir / "references" / "examples.md",
        skill_dir / "references" / "interaction-flow.md",
        skill_dir / "references" / "output-targets.md",
    ]:
        forbid_text(path, ["ttmcp"])
    require_text(
        ROOT / "docs" / "outbound-call-skill-creator" / "README.md",
        [
            "ask the user for explicit permission before adding the hosted Notion MCP route",
            "explain that `codex mcp add` changes host MCP configuration",
            "ask the user for explicit permission before installing the Airtable plugin or adding the hosted Airtable MCP route",
            "explain that `codex plugin add` and `codex mcp add` change host configuration",
        ],
    )
    require_text(
        skill_dir / "SKILL.md",
        [
            "Creation-Time Source Onboarding",
            "references/interaction-flow.md",
            "Start with the user's workflow or data source",
            "user-facing language boundary",
            "Do not lead user prompts with internal terms",
            "Reusable workflow",
            "Preview before calling",
            "Call provider connection",
            "Checks before real calls",
            "source onboarding",
            "sampled fields",
            "Minimum source binding is mandatory.",
            "stop before writing the generated skill and ask for the missing contract details",
            "scope-first output rule",
            "If the installed `outbound-call-skill-creator` folder is inside a recognized user-level skills root",
            "Never write a generated business skill into the downloaded `outbound-call-skill-creator` skill folder itself.",
            "For any authenticated or connector-backed source family",
            "minimum connection details",
            "When the user names only an authenticated source family such as `google-form` or `tiktok-ads`, first use `references/interaction-flow.md` to recommend a likely workflow and provisional call goal.",
            "When a host-local source adapter, connector, MCP tool, or helper script is available, inspect it before asking the user to choose an access route.",
            "Do not ask the user to choose `use local OAuth to list accessible forms` when a local OAuth helper can be checked directly.",
            "Confirm only a provisional outbound call goal before source sampling.",
            "Confirm the final outbound goal contract only after representative sampling identifies the available goal input fields.",
            "Treat early result-output or writeback input as a preference, not as a verified target.",
            "Confirm the verified durable result-output target only after source access and representative sampling identify supported writeback paths, source-adjacent artifact options, or local CSV output.",
            "Finalize the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known.",
            "Provider onboarding failure permits only dry-run-only generation with an explicit blocker; it must not generate a skill that can place real calls.",
            "`tiktok-ads`: records obtained from TikTok Ads through exposed MCP tools, resources, or approved connectors.",
            "parameterized-bound",
            "approved-direct-execution",
            "Run repository validation only when the generated skill is being committed to a repository that provides a validation command.",
        ],
    )
    require_text(
        skill_dir / "references" / "data-sources.md",
        [
            "creation-time source onboarding",
            "The source contract must satisfy at least the `parameterized-bound` minimum",
            "Authenticated Source Onboarding",
            "For any authenticated or connector-backed source family, do not ask the user to manually provide the full field mapping before source access has been checked and a representative sample has been fetched.",
            "Collect only the minimum connection details needed to authorize or locate the source.",
            "When a safe source authorization or auth-readiness action is available, start it before asking the user for another confirmation.",
            "Do not ask the user to say `start auth`, choose a discovered route, or refresh a session before attempting the available non-mutating auth path.",
            "`codex mcp login tiktok-ads`",
            "Do not present a blank manual mapping form",
            "Ask the user to fill only fields that cannot be inferred from the sample.",
            "recommend a likely workflow and provisional call goal, then enter source access onboarding",
            "Do not ask for detailed field mapping, final goal-field selection, or result-output mapping before the access check and sample fetch have been attempted.",
            "Proactively inspect available host routes before asking the user for access details.",
            "Use the actual MCP-capable host or agent runtime selected by the user; do not assume Codex.",
            "Host-specific commands are adapter examples, not universal instructions.",
            "For Claude, Antigravity, Cursor, or another MCP-capable host, use that host's documented MCP server or connector setup and OAuth flow.",
            "`google-auth.mjs status`",
            "`google-local-api-client.mjs --action list-forms`",
            "`preflight-auth.mjs --repair-google`",
            "Only ask the user for a Form ID, account scope, Apps Script endpoint, MCP tool name, or managed connector route when no usable route can be discovered or authorization requires user completion.",
            "## TikTok Ads",
            "Use `tiktok-ads` when records come from TikTok Ads through exposed MCP tools, resources, or approved connectors.",
            "source family: `tiktok-ads`",
            "access method: MCP",
            "https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp",
            "codex mcp add tiktok-ads --url https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp",
            "codex mcp get tiktok-ads",
            "codex mcp list",
            "Treat Codex `Auth: Unsupported` as absence of Codex-managed OAuth, not as proof that source access is unavailable.",
            "If TikTok Ads MCP tools or resources are exposed, run the source-native read-only auth or inventory probe before declaring a blocker.",
            "`auth_advertiser_get`",
            "For `tiktok-ads`, inspect exposed MCP tools and resources first.",
            "fetch a small representative sample",
            "default outbound goal contract",
            "Do not ask for Google Form field mapping before Google access has been verified and a representative response sample has been fetched.",
            "Do not ask for TikTok Ads field mapping before the exact MCP tool or resource access has been verified and a representative record sample has been fetched.",
            "Recommended Notion access route: hosted Notion MCP",
            "https://mcp.notion.com/mcp",
            "Codex adapter example for hosted Notion MCP",
            "codex mcp add notion --url https://mcp.notion.com/mcp",
            "codex mcp login notion",
            "ask the user for explicit permission before adding the hosted Notion MCP route",
            "Do not ask the user to create a Notion integration token before checking or offering hosted Notion MCP.",
            "Do not mark Notion source writeback ready until hosted Notion MCP or another authenticated Notion route exposes page update capability",
            "Recommended Airtable access route: hosted Airtable MCP",
            "https://mcp.airtable.com/mcp",
            "Codex adapter example for hosted Airtable MCP",
            "codex plugin add airtable@openai-curated",
            "codex mcp add airtable --url https://mcp.airtable.com/mcp",
            "codex mcp login airtable",
            "ask the user for explicit permission before installing the Airtable plugin or adding the hosted Airtable MCP route",
            "Do not ask the user to create an Airtable personal access token before checking or offering hosted Airtable MCP.",
            "Do not mark Airtable source writeback ready until hosted Airtable MCP or another authenticated Airtable route exposes non-destructive record update capability",
            "For local CSV workflows, capture supported result-output target modes at creation time and choose the concrete target mode during the runtime dry-run or approval step.",
            "source-csv-in-place",
            "result-csv-file",
            "source-adjacent-result-artifact",
            "Do not require a per-row consent column when the user confirms the CSV source only contains records collected from people who requested or agreed to phone follow-up.",
            "Use the existing `google-form-callback` local OAuth and export scripts as the preferred reference pattern when available.",
        ],
    )
    require_text(
        skill_dir / "references" / "examples.md",
        [
            "## Source-Family-Only Authenticated Onboarding Prompt",
            "If the user replies only `google-form`, recommend the likely workflow and provisional call goal before asking for source access details.",
            "The same pattern applies when the user replies only `tiktok-ads`",
            "Recommended provisional goal: call the respondent, confirm their request, ask one follow-up question, and summarize the outcome.",
            "Next I will check whether this host already exposes Google Forms access.",
            "If local OAuth is available, I will run its auth check and list accessible forms before asking you for a Form ID.",
            "## TikTok Ads Lead Follow-Up Skill",
            "If the selected host is Codex and this host has no TikTok Ads MCP server configured, I will ask whether to add the default route before running `codex mcp add`",
            "- source family: `tiktok-ads`",
            "I will first identify the current or target MCP-capable host and use that host's documented connector or MCP setup.",
            "For Notion, I will recommend hosted Notion MCP first because it uses OAuth and avoids user-managed integration tokens.",
            "If the selected host is Codex and no existing `notion` MCP route points to hosted Notion MCP, I will ask whether to add it before running `codex mcp add notion`",
            "For Airtable, I will recommend hosted Airtable MCP first because it uses OAuth and avoids user-managed personal access tokens.",
            "If the selected host is Codex and neither the Airtable plugin nor a hosted Airtable MCP route is configured, I will ask whether to install the plugin or add the route before running `codex plugin add` or `codex mcp add airtable`",
            "If the selected host is Codex",
            "source-adjacent result artifact",
        ],
    )
    require_text(
        skill_dir / "references" / "interaction-flow.md",
        [
            "Ask for only the next missing piece of information needed to continue.",
            "If the user provides several values at once, record all of them and continue from the first missing value.",
            "Do not ask for skill name, output target, binding level, execution mode, full field mapping, or writeback behavior before workflow, source family, and call goal are established",
            "Do not confirm writeback targets before source access and representative sampling have identified supported writeback paths.",
            "Record early writeback or result-output input as a preference only.",
            "Confirm the verified writeback or durable result-output target only after the source access check and representative sample identify supported paths.",
            "User-Facing Language Boundary",
            "Do not ask users to choose by internal terms",
            "Reusable workflow",
            "Fixed source workflow",
            "Preview before calling",
            "Call provider connection",
            "Checks before real calls",
            "Ask for either the business workflow or the data source.",
            "If only the data source is provided, recommend a likely business workflow and ask the user to confirm or adjust it.",
            "Use the recommended reusable workflow with preview-before-calling.",
            "Do not present unsupported binding levels or per-candidate approval modes.",
            "Do not list session-table output as a normal writeback option.",
            "Action needed",
        ],
    )
    require_text_order(
        skill_dir / "references" / "interaction-flow.md",
        "Continue with source access check and representative sample fetch.",
        "Confirm the writeback target",
    )
    require_text_order(
        skill_dir / "SKILL.md",
        "Read `references/data-sources.md` for the selected source family and run creation-time source onboarding",
        "Confirm the verified durable result-output target",
    )
    require_text_order(
        skill_dir / "SKILL.md",
        "Confirm the final outbound goal contract",
        "Finalize the selected execution mode",
    )
    require_text_order(
        skill_dir / "SKILL.md",
        "run creation-time provider onboarding",
        "Finalize the selected execution mode",
    )
    require_text(
        skill_dir / "references" / "mcp-provider-route.md",
        [
            "Creation-Time Provider Onboarding",
            "CALL-E MCP provider route",
            "Provider host runtime",
            "MCP route setup check result",
            "Codex adapter",
            "Claude, Antigravity, Cursor, or another MCP host adapter",
            "If no authenticated MCP route is available, stop and ask the user to connect or authorize it",
            "Provider onboarding must remain non-mutating for phone-call side effects.",
            "Provider onboarding failure permits only dry-run-only generation with an explicit blocker.",
            "Terminal seen is not terminal stable.",
            "full-history provider reconciliation",
            "keep the generated skill dry-run-only until the blocker is resolved",
        ],
    )
    require_text(
        skill_dir / "references" / "generated-skill-contract.md",
        [
            "Source Onboarding Contract",
            "Provider Onboarding Contract",
            "authentication or access check result",
            "access route",
            "user-confirmed field mapping",
            "Provider host runtime",
            "MCP route setup check result",
            "provider authentication or auth readiness check result",
            "Do not record provider onboarding as passed when readiness was only inferred from app connector tools",
            "compatible MCP provider tools",
            "Provider terminal instructions such as `report_result` or `do not start another call` apply only to the current provider run",
            "After execution approval, do not ask the user to continue, confirm the next candidate, or approve additional provider runs.",
            "Provider Result Finalization",
            "Terminal provider status is not result-output-ready until the generated skill performs a full-history provider reconciliation.",
            "Do not write `no_answer`, `failed`, or `no conversation captured` results until a negative terminal stability check passes.",
            "Result target mode may be fixed at creation time or selected from approved runtime parameters before execution approval.",
            "result target mode",
            "source-adjacent-result-artifact",
            "sample fetch result",
            "default goal contract derived from sampled fields",
            "Do not define the default goal from user prose alone before the representative sample is fetched.",
            "onboarding blocker",
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

## Binding Level and Runtime Parameters

Binding level: parameterized-bound. Runtime parameters include date window and
approved source instance identifiers allowed by the source contract.

## Source Contract

The source contract defines the approved data source and row ownership boundary.

## Source Onboarding

Source onboarding completed for this parameterized-bound workflow.
Access route: local source credentials.
Source access route discovery result: host-local route discovery completed before user route selection.
Authentication or access check result: passed with local source credentials.
Sample fetch result: passed with a representative source instance.
Sampled source instance: representative-callback-source.
Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.
User-confirmed field mapping: confirmed after the representative sample was shown.
Redaction policy for sample summaries: mask phone numbers and omit credentials.
Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.
Runtime parameters still allowed: date window and approved source instance identifiers.

## Candidate Fields

Candidate fields include candidate_id, name, phone_e164, timezone, and callback_reason.

## Outbound Goal Contract

The outbound goal contract defines the single-call goal and allowed conversation boundary.

## MCP Provider Route

Use the default MCP provider route: {OUTBOUND_MCP_ROUTE}

## Provider Onboarding

Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: Codex.
MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.
Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
One-off call capability: passed with the configured MCP route.
Provider onboarding blocker: none.

## Execution Modes

Execution mode: dry-run-then-batch-approval. Supported alternative is approved-direct-execution
when the binding level and runtime gate allow it.

## Runtime Gate

Runtime gate requirements include source access, required fields, consent, dedupe,
source writeback, source-adjacent artifact, or local result CSV readiness,
and provider route availability before real calls.

## Preflight and Creation Summary

Preflight and creation summary records completed source checks, blockers, runtime
parameters, and validation results before real calls.

## Serial Candidate Execution

After approval, serially process all ready candidates. For each candidate, plan,
inspect, run, check status when available, record the result, and continue to
the next candidate without another per-candidate confirmation. After all
candidates finish, write source results, a source-adjacent artifact, or a local
result CSV. Use a session table only as a last-resort attended fallback when
durable output is blocked.
Provider terminal instructions such as `report_result` or `do not start another call`
apply only to the current provider run. After execution approval, do not ask the
user to continue, confirm the next candidate, or approve additional provider runs.
Continue the approved batch until every approved candidate reaches a terminal
result or skip state unless a batch-level blocker appears.

## Provider Result Finalization

Provider result finalization runs before result output. Terminal provider status is
not result-output-ready until the generated skill performs a full-history provider
reconciliation without a cursor. Do not write `no_answer`, `failed`, or
`no conversation captured` results until a negative terminal stability check
passes.

## Result-Output Behavior

Result-output behavior records call status, timestamps, summaries, and masked phone numbers.
Prefer source writeback when verified. Use `source-adjacent-result-artifact`
when results should stay in the source system without mutating source records.
Otherwise use `result-csv-file` to write a new local result CSV. Use
session-table output only as a last-resort attended fallback when durable result
output is blocked.
Runtime result target mode: source-adjacent-result-artifact resolved before execution approval from fixed creation values or approved runtime parameters.

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

        wrapped_compatible_tools_md = valid_skill_md.replace(
            (
                "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                "are exposed by the configured MCP route for one-off calls."
            ),
            (
                "Compatible MCP provider tools: plan_call, run_call, and\n"
                "get_call_run are exposed by the configured MCP route for one-off calls."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            wrapped_compatible_tools_md,
            encoding="utf-8",
        )
        wrapped_compatible_tools_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if wrapped_compatible_tools_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow hard-wrapped "
                "compatible provider tools evidence: "
                + (
                    wrapped_compatible_tools_success.stderr
                    or wrapped_compatible_tools_success.stdout
                ).strip()
            )

        structured_result_output_md = valid_skill_md.replace(
            (
                "Runtime result target mode: source-adjacent-result-artifact resolved before execution "
                "approval from fixed creation values or approved runtime parameters."
            ),
            (
                "result_output:\n"
                "  policy: source-adjacent-result-artifact\n"
                "  target_mode: source-adjacent-result-artifact\n"
                "  target_binding: parameterized\n"
                "  target: approved runtime result artifact\n"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            structured_result_output_md,
            encoding="utf-8",
        )
        structured_result_output_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if structured_result_output_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow structured result-output target modes: "
                + (
                    structured_result_output_success.stderr
                    or structured_result_output_success.stdout
                ).strip()
            )

        runtime_parameter_result_output_md = valid_skill_md.replace(
            (
                "Runtime result target mode: source-adjacent-result-artifact resolved before execution "
                "approval from fixed creation values or approved runtime parameters."
            ),
            (
                "result_output:\n"
                "  policy: source-adjacent-result-artifact\n"
                "  target_mode: result_target_mode_parameter\n"
                "  target_binding: runtime_parameter\n"
                "  target: approved runtime result-output target\n"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            runtime_parameter_result_output_md,
            encoding="utf-8",
        )
        runtime_parameter_result_output_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if runtime_parameter_result_output_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow runtime-parameter result-output "
                "target modes: "
                + (
                    runtime_parameter_result_output_success.stderr
                    or runtime_parameter_result_output_success.stdout
                ).strip()
            )

        unknown_structured_result_output_md = valid_skill_md.replace(
            (
                "Runtime result target mode: source-adjacent-result-artifact resolved before execution "
                "approval from fixed creation values or approved runtime parameters."
            ),
            (
                "result_output:\n"
                "  policy: source-adjacent-result-artifact\n"
                "  target_mode: totally-unknown-mode\n"
                "  target_binding: parameterized\n"
                "  target: approved runtime result artifact\n"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            unknown_structured_result_output_md,
            encoding="utf-8",
        )
        unknown_structured_result_output_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unknown_structured_result_output_output = (
            unknown_structured_result_output_failure.stdout
            + unknown_structured_result_output_failure.stderr
        )
        if unknown_structured_result_output_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unknown structured target modes.")
        if (
            "Generated skill SKILL.md must include result target mode"
            not in unknown_structured_result_output_output
        ):
            fail("Generated outbound skill checker unknown-structured-target-mode message changed.")

        templated_structured_result_output_md = structured_result_output_md.replace(
            "  target_mode: source-adjacent-result-artifact\n",
            "  target_mode: source-csv-in-place | result-csv-file | source-writeback | session-table\n",
        )
        (skill_dir / "SKILL.md").write_text(
            templated_structured_result_output_md,
            encoding="utf-8",
        )
        templated_structured_result_output_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        templated_structured_result_output_output = (
            templated_structured_result_output_failure.stdout
            + templated_structured_result_output_failure.stderr
        )
        if templated_structured_result_output_failure.returncode == 0:
            fail("Generated outbound skill checker must reject templated target-mode option lists.")
        if (
            "Generated skill SKILL.md must include result target mode"
            not in templated_structured_result_output_output
        ):
            fail("Generated outbound skill checker templated-target-mode message changed.")

        unresolved_structured_result_output_md = structured_result_output_md.replace(
            "  target_mode: source-adjacent-result-artifact\n",
            "  target_mode: runtime\n",
        )
        (skill_dir / "SKILL.md").write_text(
            unresolved_structured_result_output_md,
            encoding="utf-8",
        )
        unresolved_structured_result_output_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unresolved_structured_result_output_output = (
            unresolved_structured_result_output_failure.stdout
            + unresolved_structured_result_output_failure.stderr
        )
        if unresolved_structured_result_output_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unresolved target-mode modifiers.")
        if (
            "Generated skill SKILL.md must include result target mode"
            not in unresolved_structured_result_output_output
        ):
            fail("Generated outbound skill checker unresolved-target-mode message changed.")

        valid_evidence_wording_cases = [
            (
                "required redaction policy wording",
                valid_skill_md.replace(
                    "Redaction policy for sample summaries: mask phone numbers and omit credentials.",
                    (
                        "Redaction policy for sample summaries: phone-number masking "
                        "is required and credentials are omitted."
                    ),
                ),
            ),
            (
                "negative redaction policy wording",
                valid_skill_md.replace(
                    "Redaction policy for sample summaries: mask phone numbers and omit credentials.",
                    (
                        "Redaction policy for sample summaries: no raw phone numbers, "
                        "no credentials, and masked sample summaries."
                    ),
                ),
            ),
            (
                "no source authentication required wording",
                valid_skill_md.replace(
                    "Authentication or access check result: passed with local source credentials.",
                    (
                        "Authentication or access check result: passed; no authentication "
                        "required for local CSV."
                    ),
                ),
            ),
            (
                "no scoped source authentication required wording",
                valid_skill_md.replace(
                    "Authentication or access check result: passed with local source credentials.",
                    (
                        "Authentication or access check result: passed; no source "
                        "authentication required for local CSV."
                    ),
                ),
            ),
            (
                "no separate provider OAuth required wording",
                valid_skill_md.replace(
                    (
                        "Provider authentication check result: passed with `codex mcp list` "
                        "reporting OAuth for calle-prod."
                    ),
                    (
                        "Provider authentication check result: passed; no separate OAuth "
                        "required for the managed connector."
                    ),
                ),
            ),
            (
                "no scoped provider OAuth required wording",
                valid_skill_md.replace(
                    (
                        "Provider authentication check result: passed with `codex mcp list` "
                        "reporting OAuth for calle-prod."
                    ),
                    (
                        "Provider authentication check result: passed; no provider OAuth "
                        "required for the managed connector."
                    ),
                ),
            ),
            (
                "no scoped route setup required wording",
                valid_skill_md.replace(
                    "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.",
                    "MCP route setup check result: passed; no route setup required for the managed connector.",
                ),
            ),
            (
                "provider OAuth not required wording",
                valid_skill_md.replace(
                    (
                        "Provider authentication check result: passed with `codex mcp list` "
                        "reporting OAuth for calle-prod."
                    ),
                    (
                        "Provider authentication check result: passed; OAuth is not "
                        "required for this host connector."
                    ),
                ),
            ),
            (
                "no need for source OAuth wording",
                valid_skill_md.replace(
                    "Authentication or access check result: passed with local source credentials.",
                    "Authentication or access check result: passed; no need for OAuth for local CSV.",
                ),
            ),
            (
                "required compatible tools wording",
                valid_skill_md.replace(
                    (
                        "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                        "are exposed by the configured MCP route for one-off calls."
                    ),
                    (
                        "Compatible MCP provider tools: required tools plan_call, run_call, "
                        "and get_call_run are exposed by the configured MCP route for one-off calls."
                    ),
                ),
            ),
            (
                "no-extra-tools compatible tools wording",
                valid_skill_md.replace(
                    (
                        "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                        "are exposed by the configured MCP route for one-off calls."
                    ),
                    (
                        "Compatible MCP provider tools: no extra tools needed; "
                        "plan_call, run_call, and get_call_run are exposed by the configured "
                        "MCP route for one-off calls."
                    ),
                ),
            ),
            (
                "namespaced compatible tools wording",
                valid_skill_md.replace(
                    (
                        "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                        "are exposed by the configured MCP route for one-off calls."
                    ),
                    (
                        "Compatible MCP provider tools: `mcp__calle_prod__plan_call`, "
                        "`mcp__calle_prod__run_call`, and "
                        "`mcp__calle_prod__get_call_run` are exposed by the "
                        "configured MCP route for one-off calls."
                    ),
                ),
            ),
            (
                "pending source name wording",
                valid_skill_md.replace(
                    "Authentication or access check result: passed with local source credentials.",
                    (
                        "Authentication or access check result: passed with access to "
                        "`Pending Callbacks` Airtable table."
                    ),
                ).replace(
                    "Sampled source instance: representative-callback-source.",
                    "Sampled source instance: pending-callbacks.",
                ),
            ),
            (
                "blocked source name wording",
                valid_skill_md.replace(
                    "Sampled source instance: representative-callback-source.",
                    "Sampled source instance: blocked-leads-view.",
                ).replace(
                    "Source access route discovery result: host-local route discovery completed before user route selection.",
                    (
                        "Source access route discovery result: discovered "
                        "`Blocked Leads` managed connector view."
                    ),
                ),
            ),
            (
                "needs source name wording",
                valid_skill_md.replace(
                    "Authentication or access check result: passed with local source credentials.",
                    (
                        "Authentication or access check result: passed with access to "
                        "`Needs Outreach` CRM view."
                    ),
                ),
            ),
            (
                "requires source name wording",
                valid_skill_md.replace(
                    "Authentication or access check result: passed with local source credentials.",
                    (
                        "Authentication or access check result: passed with access to "
                        "`Requires Follow-up` Airtable view."
                    ),
                ),
            ),
            (
                "no-change field mapping confirmation wording",
                valid_skill_md.replace(
                    "User-confirmed field mapping: confirmed after the representative sample was shown.",
                    "User-confirmed field mapping: no changes needed after sample review.",
                ),
            ),
            (
                "Codex App provider host runtime wording",
                valid_skill_md.replace(
                    "Provider host runtime: Codex.",
                    "Provider host runtime: Codex App.",
                ),
            ),
            (
                "Codex App Automation provider host runtime wording",
                valid_skill_md.replace(
                    "Provider host runtime: Codex.",
                    "Provider host runtime: Codex App Automation.",
                ),
            ),
        ]
        for case_name, skill_md in valid_evidence_wording_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            valid_evidence_wording_success = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            if valid_evidence_wording_success.returncode != 0:
                fail(
                    f"Generated outbound skill checker must allow {case_name}: "
                    + (
                        valid_evidence_wording_success.stderr
                        or valid_evidence_wording_success.stdout
                    ).strip()
                )

        blank_required_evidence_cases = [
            (
                "source access route",
                valid_skill_md.replace(
                    "Access route: local source credentials.\n",
                    "Access route:\n",
                ),
                "Bound generated skill SKILL.md must include source access route",
            ),
            (
                "sampled source instance",
                valid_skill_md.replace(
                    "Sampled source instance: representative-callback-source.\n",
                    "Sampled source instance:\n",
                ),
                "Bound generated skill SKILL.md must include sampled source instance",
            ),
            (
                "provider host runtime",
                valid_skill_md.replace(
                    "Provider host runtime: Codex.\n",
                    "Provider host runtime:\n",
                ),
                "Bound generated skill SKILL.md must include configured provider host runtime",
            ),
        ]
        for case_name, skill_md, expected_message in blank_required_evidence_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            blank_required_evidence_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            blank_required_evidence_output = (
                blank_required_evidence_failure.stdout
                + blank_required_evidence_failure.stderr
            )
            if blank_required_evidence_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject blank "
                    f"{case_name} evidence."
                )
            if expected_message not in blank_required_evidence_output:
                fail(
                    "Generated outbound skill checker blank "
                    f"{case_name} message changed."
                )

        temporal_execution_modes_md = valid_skill_md.replace(
            (
                "Execution mode: dry-run-then-batch-approval. Supported alternative is approved-direct-execution\n"
                "when the binding level and runtime gate allow it."
            ),
            (
                "Execution mode: dry-run-then-batch-approval.\n"
                "This workflow is dry-run-only until batch approval is granted.\n"
                "This workflow is not dry-run-only after the user approves the reviewed batch and runtime gate passes.\n"
                "Supported alternative is approved-direct-execution when the binding level and runtime gate allow it."
            ),
        )
        (skill_dir / "SKILL.md").write_text(temporal_execution_modes_md, encoding="utf-8")
        temporal_execution_modes_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if temporal_execution_modes_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow temporal dry-run approval wording: "
                + (
                    temporal_execution_modes_success.stderr
                    or temporal_execution_modes_success.stdout
                ).strip()
            )

        approval_only_execution_modes_md = valid_skill_md.replace(
            (
                "Execution mode: dry-run-then-batch-approval. Supported alternative is approved-direct-execution\n"
                "when the binding level and runtime gate allow it."
            ),
            (
                "Execution mode: dry-run-then-batch-approval.\n"
                "This workflow is dry-run-only until batch approval is granted.\n"
                "Supported alternative is approved-direct-execution when the binding level and runtime gate allow it."
            ),
        )
        blocked_onboarding_with_approval_only_md = approval_only_execution_modes_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            "Source onboarding recorded an onboarding blocker.",
        ).replace(
            "Authentication or access check result: passed with local source credentials.",
            "Authentication or access check result: not passed because source auth is blocked.",
        ).replace(
            "Sample fetch result: passed with a representative source instance.",
            "Sample fetch result: missing because source auth is blocked.",
        ).replace(
            "Sampled source instance: representative-callback-source.\n",
            "",
        ).replace(
            "Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.\n",
            "",
        ).replace(
            "User-confirmed field mapping: confirmed after the representative sample was shown.\n",
            "",
        ).replace(
            "Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.\n",
            "Onboarding blocker: source auth is blocked until credentials are refreshed.\n",
        ).replace(
            "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.",
            "MCP route setup check result: not ready because provider route setup is blocked.",
        ).replace(
            "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
            "Provider authentication check result: missing because provider auth is blocked.",
        ).replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.\n"
            "One-off call capability: passed with the configured MCP route.\n",
            "",
        ).replace(
            "Provider onboarding blocker: none.",
            "Provider onboarding blocker: provider auth is blocked until OAuth is completed.",
        )
        (skill_dir / "SKILL.md").write_text(
            blocked_onboarding_with_approval_only_md,
            encoding="utf-8",
        )
        blocked_onboarding_with_approval_only_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        blocked_onboarding_with_approval_only_output = (
            blocked_onboarding_with_approval_only_failure.stdout
            + blocked_onboarding_with_approval_only_failure.stderr
        )
        if blocked_onboarding_with_approval_only_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject blocked onboarding "
                "when dry-run-only text only describes batch approval."
            )
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in blocked_onboarding_with_approval_only_output
        ):
            fail(
                "Generated outbound skill checker approval-only blocker message changed."
            )

        ordinary_approval_flow_dry_run_only_lines = [
            "This workflow is dry-run-only until approval is complete.",
            "This workflow is dry-run-only until the reviewed candidate list is verified.",
            "This workflow is dry-run-only until the candidate preview is ready.",
            "This workflow is dry-run-only until approval is available.",
        ]
        for ordinary_approval_flow_line in ordinary_approval_flow_dry_run_only_lines:
            ordinary_approval_flow_blocker_md = blocked_onboarding_with_approval_only_md.replace(
                "This workflow is dry-run-only until batch approval is granted.",
                ordinary_approval_flow_line,
            )
            (skill_dir / "SKILL.md").write_text(
                ordinary_approval_flow_blocker_md,
                encoding="utf-8",
            )
            ordinary_approval_flow_blocker_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            ordinary_approval_flow_blocker_output = (
                ordinary_approval_flow_blocker_failure.stdout
                + ordinary_approval_flow_blocker_failure.stderr
            )
            if ordinary_approval_flow_blocker_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject blocked onboarding "
                    f"when dry-run-only text only says: {ordinary_approval_flow_line}"
                )
            if (
                "Bound generated skill SKILL.md must include passed authentication or access check result"
                not in ordinary_approval_flow_blocker_output
            ):
                fail(
                    "Generated outbound skill checker ordinary-approval blocker "
                    "message changed."
                )

        missing_one_off_capability_md = valid_skill_md.replace(
            "One-off call capability: passed with the configured MCP route.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(
            missing_one_off_capability_md,
            encoding="utf-8",
        )
        missing_one_off_capability_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_one_off_capability_output = (
            missing_one_off_capability_failure.stdout
            + missing_one_off_capability_failure.stderr
        )
        if missing_one_off_capability_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing one-off call capability.")
        if (
            "Bound generated skill SKILL.md must include one-off call capability"
            not in missing_one_off_capability_output
        ):
            fail("Generated outbound skill checker missing-one-off-capability message changed.")

        unavailable_one_off_capability_md = valid_skill_md.replace(
            "One-off call capability: passed with the configured MCP route.",
            "One-off call capability: missing because no run tool is exposed.",
        )
        (skill_dir / "SKILL.md").write_text(
            unavailable_one_off_capability_md,
            encoding="utf-8",
        )
        unavailable_one_off_capability_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unavailable_one_off_capability_output = (
            unavailable_one_off_capability_failure.stdout
            + unavailable_one_off_capability_failure.stderr
        )
        if unavailable_one_off_capability_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unavailable one-off call capability.")
        if (
            "Bound generated skill SKILL.md must include one-off call capability"
            not in unavailable_one_off_capability_output
        ):
            fail("Generated outbound skill checker unavailable-one-off-capability message changed.")

        inline_unavailable_one_off_capability_md = valid_skill_md.replace(
            "One-off call capability: passed with the configured MCP route.",
            "One-off call capability: passed with no run tool is exposed.",
        )
        (skill_dir / "SKILL.md").write_text(
            inline_unavailable_one_off_capability_md,
            encoding="utf-8",
        )
        inline_unavailable_one_off_capability_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        inline_unavailable_one_off_capability_output = (
            inline_unavailable_one_off_capability_failure.stdout
            + inline_unavailable_one_off_capability_failure.stderr
        )
        if inline_unavailable_one_off_capability_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject inline unavailable one-off call capability."
            )
        if (
            "Generated skill SKILL.md has contradictory one-off call capability line"
            not in inline_unavailable_one_off_capability_output
        ):
            fail(
                "Generated outbound skill checker inline-unavailable-one-off-capability message changed."
            )

        noun_unavailable_one_off_capability_md = valid_skill_md.replace(
            "One-off call capability: passed with the configured MCP route.",
            "One-off call capability: passed with run tool not available.",
        )
        (skill_dir / "SKILL.md").write_text(
            noun_unavailable_one_off_capability_md,
            encoding="utf-8",
        )
        noun_unavailable_one_off_capability_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        noun_unavailable_one_off_capability_output = (
            noun_unavailable_one_off_capability_failure.stdout
            + noun_unavailable_one_off_capability_failure.stderr
        )
        if noun_unavailable_one_off_capability_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject noun-form unavailable "
                "one-off call capability."
            )
        if (
            "Generated skill SKILL.md has contradictory one-off call capability line"
            not in noun_unavailable_one_off_capability_output
        ):
            fail(
                "Generated outbound skill checker noun-unavailable-one-off-capability "
                "message changed."
            )

        noun_unavailable_provider_auth_md = valid_skill_md.replace(
            (
                "Provider authentication check result: passed with `codex mcp list` "
                "reporting OAuth for calle-prod."
            ),
            "Provider authentication check result: passed with OAuth not configured.",
        )
        (skill_dir / "SKILL.md").write_text(
            noun_unavailable_provider_auth_md,
            encoding="utf-8",
        )
        noun_unavailable_provider_auth_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        noun_unavailable_provider_auth_output = (
            noun_unavailable_provider_auth_failure.stdout
            + noun_unavailable_provider_auth_failure.stderr
        )
        if noun_unavailable_provider_auth_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject noun-form unavailable "
                "provider authentication."
            )
        if (
            "Generated skill SKILL.md has contradictory passed provider authentication or auth readiness check result line"
            not in noun_unavailable_provider_auth_output
        ):
            fail(
                "Generated outbound skill checker noun-unavailable-provider-auth "
                "message changed."
            )

        post_pass_negative_status_cases = [
            (
                "route configured",
                valid_skill_md.replace(
                    "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.",
                    "MCP route setup check result: passed; no route configured.",
                ),
                "Generated skill SKILL.md has contradictory passed MCP route setup check result line",
            ),
            (
                "oauth configured",
                valid_skill_md.replace(
                    (
                        "Provider authentication check result: passed with `codex mcp list` "
                        "reporting OAuth for calle-prod."
                    ),
                    "Provider authentication check result: passed; no OAuth configured.",
                ),
                "Generated skill SKILL.md has contradictory passed provider authentication or auth readiness check result line",
            ),
            (
                "run tool exposed",
                valid_skill_md.replace(
                    "One-off call capability: passed with the configured MCP route.",
                    "One-off call capability: passed; no run tool is exposed.",
                ),
                "Generated skill SKILL.md has contradictory one-off call capability line",
            ),
        ]
        for case_name, skill_md, expected_error in post_pass_negative_status_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            post_pass_negative_status_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            post_pass_negative_status_output = (
                post_pass_negative_status_failure.stdout
                + post_pass_negative_status_failure.stderr
            )
            if post_pass_negative_status_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject post-pass "
                    f"negative {case_name} evidence."
                )
            if expected_error not in post_pass_negative_status_output:
                fail(
                    "Generated outbound skill checker post-pass negative "
                    f"{case_name} message changed."
                )

        negated_inferred_provider_readiness_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider readiness was not inferred; it was verified with the "
                "configured host MCP route.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            negated_inferred_provider_readiness_md,
            encoding="utf-8",
        )
        negated_inferred_provider_readiness_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if negated_inferred_provider_readiness_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow negated inferred provider "
                "readiness when host MCP route evidence is verified: "
                + (
                    negated_inferred_provider_readiness_success.stderr
                    or negated_inferred_provider_readiness_success.stdout
                ).strip()
            )

        blocked_app_connector_provider_md = valid_skill_md.replace(
            """Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: Codex.
MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.
Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
One-off call capability: passed with the configured MCP route.
Provider onboarding blocker: none.""",
            """Provider onboarding is blocked until the CALL-E MCP provider route is configured.
Provider host runtime: Codex.
MCP route setup check result: missing because only Codex Apps connector tools are available.
Provider authentication check result: missing because only Codex Apps connector tools are available.
Compatible MCP provider tools: missing because only Codex Apps connector tools are available.
One-off call capability: missing because the provider MCP route is unavailable.
Provider onboarding blocker: host only exposes Codex Apps connector tools; CALL-E MCP route is not configured.""",
        ).replace(
            "Execution mode: dry-run-then-batch-approval. Supported alternative is approved-direct-execution\n"
            "when the binding level and runtime gate allow it.",
            "Execution mode: dry-run-then-batch-approval. Supported alternative is approved-direct-execution\n"
            "when the binding level and runtime gate allow it.\n"
            "The workflow remains dry-run-only until provider onboarding is verified.",
        )
        (skill_dir / "SKILL.md").write_text(
            blocked_app_connector_provider_md,
            encoding="utf-8",
        )
        blocked_app_connector_provider_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if blocked_app_connector_provider_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow dry-run-only provider "
                "blockers that mention unavailable Codex Apps connector tools: "
                + (
                    blocked_app_connector_provider_success.stderr
                    or blocked_app_connector_provider_success.stdout
                ).strip()
            )

        blocked_app_connector_provider_label_only_md = blocked_app_connector_provider_md.replace(
            "Provider onboarding blocker: host only exposes Codex Apps connector tools; CALL-E MCP route is not configured.",
            "Provider onboarding blocker: host only exposes Codex Apps connector tools.",
        )
        (skill_dir / "SKILL.md").write_text(
            blocked_app_connector_provider_label_only_md,
            encoding="utf-8",
        )
        blocked_app_connector_provider_label_only_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if blocked_app_connector_provider_label_only_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow provider onboarding "
                "blocker labels that mention Codex Apps connector tools: "
                + (
                    blocked_app_connector_provider_label_only_success.stderr
                    or blocked_app_connector_provider_label_only_success.stdout
                ).strip()
            )

        blocked_app_connector_provider_structured_md = (
            blocked_app_connector_provider_label_only_md.replace(
                "Provider onboarding blocker: host only exposes Codex Apps connector tools.",
                "provider_onboarding_blocker: host only exposes Codex Apps connector tools.",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            blocked_app_connector_provider_structured_md,
            encoding="utf-8",
        )
        blocked_app_connector_provider_structured_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if blocked_app_connector_provider_structured_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow structured "
                "provider_onboarding_blocker labels that mention Codex Apps "
                "connector tools: "
                + (
                    blocked_app_connector_provider_structured_success.stderr
                    or blocked_app_connector_provider_structured_success.stdout
                ).strip()
            )

        blocked_app_connector_provider_bullet_md = blocked_app_connector_provider_md.replace(
            "Compatible MCP provider tools: missing because only Codex Apps connector tools are available.",
            "Compatible MCP provider tools:\n- missing because only Codex Apps connector tools are available.",
        )
        (skill_dir / "SKILL.md").write_text(
            blocked_app_connector_provider_bullet_md,
            encoding="utf-8",
        )
        blocked_app_connector_provider_bullet_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if blocked_app_connector_provider_bullet_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow dry-run-only provider "
                "blockers with nested missing app-connector tool bullets: "
                + (
                    blocked_app_connector_provider_bullet_success.stderr
                    or blocked_app_connector_provider_bullet_success.stdout
                ).strip()
            )

        unavailable_compatible_tools_md = valid_skill_md.replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
            "Compatible MCP provider tools: missing because no compatible MCP provider tools are exposed.",
        )
        (skill_dir / "SKILL.md").write_text(
            unavailable_compatible_tools_md,
            encoding="utf-8",
        )
        unavailable_compatible_tools_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unavailable_compatible_tools_output = (
            unavailable_compatible_tools_failure.stdout
            + unavailable_compatible_tools_failure.stderr
        )
        if unavailable_compatible_tools_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unavailable compatible MCP provider tools.")
        if (
            "Bound generated skill SKILL.md must include compatible MCP provider tools"
            not in unavailable_compatible_tools_output
        ):
            fail("Generated outbound skill checker unavailable-compatible-tools message changed.")

        no_compatible_tools_md = valid_skill_md.replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
            "Compatible MCP provider tools: no compatible provider tools are exposed.",
        )
        (skill_dir / "SKILL.md").write_text(
            no_compatible_tools_md,
            encoding="utf-8",
        )
        no_compatible_tools_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        no_compatible_tools_output = (
            no_compatible_tools_failure.stdout
            + no_compatible_tools_failure.stderr
        )
        if no_compatible_tools_failure.returncode == 0:
            fail("Generated outbound skill checker must reject absent compatible MCP provider tools.")
        if (
            "Bound generated skill SKILL.md must include compatible MCP provider tools"
            not in no_compatible_tools_output
        ):
            fail("Generated outbound skill checker no-compatible-tools message changed.")

        incomplete_compatible_tools_md = valid_skill_md.replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
            "Compatible MCP provider tools: plan_call and get_call_run are exposed; run_call unavailable.",
        )
        (skill_dir / "SKILL.md").write_text(
            incomplete_compatible_tools_md,
            encoding="utf-8",
        )
        incomplete_compatible_tools_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        incomplete_compatible_tools_output = (
            incomplete_compatible_tools_failure.stdout
            + incomplete_compatible_tools_failure.stderr
        )
        if incomplete_compatible_tools_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject incomplete compatible "
                "MCP provider tool evidence."
            )
        if (
            "Bound generated skill SKILL.md must include compatible MCP provider tools"
            not in incomplete_compatible_tools_output
        ):
            fail("Generated outbound skill checker incomplete-compatible-tools message changed.")

        app_connector_provider_evidence_cases = [
            (
                "app connector authorization",
                valid_skill_md.replace(
                    (
                        "Provider authentication check result: passed with `codex mcp list` "
                        "reporting OAuth for calle-prod."
                    ),
                    "Provider authentication check result: passed with app connector authorization ready.",
                ),
            ),
            (
                "app connector tools",
                valid_skill_md.replace(
                    (
                        "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                        "are exposed by the configured MCP route for one-off calls."
                    ),
                    (
                        "Compatible MCP provider tools: app connector tools plan_call, "
                        "run_call, and get_call_run are available."
                    ),
                ),
            ),
            (
                "plugin tools",
                valid_skill_md.replace(
                    (
                        "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                        "are exposed by the configured MCP route for one-off calls."
                    ),
                    (
                        "Compatible MCP provider tools: plugin tools plan_call, "
                        "run_call, and get_call_run are available."
                    ),
                ),
            ),
        ]
        for case_name, skill_md in app_connector_provider_evidence_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            app_connector_provider_evidence_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            app_connector_provider_evidence_output = (
                app_connector_provider_evidence_failure.stdout
                + app_connector_provider_evidence_failure.stderr
            )
            if app_connector_provider_evidence_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject generic "
                    f"{case_name} provider evidence."
                )
            if (
                "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
                not in app_connector_provider_evidence_output
            ):
                fail(
                    "Generated outbound skill checker generic app-connector "
                    f"{case_name} message changed."
                )

        explicit_provider_blocker_with_passed_ready_md = valid_skill_md.replace(
            "Execution mode: dry-run-then-batch-approval. Supported alternative is approved-direct-execution\n"
            "when the binding level and runtime gate allow it.",
            "Execution mode: approved-direct-execution. Runtime gate permits real calls only when onboarding is ready.",
        ).replace(
            "Provider onboarding blocker: none.",
            "Provider onboarding blocker: CALL-E MCP route auth is not ready.",
        )
        (skill_dir / "SKILL.md").write_text(
            explicit_provider_blocker_with_passed_ready_md,
            encoding="utf-8",
        )
        explicit_provider_blocker_with_passed_ready_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        explicit_provider_blocker_with_passed_ready_output = (
            explicit_provider_blocker_with_passed_ready_failure.stdout
            + explicit_provider_blocker_with_passed_ready_failure.stderr
        )
        if explicit_provider_blocker_with_passed_ready_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject explicit provider blockers "
                "when provider readiness markers still pass."
            )
        if (
            "Provider onboarding blocker conflicts with real-call-ready provider onboarding"
            not in explicit_provider_blocker_with_passed_ready_output
        ):
            fail(
                "Generated outbound skill checker explicit-provider-blocker message changed."
            )

        explicit_provider_none_then_blocker_md = (
            explicit_provider_blocker_with_passed_ready_md.replace(
                "Provider onboarding blocker: CALL-E MCP route auth is not ready.",
                "Provider onboarding blocker: none.\n"
                "Provider onboarding blocker: CALL-E MCP route auth is not ready.",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            explicit_provider_none_then_blocker_md,
            encoding="utf-8",
        )
        explicit_provider_none_then_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        explicit_provider_none_then_blocker_output = (
            explicit_provider_none_then_blocker_failure.stdout
            + explicit_provider_none_then_blocker_failure.stderr
        )
        if explicit_provider_none_then_blocker_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject a provider blocker "
                "appended after a default none blocker."
            )
        if (
            "Provider onboarding blocker conflicts with real-call-ready provider onboarding"
            not in explicit_provider_none_then_blocker_output
        ):
            fail(
                "Generated outbound skill checker none-then-provider-blocker "
                "message changed."
            )

        provider_contract_policy_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding contract: readiness was not inferred from app connector tools "
                "such as `mcp__codex_apps__call_e_zhiwen_dev._plan_call`; use configured host MCP route evidence only.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(provider_contract_policy_md, encoding="utf-8")
        provider_contract_policy_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if provider_contract_policy_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow provider contract policy prose: "
                + (
                    provider_contract_policy_success.stderr
                    or provider_contract_policy_success.stdout
                ).strip()
            )

        provider_contract_policy_then_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence; provider onboarding "
                "completed based on `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_then_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_then_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_then_bad_evidence_output = (
            provider_contract_policy_then_bad_evidence_failure.stdout
            + provider_contract_policy_then_bad_evidence_failure.stderr
        )
        if provider_contract_policy_then_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject provider app-tool evidence "
                "after a policy caveat in the same line."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_then_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-then-bad-evidence "
                "message changed."
            )

        provider_contract_policy_comma_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence, provider onboarding "
                "completed based on `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_comma_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_comma_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_comma_bad_evidence_output = (
            provider_contract_policy_comma_bad_evidence_failure.stdout
            + provider_contract_policy_comma_bad_evidence_failure.stderr
        )
        if provider_contract_policy_comma_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject provider app-tool evidence "
                "after a policy caveat joined with a comma."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_comma_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-comma-bad-evidence "
                "message changed."
            )

        provider_contract_policy_but_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence but provider onboarding "
                "completed based on `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_but_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_but_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_but_bad_evidence_output = (
            provider_contract_policy_but_bad_evidence_failure.stdout
            + provider_contract_policy_but_bad_evidence_failure.stderr
        )
        if provider_contract_policy_but_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject provider app-tool evidence "
                "after a policy caveat joined with but."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_but_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-but-bad-evidence "
                "message changed."
            )

        provider_contract_policy_and_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence and provider onboarding "
                "completed based on `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_and_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_and_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_and_bad_evidence_output = (
            provider_contract_policy_and_bad_evidence_failure.stdout
            + provider_contract_policy_and_bad_evidence_failure.stderr
        )
        if provider_contract_policy_and_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject provider app-tool evidence "
                "after a policy caveat joined with and."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_and_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-and-bad-evidence "
                "message changed."
            )

        provider_contract_policy_and_completed_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence and completed provider "
                "onboarding based on `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_and_completed_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_and_completed_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_and_completed_bad_evidence_output = (
            provider_contract_policy_and_completed_bad_evidence_failure.stdout
            + provider_contract_policy_and_completed_bad_evidence_failure.stderr
        )
        if provider_contract_policy_and_completed_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject completed provider "
                "onboarding based on app-tool evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_and_completed_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-and-completed-bad-evidence "
                "message changed."
            )

        provider_contract_policy_and_auth_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence and provider auth passed "
                "using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_and_auth_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_and_auth_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_and_auth_bad_evidence_output = (
            provider_contract_policy_and_auth_bad_evidence_failure.stdout
            + provider_contract_policy_and_auth_bad_evidence_failure.stderr
        )
        if provider_contract_policy_and_auth_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject provider auth app-tool "
                "evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_and_auth_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-and-auth-bad-evidence "
                "message changed."
            )

        provider_contract_policy_and_route_setup_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence and provider route setup "
                "passed using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_and_route_setup_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_and_route_setup_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_and_route_setup_bad_evidence_output = (
            provider_contract_policy_and_route_setup_bad_evidence_failure.stdout
            + provider_contract_policy_and_route_setup_bad_evidence_failure.stderr
        )
        if provider_contract_policy_and_route_setup_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject provider route setup "
                "app-tool evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_and_route_setup_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-and-route-setup-bad-evidence "
                "message changed."
            )

        provider_contract_policy_route_bad_evidence_cases = [
            (
                "provider route",
                "Do not use app connector tools as evidence and provider route "
                "passed using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.",
            ),
            (
                "MCP route",
                "Do not use app connector tools as evidence and MCP route passed "
                "using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.",
            ),
            (
                "bare route",
                "Do not use app connector tools as evidence and route passed "
                "using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.",
            ),
        ]
        for label, bad_evidence_line in provider_contract_policy_route_bad_evidence_cases:
            provider_contract_policy_route_bad_evidence_md = valid_skill_md.replace(
                "Provider onboarding blocker: none.\n\n## Execution Modes",
                (
                    "Provider onboarding blocker: none.\n\n"
                    "## Provider Onboarding Contract\n\n"
                    f"{bad_evidence_line}\n\n"
                    "## Execution Modes"
                ),
            )
            (skill_dir / "SKILL.md").write_text(
                provider_contract_policy_route_bad_evidence_md,
                encoding="utf-8",
            )
            provider_contract_policy_route_bad_evidence_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            provider_contract_policy_route_bad_evidence_output = (
                provider_contract_policy_route_bad_evidence_failure.stdout
                + provider_contract_policy_route_bad_evidence_failure.stderr
            )
            if provider_contract_policy_route_bad_evidence_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject "
                    f"{label} app-tool evidence after a policy caveat."
                )
            if (
                "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
                not in provider_contract_policy_route_bad_evidence_output
            ):
                fail(
                    "Generated outbound skill checker provider-policy-route-bad-evidence "
                    f"message changed for {label}."
                )

        provider_contract_policy_because_check_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence because the provider check "
                "passed using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_because_check_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_because_check_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_because_check_bad_evidence_output = (
            provider_contract_policy_because_check_bad_evidence_failure.stdout
            + provider_contract_policy_because_check_bad_evidence_failure.stderr
        )
        if provider_contract_policy_because_check_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject provider check app-tool "
                "evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_because_check_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-because-check-bad-evidence "
                "message changed."
            )

        provider_contract_policy_generic_check_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence and the check passed "
                "using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_generic_check_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_generic_check_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_generic_check_bad_evidence_output = (
            provider_contract_policy_generic_check_bad_evidence_failure.stdout
            + provider_contract_policy_generic_check_bad_evidence_failure.stderr
        )
        if provider_contract_policy_generic_check_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject generic check app-tool "
                "evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_generic_check_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-generic-check-bad-evidence "
                "message changed."
            )

        provider_contract_policy_while_auth_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence while auth passed "
                "using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_while_auth_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_while_auth_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_while_auth_bad_evidence_output = (
            provider_contract_policy_while_auth_bad_evidence_failure.stdout
            + provider_contract_policy_while_auth_bad_evidence_failure.stderr
        )
        if provider_contract_policy_while_auth_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject bare auth app-tool "
                "evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_while_auth_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-while-auth-bad-evidence "
                "message changed."
            )

        provider_contract_policy_and_call_provider_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Do not use app connector tools as evidence and call provider connection "
                "passed using `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_and_call_provider_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_and_call_provider_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_and_call_provider_bad_evidence_output = (
            provider_contract_policy_and_call_provider_bad_evidence_failure.stdout
            + provider_contract_policy_and_call_provider_bad_evidence_failure.stderr
        )
        if provider_contract_policy_and_call_provider_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject call-provider app-tool "
                "evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_and_call_provider_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-call-provider-bad-evidence "
                "message changed."
            )

        provider_contract_policy_and_hyphenated_call_provider_bad_evidence_md = (
            valid_skill_md.replace(
                "Provider onboarding blocker: none.\n\n## Execution Modes",
                (
                    "Provider onboarding blocker: none.\n\n"
                    "## Provider Onboarding Contract\n\n"
                    "Do not use app connector tools as evidence and call-provider "
                    "connection passed using "
                    "`mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                    "## Execution Modes"
                ),
            )
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_policy_and_hyphenated_call_provider_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_policy_and_hyphenated_call_provider_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_policy_and_hyphenated_call_provider_bad_evidence_output = (
            provider_contract_policy_and_hyphenated_call_provider_bad_evidence_failure.stdout
            + provider_contract_policy_and_hyphenated_call_provider_bad_evidence_failure.stderr
        )
        if provider_contract_policy_and_hyphenated_call_provider_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject hyphenated "
                "call-provider app-tool evidence after a policy caveat."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_policy_and_hyphenated_call_provider_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-policy-hyphenated-call-provider-bad-evidence "
                "message changed."
            )

        codex_apps_provider_evidence_md = valid_skill_md.replace(
            (
                "MCP route setup check result: passed after `codex mcp list` "
                "confirmed the required route."
            ),
            "MCP route setup check result: passed based on Codex Apps CALL-E connector plan_call.",
        ).replace(
            (
                "Provider authentication check result: passed with `codex mcp list` "
                "reporting OAuth for calle-prod."
            ),
            "Provider authentication check result: passed via Codex Apps connector session.",
        )
        (skill_dir / "SKILL.md").write_text(
            codex_apps_provider_evidence_md,
            encoding="utf-8",
        )
        codex_apps_provider_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        codex_apps_provider_evidence_output = (
            codex_apps_provider_evidence_failure.stdout
            + codex_apps_provider_evidence_failure.stderr
        )
        if codex_apps_provider_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Codex Apps connector "
                "provider evidence."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in codex_apps_provider_evidence_output
        ):
            fail(
                "Generated outbound skill checker Codex-Apps provider evidence "
                "message changed."
            )

        wrapped_provider_contract_policy_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding contract: app connector tools such as "
                "`mcp__codex_apps__call_e_zhiwen_dev._plan_call`\n"
                "do not prove route readiness; use configured host MCP route evidence only.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            wrapped_provider_contract_policy_md,
            encoding="utf-8",
        )
        wrapped_provider_contract_policy_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if wrapped_provider_contract_policy_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow wrapped provider contract policy prose: "
                + (
                    wrapped_provider_contract_policy_success.stderr
                    or wrapped_provider_contract_policy_success.stdout
                ).strip()
            )

        preceding_wrapped_provider_contract_policy_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding contract: Do not treat app connector tools such as\n"
                "`mcp__codex_apps__call_e_zhiwen_dev._plan_call` as provider evidence; "
                "use configured host MCP route evidence only.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            preceding_wrapped_provider_contract_policy_md,
            encoding="utf-8",
        )
        preceding_wrapped_provider_contract_policy_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if preceding_wrapped_provider_contract_policy_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow provider policy prose "
                "when the app-tool mention wraps after the negated policy line: "
                + (
                    preceding_wrapped_provider_contract_policy_success.stderr
                    or preceding_wrapped_provider_contract_policy_success.stdout
                ).strip()
            )

        provider_contract_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding completed based on "
                "`mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_bad_evidence_md,
            encoding="utf-8",
        )
        provider_contract_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        provider_contract_bad_evidence_output = (
            provider_contract_bad_evidence_failure.stdout
            + provider_contract_bad_evidence_failure.stderr
        )
        if provider_contract_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject disallowed provider evidence "
                "inside a Provider Onboarding Contract section when Provider Onboarding also exists."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in provider_contract_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker provider-contract-bad-evidence message changed."
            )

        preceding_wrapped_provider_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding completed based on app connector tools such as\n"
                "`mcp__codex_apps__call_e_zhiwen_dev._plan_call` for route evidence.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            preceding_wrapped_provider_bad_evidence_md,
            encoding="utf-8",
        )
        preceding_wrapped_provider_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        preceding_wrapped_provider_bad_evidence_output = (
            preceding_wrapped_provider_bad_evidence_failure.stdout
            + preceding_wrapped_provider_bad_evidence_failure.stderr
        )
        if preceding_wrapped_provider_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject wrapped provider app-tool evidence "
                "when the previous line is not policy prose."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in preceding_wrapped_provider_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker wrapped provider bad-evidence message changed."
            )

        unrelated_not_wrapped_provider_bad_evidence_md = valid_skill_md.replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding was not configured from host evidence yet; app connector tools such as\n"
                "`mcp__codex_apps__call_e_zhiwen_dev._plan_call` were recorded for route evidence.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            unrelated_not_wrapped_provider_bad_evidence_md,
            encoding="utf-8",
        )
        unrelated_not_wrapped_provider_bad_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unrelated_not_wrapped_provider_bad_evidence_output = (
            unrelated_not_wrapped_provider_bad_evidence_failure.stdout
            + unrelated_not_wrapped_provider_bad_evidence_failure.stderr
        )
        if unrelated_not_wrapped_provider_bad_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject wrapped provider app-tool evidence "
                "when the previous-line negation is not provider policy prose."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in unrelated_not_wrapped_provider_bad_evidence_output
        ):
            fail(
                "Generated outbound skill checker unrelated-not provider bad-evidence message changed."
            )

        provider_contract_only_policy_md = valid_skill_md.replace(
            "## Provider Onboarding\n\n",
            "## Provider Onboarding Contract\n\n",
        ).replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n"
                "Provider onboarding contract: readiness was not inferred from app connector tools "
                "such as `mcp__codex_apps__call_e_zhiwen_dev._plan_call`; use configured host MCP route evidence only.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(provider_contract_only_policy_md, encoding="utf-8")
        provider_contract_only_policy_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if provider_contract_only_policy_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow provider contract-only policy prose: "
                + (
                    provider_contract_only_policy_success.stderr
                    or provider_contract_only_policy_success.stdout
                ).strip()
            )

        documented_onboarding_headings_md = valid_skill_md.replace(
            "## Source Onboarding\n\n",
            "## Source Onboarding Contract\n\n",
        ).replace(
            "## Provider Onboarding\n\n",
            "## Provider Onboarding Contract\n\n",
        )
        (skill_dir / "SKILL.md").write_text(
            documented_onboarding_headings_md,
            encoding="utf-8",
        )
        documented_onboarding_headings_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if documented_onboarding_headings_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow documented onboarding contract headings: "
                + (
                    documented_onboarding_headings_success.stderr
                    or documented_onboarding_headings_success.stdout
                ).strip()
            )

        documented_onboarding_headings_after_placeholders_md = valid_skill_md.replace(
            "## Source Onboarding\n\n",
            (
                "## Source Onboarding\n\n"
                "Authentication or access check result: pending placeholder.\n"
                "Sample fetch result: pending placeholder.\n\n"
                "## Source Onboarding Contract\n\n"
            ),
        ).replace(
            "## Provider Onboarding\n\n",
            (
                "## Provider Onboarding\n\n"
                "MCP route setup check result: pending placeholder.\n"
                "Provider authentication check result: pending placeholder.\n\n"
            ),
        ).replace(
            "Provider onboarding blocker: none.\n\n## Execution Modes",
            (
                "Provider onboarding blocker: none.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding contract: readiness was not inferred from app connector tools.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            documented_onboarding_headings_after_placeholders_md,
            encoding="utf-8",
        )
        documented_onboarding_headings_after_placeholders_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if documented_onboarding_headings_after_placeholders_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow documented onboarding contract sections after placeholders: "
                + (
                    documented_onboarding_headings_after_placeholders_success.stderr
                    or documented_onboarding_headings_after_placeholders_success.stdout
                ).strip()
            )

        provider_contract_after_placeholder_summary_md = valid_skill_md.replace(
            (
                "## Provider Onboarding\n\n"
                "Provider onboarding completed for the CALL-E MCP provider route.\n"
                "Provider host runtime: Codex.\n"
                "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.\n"
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.\n"
                "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.\n"
                "One-off call capability: passed with the configured MCP route.\n"
                "Provider onboarding blocker: none.\n\n"
                "## Execution Modes"
            ),
            (
                "## Provider Onboarding\n\n"
                "Provider onboarding summary: detailed host MCP evidence is recorded in the provider onboarding contract.\n"
                "MCP route setup check result: pending placeholder.\n"
                "Provider authentication check result: pending placeholder.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding completed for the CALL-E MCP provider route.\n"
                "Provider host runtime: Codex.\n"
                "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.\n"
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.\n"
                "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.\n"
                "One-off call capability: passed with the configured MCP route.\n"
                "Provider onboarding blocker: none.\n\n"
                "## Execution Modes"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            provider_contract_after_placeholder_summary_md,
            encoding="utf-8",
        )
        provider_contract_after_placeholder_summary_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if provider_contract_after_placeholder_summary_success.returncode != 0:
            fail(
                "Generated outbound skill checker must combine provider onboarding and contract sections: "
                + (
                    provider_contract_after_placeholder_summary_success.stderr
                    or provider_contract_after_placeholder_summary_success.stdout
                ).strip()
            )

        duplicate_provider_contract_heading_md = valid_skill_md.replace(
            (
                "## Provider Onboarding\n\n"
                "Provider onboarding completed for the CALL-E MCP provider route.\n"
                "Provider host runtime: Codex.\n"
                "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.\n"
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.\n"
                "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.\n"
                "One-off call capability: passed with the configured MCP route.\n"
                "Provider onboarding blocker: none.\n"
            ),
            (
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding summary: placeholder only.\n"
                "MCP route setup check result: pending placeholder.\n"
                "Provider authentication check result: pending placeholder.\n\n"
                "## Provider Onboarding Contract\n\n"
                "Provider onboarding completed for the CALL-E MCP provider route.\n"
                "Provider host runtime: Codex.\n"
                "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.\n"
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.\n"
                "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.\n"
                "One-off call capability: passed with the configured MCP route.\n"
                "Provider onboarding blocker: none.\n"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            duplicate_provider_contract_heading_md,
            encoding="utf-8",
        )
        duplicate_provider_contract_heading_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if duplicate_provider_contract_heading_success.returncode != 0:
            fail(
                "Generated outbound skill checker must combine duplicate provider contract sections: "
                + (
                    duplicate_provider_contract_heading_success.stderr
                    or duplicate_provider_contract_heading_success.stdout
                ).strip()
            )

        bulleted_selected_values_md = valid_skill_md.replace(
            "Binding level: parameterized-bound.",
            "- Binding level: parameterized-bound.",
        ).replace(
            "Execution mode: dry-run-then-batch-approval.",
            "- Execution mode: dry-run-then-batch-approval.",
        )
        (skill_dir / "SKILL.md").write_text(
            bulleted_selected_values_md,
            encoding="utf-8",
        )
        bulleted_selected_values_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if bulleted_selected_values_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow bulleted selected binding and execution lines: "
                + (
                    bulleted_selected_values_success.stderr
                    or bulleted_selected_values_success.stdout
                ).strip()
            )

        structured_contract_md = valid_skill_md.replace(
            """Source onboarding completed for this parameterized-bound workflow.
Access route: local source credentials.
Source access route discovery result: host-local route discovery completed before user route selection.
Authentication or access check result: passed with local source credentials.
Sample fetch result: passed with a representative source instance.
Sampled source instance: representative-callback-source.
Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.
User-confirmed field mapping: confirmed after the representative sample was shown.
Redaction policy for sample summaries: mask phone numbers and omit credentials.
Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.
Runtime parameters still allowed: date window and approved source instance identifiers.""",
            """source_onboarding_report:
  binding_level: parameterized-bound
  source_family: google-form
  access_method: local-oauth
  access_route: local source credentials
  source_access_route_discovery_result: host-local route discovery completed before user route selection
  auth_or_access_check: passed with local source credentials
  sample_fetch: passed with a representative source instance
  sampled_source_instance: representative-callback-source
  field_mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason
  user_confirmed_field_mapping: confirmed after the representative sample was shown
  redaction_policy_for_sample_summaries: mask phone numbers and omit credentials
  default_goal_source: call the respondent about callback_reason and summarize the result
  runtime_parameters_still_allowed: date window and approved source instance identifiers
  onboarding_blocker: none""",
        ).replace(
            """Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: Codex.
MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.
Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
One-off call capability: passed with the configured MCP route.
Provider onboarding blocker: none.""",
            """provider_onboarding_report:
  provider_route: https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
  provider_host_runtime: Codex
  mcp_route_setup_check: passed with `codex mcp get calle-prod` for the required route
  auth_readiness: passed with `codex mcp list` reporting OAuth for calle-prod
  compatible_tools: plan_call, run_call, and get_call_run
  one_off_call_capability: passed
  provider_onboarding_blocker: none""",
        )
        if "provider_onboarding_report:" not in structured_contract_md:
            fail("Generated outbound skill checker structured provider fixture must be substituted.")
        (skill_dir / "SKILL.md").write_text(structured_contract_md, encoding="utf-8")
        structured_contract_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if structured_contract_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow documented structured onboarding reports: "
                + (
                    structured_contract_success.stderr
                    or structured_contract_success.stdout
                ).strip()
            )

        structured_provider_tool_list_md = structured_contract_md.replace(
            "  compatible_tools: plan_call, run_call, and get_call_run",
            "  compatible_tools:\n"
            "    - plan_call\n"
            "    - run_call\n"
            "    - get_call_run",
        )
        (skill_dir / "SKILL.md").write_text(
            structured_provider_tool_list_md,
            encoding="utf-8",
        )
        structured_provider_tool_list_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if structured_provider_tool_list_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow structured provider "
                "compatible_tools YAML lists: "
                + (
                    structured_provider_tool_list_success.stderr
                    or structured_provider_tool_list_success.stdout
                ).strip()
            )

        structured_provider_punctuated_tool_list_md = structured_contract_md.replace(
            "  compatible_tools: plan_call, run_call, and get_call_run",
            "  compatible_tools:\n"
            "    - plan_call.\n"
            "    - run_call.\n"
            "    - get_call_run.",
        )
        (skill_dir / "SKILL.md").write_text(
            structured_provider_punctuated_tool_list_md,
            encoding="utf-8",
        )
        structured_provider_punctuated_tool_list_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if structured_provider_punctuated_tool_list_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow punctuated "
                "compatible_tools YAML lists: "
                + (
                    structured_provider_punctuated_tool_list_success.stderr
                    or structured_provider_punctuated_tool_list_success.stdout
                ).strip()
            )

        structured_missing_user_confirmed_md = structured_contract_md.replace(
            "  user_confirmed_field_mapping: confirmed after the representative sample was shown\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(
            structured_missing_user_confirmed_md,
            encoding="utf-8",
        )
        structured_missing_user_confirmed_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        structured_missing_user_confirmed_output = (
            structured_missing_user_confirmed_failure.stdout
            + structured_missing_user_confirmed_failure.stderr
        )
        if structured_missing_user_confirmed_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject structured reports without user-confirmed field mapping."
            )
        if (
            "Bound generated skill SKILL.md must include user-confirmed field mapping"
            not in structured_missing_user_confirmed_output
        ):
            fail(
                "Generated outbound skill checker structured missing-user-confirmed message changed."
            )

        structured_missing_selected_binding_md = structured_contract_md.replace(
            "Binding level: parameterized-bound.",
            "Maximum binding level: parameterized-bound.",
        )
        (skill_dir / "SKILL.md").write_text(
            structured_missing_selected_binding_md,
            encoding="utf-8",
        )
        structured_missing_selected_binding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        structured_missing_selected_binding_output = (
            structured_missing_selected_binding_failure.stdout
            + structured_missing_selected_binding_failure.stderr
        )
        if structured_missing_selected_binding_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must not use source report binding_level as the selected binding level."
            )
        if (
            "Generated skill SKILL.md must declare a selected binding level"
            not in structured_missing_selected_binding_output
        ):
            fail(
                "Generated outbound skill checker structured missing-selected-binding message changed."
            )

        other_agent_provider_onboarding_md = valid_skill_md.replace(
            """Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: Codex.
MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.
Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
One-off call capability: passed with the configured MCP route.
Provider onboarding blocker: none.""",
            """Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: example-agent.
MCP route setup check result: passed with example-agent MCP connector configured for the required route.
Provider authentication check result: passed with example-agent OAuth connection verified for the required route.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
One-off call capability: passed with the configured MCP route.
Provider onboarding blocker: none.""",
        )
        if "Provider host runtime: example-agent." not in other_agent_provider_onboarding_md:
            fail("Generated outbound skill checker non-Codex provider fixture must be substituted.")
        (skill_dir / "SKILL.md").write_text(
            other_agent_provider_onboarding_md,
            encoding="utf-8",
        )
        other_agent_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if other_agent_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow non-Codex MCP provider onboarding evidence: "
                + (other_agent_success.stderr or other_agent_success.stdout).strip()
            )

        notion_hosted_writeback_md = valid_skill_md.replace(
            "The source contract defines the approved data source and row ownership boundary.",
            "Source family: notion.\nThe source contract defines the approved data source and row ownership boundary.",
        ).replace(
            "Access route: local source credentials.",
            "Access route: hosted Notion MCP at https://mcp.notion.com/mcp.",
        ).replace(
            "Source access route discovery result: host-local route discovery completed before user route selection.",
            "Source access route discovery result: hosted Notion MCP OAuth route discovery completed.",
        ).replace(
            "Authentication or access check result: passed with local source credentials.",
            "Authentication or access check result: passed with hosted Notion MCP OAuth.",
        ).replace(
            "Sample fetch result: passed with a representative source instance.",
            "Sample fetch result: passed with hosted Notion MCP database records.",
        ).replace(
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Prefer source writeback when verified. Use `source-adjacent-result-artifact`\n"
            "when results should stay in the source system without mutating source records.\n"
            "Otherwise use `result-csv-file` to write a new local result CSV. Use\n"
            "session-table output only as a last-resort attended fallback when durable result\n"
            "output is blocked.\n"
            "Runtime result target mode: source-adjacent-result-artifact resolved before execution approval from fixed creation values or approved runtime parameters.",
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property update verified through hosted Notion MCP.\n"
            "Durable result output fallback: result-csv-file is available only if source writeback fails later; "
            "session-table output is a last-resort attended fallback.",
        )
        notion_hosted_unverified_writeback_md = notion_hosted_writeback_md.replace(
            "Target: Notion `result` page property update verified through hosted Notion MCP.",
            "Target: Notion `result` page property update configured through hosted Notion MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_hosted_unverified_writeback_md,
            encoding="utf-8",
        )
        notion_hosted_unverified_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_hosted_unverified_writeback_output = (
            notion_hosted_unverified_writeback_failure.stdout
            + notion_hosted_unverified_writeback_failure.stderr
        )
        if notion_hosted_unverified_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject hosted Notion "
                "source writeback without verified page-update evidence."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready without verified authenticated Notion writeback evidence"
            not in notion_hosted_unverified_writeback_output
        ):
            fail("Generated outbound skill checker Notion hosted-unverified message changed.")

        notion_hosted_split_writeback_md = notion_hosted_writeback_md.replace(
            "Target: Notion `result` page property update verified through hosted Notion MCP.",
            "Target: Notion `result` page property update verified.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_hosted_split_writeback_md,
            encoding="utf-8",
        )
        notion_hosted_split_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_hosted_split_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow hosted Notion source "
                "writeback when route and writeback evidence are split across "
                "documented fields: "
                + (
                    notion_hosted_split_writeback_success.stderr
                    or notion_hosted_split_writeback_success.stdout
                ).strip()
            )

        notion_hosted_confirmed_writeback_md = notion_hosted_writeback_md.replace(
            "Target: Notion `result` page property update verified through hosted Notion MCP.",
            "Target: Notion `result` page property update confirmed through hosted Notion MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_hosted_confirmed_writeback_md,
            encoding="utf-8",
        )
        notion_hosted_confirmed_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_hosted_confirmed_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow confirmed hosted Notion "
                "source writeback evidence: "
                + (
                    notion_hosted_confirmed_writeback_success.stderr
                    or notion_hosted_confirmed_writeback_success.stdout
                ).strip()
            )

        notion_hosted_documented_writeback_md = notion_hosted_writeback_md.replace(
            "Target: Notion `result` page property update verified through hosted Notion MCP.",
            "Target: Notion page update capability and canary writeback/readback passes through hosted Notion MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_hosted_documented_writeback_md,
            encoding="utf-8",
        )
        notion_hosted_documented_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_hosted_documented_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow documented hosted Notion "
                "page-update canary writeback/readback pass evidence: "
                + (
                    notion_hosted_documented_writeback_success.stderr
                    or notion_hosted_documented_writeback_success.stdout
                ).strip()
            )

        notion_hosted_policy_writeback_md = notion_hosted_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property update verified through hosted Notion MCP.\n",
            "Result output policy: source-writeback with page property update verified through hosted Notion MCP.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property update target.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_hosted_policy_writeback_md,
            encoding="utf-8",
        )
        notion_hosted_policy_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_hosted_policy_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow verified hosted "
                "Notion writeback evidence on result-output policy lines: "
                + (
                    notion_hosted_policy_writeback_success.stderr
                    or notion_hosted_policy_writeback_success.stdout
                ).strip()
            )

        notion_managed_connector_writeback_md = notion_hosted_writeback_md.replace(
            "Access route: hosted Notion MCP at https://mcp.notion.com/mcp.",
            "Access route: managed Notion connector route.",
        ).replace(
            "Source access route discovery result: hosted Notion MCP OAuth route discovery completed.",
            "Source access route discovery result: managed Notion connector route discovery completed.",
        ).replace(
            "Authentication or access check result: passed with hosted Notion MCP OAuth.",
            "Authentication or access check result: passed with managed Notion connector OAuth.",
        ).replace(
            "Sample fetch result: passed with hosted Notion MCP database records.",
            "Sample fetch result: passed with managed Notion connector records.",
        ).replace(
            "Target: Notion `result` page property update verified through hosted Notion MCP.",
            "Target: Notion `result` page property update verified through managed Notion connector writeback route.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_managed_connector_writeback_md,
            encoding="utf-8",
        )
        notion_managed_connector_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_managed_connector_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow verified managed Notion "
                "connector source writeback evidence: "
                + (
                    notion_managed_connector_writeback_success.stderr
                    or notion_managed_connector_writeback_success.stdout
                ).strip()
            )

        notion_integration_token_writeback_md = notion_hosted_writeback_md.replace(
            "Access route: hosted Notion MCP at https://mcp.notion.com/mcp.",
            "Access route: Notion API integration token (redacted).",
        ).replace(
            "Source access route discovery result: hosted Notion MCP OAuth route discovery completed.",
            "Source access route discovery result: Notion API integration token route checked.",
        ).replace(
            "Authentication or access check result: passed with hosted Notion MCP OAuth.",
            "Authentication or access check result: passed with Notion integration token (redacted).",
        ).replace(
            "Sample fetch result: passed with hosted Notion MCP database records.",
            "Sample fetch result: passed with Notion API records.",
        ).replace(
            "Target: Notion `result` page property update verified through hosted Notion MCP.",
            "Target: Notion `result` page property update verified through Notion integration token (redacted).",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_integration_token_writeback_md,
            encoding="utf-8",
        )
        notion_integration_token_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_integration_token_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow verified redacted "
                "Notion integration-token source writeback evidence: "
                + (
                    notion_integration_token_writeback_success.stderr
                    or notion_integration_token_writeback_success.stdout
                ).strip()
            )

        notion_option_template_result_output_md = notion_hosted_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property update verified through hosted Notion MCP.\n",
            "policy: source-writeback | source-adjacent-result-artifact | local-result-csv\n"
            "Result target mode: source-adjacent-result-artifact.\n"
            "Target: source-adjacent result artifact.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_option_template_result_output_md,
            encoding="utf-8",
        )
        notion_option_template_result_output_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_option_template_result_output_success.returncode != 0:
            fail(
                "Generated outbound skill checker must not treat result-output option "
                "templates as active source writeback declarations: "
                + (
                    notion_option_template_result_output_success.stderr
                    or notion_option_template_result_output_success.stdout
                ).strip()
            )

        notion_fenced_example_result_output_md = notion_hosted_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property update verified through hosted Notion MCP.\n",
            "```yaml\n"
            "result_output:\n"
            "  target_mode: source-writeback\n"
            "```\n"
            "Result target mode: source-adjacent-result-artifact.\n"
            "Target: source-adjacent result artifact.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_fenced_example_result_output_md,
            encoding="utf-8",
        )
        notion_fenced_example_result_output_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_fenced_example_result_output_success.returncode != 0:
            fail(
                "Generated outbound skill checker must not treat fenced "
                "result-output examples as active source writeback declarations: "
                + (
                    notion_fenced_example_result_output_success.stderr
                    or notion_fenced_example_result_output_success.stdout
                ).strip()
            )

        notion_hosted_negated_public_route_cases = [
            (
                "free-form negated public route note",
                notion_hosted_writeback_md.replace(
                    "Source onboarding completed for this parameterized-bound workflow.\n",
                    (
                        "Source onboarding completed for this parameterized-bound workflow.\n"
                        "Public shared-page route was not used.\n"
                    ),
                ),
            ),
            (
                "structured negated public route evidence",
                notion_hosted_writeback_md.replace(
                    "Access route: hosted Notion MCP at https://mcp.notion.com/mcp.",
                    (
                        "Access route: hosted Notion MCP at https://mcp.notion.com/mcp; "
                        "public shared-page route was not used."
                    ),
                ).replace(
                    "Source access route discovery result: hosted Notion MCP OAuth route discovery completed.",
                    (
                        "Source access route discovery result: hosted Notion MCP OAuth route discovery completed; "
                        "no public shared-page route selected."
                    ),
                ).replace(
                    "Authentication or access check result: passed with hosted Notion MCP OAuth.",
                    (
                        "Authentication or access check result: passed with hosted Notion MCP OAuth; "
                        "anonymous public shared-page access was not used."
                    ),
                ).replace(
                    "Sample fetch result: passed with hosted Notion MCP database records.",
                    (
                        "Sample fetch result: passed with hosted Notion MCP database records; "
                        "saveTransactions was not used."
                    ),
                ),
            ),
            (
                "hosted public OAuth route evidence",
                notion_hosted_writeback_md.replace(
                    "Access route: hosted Notion MCP at https://mcp.notion.com/mcp.",
                    "Access route: hosted Notion MCP public OAuth route at https://mcp.notion.com/mcp.",
                ).replace(
                    "Source access route discovery result: hosted Notion MCP OAuth route discovery completed.",
                    "Source access route discovery result: hosted Notion MCP public OAuth route discovery completed.",
                ),
            ),
        ]
        for case_name, skill_md in notion_hosted_negated_public_route_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            notion_hosted_negated_public_route_success = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            if notion_hosted_negated_public_route_success.returncode != 0:
                fail(
                    f"Generated outbound skill checker must allow hosted Notion writeback with {case_name}: "
                    + (
                        notion_hosted_negated_public_route_success.stderr
                        or notion_hosted_negated_public_route_success.stdout
                    ).strip()
                )

        airtable_read_only_writeback_md = valid_skill_md.replace(
            "The source contract defines the approved data source and row ownership boundary.",
            "Source family: airtable.\nThe source contract defines the approved data source and row ownership boundary.",
        ).replace(
            "Access route: local source credentials.",
            "Access route: read-only API sample export.",
        ).replace(
            "Source access route discovery result: host-local route discovery completed before user route selection.",
            "Source access route discovery result: read-only API sample export completed.",
        ).replace(
            "Authentication or access check result: passed with local source credentials.",
            "Authentication or access check result: passed with read-only API access.",
        ).replace(
            "Sample fetch result: passed with a representative source instance.",
            "Sample fetch result: passed with read-only records.",
        ).replace(
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Prefer source writeback when verified. Use `source-adjacent-result-artifact`\n"
            "when results should stay in the source system without mutating source records.\n"
            "Otherwise use `result-csv-file` to write a new local result CSV. Use\n"
            "session-table output only as a last-resort attended fallback when durable result\n"
            "output is blocked.\n"
            "Runtime result target mode: source-adjacent-result-artifact resolved before execution approval from fixed creation values or approved runtime parameters.",
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Airtable `result` field update from the sampled records.\n"
            "Durable result output fallback: result-csv-file is available until Airtable "
            "writeback is verified; session-table output remains last-resort only.",
        )
        airtable_hosted_unverified_writeback_md = valid_skill_md.replace(
            "The source contract defines the approved data source and row ownership boundary.",
            "Source family: airtable.\nThe source contract defines the approved data source and row ownership boundary.",
        ).replace(
            "Access route: local source credentials.",
            "Access route: hosted Airtable MCP.",
        ).replace(
            "Source access route discovery result: host-local route discovery completed before user route selection.",
            "Source access route discovery result: hosted Airtable MCP route discovery completed.",
        ).replace(
            "Authentication or access check result: passed with local source credentials.",
            "Authentication or access check result: passed with hosted Airtable MCP OAuth.",
        ).replace(
            "Sample fetch result: passed with a representative source instance.",
            "Sample fetch result: passed with hosted Airtable MCP records.",
        ).replace(
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Prefer source writeback when verified. Use `source-adjacent-result-artifact`\n"
            "when results should stay in the source system without mutating source records.\n"
            "Otherwise use `result-csv-file` to write a new local result CSV. Use\n"
            "session-table output only as a last-resort attended fallback when durable result\n"
            "output is blocked.\n"
            "Runtime result target mode: source-adjacent-result-artifact resolved before execution approval from fixed creation values or approved runtime parameters.",
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Airtable `result` field update configured through hosted Airtable MCP.\n"
            "Durable result output fallback: result-csv-file is available only if source writeback fails later.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_hosted_unverified_writeback_md,
            encoding="utf-8",
        )
        airtable_hosted_unverified_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_hosted_unverified_writeback_output = (
            airtable_hosted_unverified_writeback_failure.stdout
            + airtable_hosted_unverified_writeback_failure.stderr
        )
        if airtable_hosted_unverified_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject hosted Airtable "
                "source writeback without verified record-update evidence."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready without verified Airtable record-update evidence"
            not in airtable_hosted_unverified_writeback_output
        ):
            fail("Generated outbound skill checker Airtable hosted-unverified message changed.")

        (skill_dir / "SKILL.md").write_text(airtable_read_only_writeback_md, encoding="utf-8")
        airtable_read_only_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_writeback_output = (
            airtable_read_only_writeback_failure.stdout
            + airtable_read_only_writeback_failure.stderr
        )
        if airtable_read_only_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source writeback "
                "when onboarding used read-only Airtable access."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_writeback_output
        ):
            fail("Generated outbound skill checker Airtable read-only writeback message changed.")

        airtable_read_only_no_writeback_md = airtable_read_only_writeback_md.replace(
            "Access route: read-only API sample export.",
            "Access route: read-only API sample export; no writeback capability is available.",
        ).replace(
            "Source access route discovery result: read-only API sample export completed.",
            "Source access route discovery result: read-only API sample export completed; "
            "writeback unavailable.",
        ).replace(
            "Authentication or access check result: passed with read-only API access.",
            "Authentication or access check result: passed with read-only API access; "
            "no writeback capability is available.",
        ).replace(
            "Sample fetch result: passed with read-only records.",
            "Sample fetch result: passed with read-only records; no record update capability is available.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_no_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_no_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_no_writeback_output = (
            airtable_read_only_no_writeback_failure.stdout
            + airtable_read_only_no_writeback_failure.stderr
        )
        if airtable_read_only_no_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when read-only access explicitly says writeback is "
                "unavailable."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_no_writeback_output
        ):
            fail("Generated outbound skill checker Airtable no-writeback message changed.")

        airtable_read_only_unrelated_not_used_writeback_md = (
            airtable_read_only_writeback_md.replace(
                "Result target mode: source-writeback.",
                "Result target mode: source-writeback, session-table output is not used.",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_unrelated_not_used_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_unrelated_not_used_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_unrelated_not_used_writeback_output = (
            airtable_read_only_unrelated_not_used_writeback_failure.stdout
            + airtable_read_only_unrelated_not_used_writeback_failure.stderr
        )
        if airtable_read_only_unrelated_not_used_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback even when unrelated session-table output is not used."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_unrelated_not_used_writeback_output
        ):
            fail(
                "Generated outbound skill checker Airtable unrelated-not-used "
                "writeback message changed."
            )

        airtable_read_only_policy_only_writeback_md = airtable_read_only_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            "Source onboarding completed for this parameterized-bound workflow.\n"
            "Do not mark Airtable source writeback ready until hosted Airtable MCP "
            "record update is verified.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_policy_only_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_policy_only_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_policy_only_writeback_output = (
            airtable_read_only_policy_only_writeback_failure.stdout
            + airtable_read_only_policy_only_writeback_failure.stderr
        )
        if airtable_read_only_policy_only_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when read-only onboarding only documents a future "
                "writeback policy."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_policy_only_writeback_output
        ):
            fail("Generated outbound skill checker Airtable policy-only message changed.")

        airtable_read_only_required_writeback_md = airtable_read_only_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            "Source onboarding completed for this parameterized-bound workflow.\n"
            "Source writeback requires hosted Airtable MCP record update capability.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_required_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_required_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_required_writeback_output = (
            airtable_read_only_required_writeback_failure.stdout
            + airtable_read_only_required_writeback_failure.stderr
        )
        if airtable_read_only_required_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when onboarding only documents required future "
                "record-update capability."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_required_writeback_output
        ):
            fail("Generated outbound skill checker Airtable required-writeback message changed.")

        airtable_read_only_pending_writeback_md = airtable_read_only_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            "Source onboarding completed for this parameterized-bound workflow.\n"
            "Writeback is pending until verified through hosted Airtable MCP "
            "record update.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_pending_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_pending_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_pending_writeback_output = (
            airtable_read_only_pending_writeback_failure.stdout
            + airtable_read_only_pending_writeback_failure.stderr
        )
        if airtable_read_only_pending_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when writeback verification is only pending."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_pending_writeback_output
        ):
            fail("Generated outbound skill checker Airtable pending-writeback message changed.")

        airtable_read_only_configured_writeback_md = airtable_read_only_writeback_md.replace(
            "Source access route discovery result: read-only API sample export completed.",
            "Source access route discovery result: read-only API sample export completed; "
            "hosted Airtable MCP record update route configured.",
        ).replace(
            "Authentication or access check result: passed with read-only API access.",
            "Authentication or access check result: passed with read-only API access; "
            "hosted Airtable MCP record update access configured.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_configured_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_configured_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_configured_writeback_output = (
            airtable_read_only_configured_writeback_failure.stdout
            + airtable_read_only_configured_writeback_failure.stderr
        )
        if airtable_read_only_configured_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when update access is only configured."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_configured_writeback_output
        ):
            fail("Generated outbound skill checker Airtable configured-writeback message changed.")

        airtable_read_only_inline_configured_update_md = (
            airtable_read_only_writeback_md.replace(
                "Access route: read-only API sample export.",
                "Access route: read-only API sample export; record update route configured.",
            )
            .replace(
                "Source access route discovery result: read-only API sample export completed.",
                "Source access route discovery result: read-only API sample export completed; "
                "record update route configured.",
            )
            .replace(
                "Authentication or access check result: passed with read-only API access.",
                "Authentication or access check result: passed with read-only API access; "
                "record update access configured.",
            )
            .replace(
                "Sample fetch result: passed with read-only records.",
                "Sample fetch result: passed with read-only records; record update route configured.",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_inline_configured_update_md,
            encoding="utf-8",
        )
        airtable_read_only_inline_configured_update_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_inline_configured_update_output = (
            airtable_read_only_inline_configured_update_failure.stdout
            + airtable_read_only_inline_configured_update_failure.stderr
        )
        if airtable_read_only_inline_configured_update_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when read-only evidence only has configured update paths."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_inline_configured_update_output
        ):
            fail(
                "Generated outbound skill checker Airtable inline-configured-update "
                "message changed."
            )

        airtable_read_only_non_destructive_configured_md = (
            airtable_read_only_writeback_md.replace(
                "Sample fetch result: passed with read-only records.",
                (
                    "Sample fetch result: passed with read-only records and "
                    "non-destructive record update configured."
                ),
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_non_destructive_configured_md,
            encoding="utf-8",
        )
        airtable_read_only_non_destructive_configured_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_non_destructive_configured_output = (
            airtable_read_only_non_destructive_configured_failure.stdout
            + airtable_read_only_non_destructive_configured_failure.stderr
        )
        if airtable_read_only_non_destructive_configured_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when non-destructive update evidence is only configured."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_non_destructive_configured_output
        ):
            fail(
                "Generated outbound skill checker Airtable non-destructive-configured "
                "message changed."
            )

        airtable_read_only_required_update_md = airtable_read_only_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            (
                "Source onboarding completed for this parameterized-bound workflow.\n"
                "Source writeback requires verified hosted Airtable MCP record update access."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_required_update_md,
            encoding="utf-8",
        )
        airtable_read_only_required_update_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_required_update_output = (
            airtable_read_only_required_update_failure.stdout
            + airtable_read_only_required_update_failure.stderr
        )
        if airtable_read_only_required_update_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when onboarding only documents required future update access."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_required_update_output
        ):
            fail("Generated outbound skill checker Airtable required-update message changed.")

        airtable_read_only_readiness_criterion_md = airtable_read_only_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            (
                "Source onboarding completed for this parameterized-bound workflow.\n"
                "Readiness criterion: hosted Airtable MCP record update route "
                "verified before source-writeback."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_readiness_criterion_md,
            encoding="utf-8",
        )
        airtable_read_only_readiness_criterion_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_readiness_criterion_output = (
            airtable_read_only_readiness_criterion_failure.stdout
            + airtable_read_only_readiness_criterion_failure.stderr
        )
        if airtable_read_only_readiness_criterion_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when onboarding only documents a readiness criterion."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_readiness_criterion_output
        ):
            fail("Generated outbound skill checker Airtable readiness-criterion message changed.")

        airtable_read_only_requested_update_md = airtable_read_only_writeback_md.replace(
            "Authentication or access check result: passed with read-only API access.",
            (
                "Authentication or access check result: passed with read-only API access "
                "and record update access requested."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_requested_update_md,
            encoding="utf-8",
        )
        airtable_read_only_requested_update_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_requested_update_output = (
            airtable_read_only_requested_update_failure.stdout
            + airtable_read_only_requested_update_failure.stderr
        )
        if airtable_read_only_requested_update_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Airtable source "
                "writeback when update access is only requested."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_requested_update_output
        ):
            fail("Generated outbound skill checker Airtable requested-update message changed.")

        airtable_read_only_configured_and_verified_update_md = (
            airtable_read_only_writeback_md.replace(
                "Sample fetch result: passed with read-only records.",
                (
                    "Sample fetch result: passed with read-only records; hosted "
                    "Airtable MCP record update route configured and verified."
                ),
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_configured_and_verified_update_md,
            encoding="utf-8",
        )
        airtable_read_only_configured_and_verified_update_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if airtable_read_only_configured_and_verified_update_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow Airtable source writeback "
                "when configured update access is also verified: "
                + (
                    airtable_read_only_configured_and_verified_update_success.stderr
                    or airtable_read_only_configured_and_verified_update_success.stdout
                ).strip()
            )

        airtable_read_only_configured_and_passed_update_md = (
            airtable_read_only_writeback_md.replace(
                "Sample fetch result: passed with read-only records.",
                (
                    "Sample fetch result: passed with read-only records; hosted "
                    "Airtable MCP record update route configured and passed."
                ),
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_configured_and_passed_update_md,
            encoding="utf-8",
        )
        airtable_read_only_configured_and_passed_update_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if airtable_read_only_configured_and_passed_update_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow Airtable source writeback "
                "when configured update access also passed verification: "
                + (
                    airtable_read_only_configured_and_passed_update_success.stderr
                    or airtable_read_only_configured_and_passed_update_success.stdout
                ).strip()
            )

        airtable_read_only_with_update_writeback_md = airtable_read_only_writeback_md.replace(
            "Source access route discovery result: read-only API sample export completed.",
            "Source access route discovery result: read-only API sample export completed; "
            "hosted Airtable MCP record update route verified.",
        ).replace(
            "Authentication or access check result: passed with read-only API access.",
            "Authentication or access check result: passed with read-only API access; "
            "hosted Airtable MCP record update access verified.",
        ).replace(
            "Sample fetch result: passed with read-only records.",
            "Sample fetch result: passed with read-only records; canary writeback verified "
            "through hosted Airtable MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_with_update_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_with_update_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if airtable_read_only_with_update_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow Airtable source writeback "
                "when read-only sampling has separate verified update access: "
                + (
                    airtable_read_only_with_update_writeback_success.stderr
                    or airtable_read_only_with_update_writeback_success.stdout
                ).strip()
            )

        airtable_read_update_writeback_md = airtable_read_only_writeback_md.replace(
            "Access route: read-only API sample export.",
            "Access route: hosted Airtable MCP verified for read and update access.",
        ).replace(
            "Source access route discovery result: read-only API sample export completed.",
            "Source access route discovery result: hosted Airtable MCP read and update route discovery completed.",
        ).replace(
            "Authentication or access check result: passed with read-only API access.",
            "Authentication or access check result: passed with read access and record update access.",
        ).replace(
            "Sample fetch result: passed with read-only records.",
            "Sample fetch result: passed with Airtable records and record update capability verified.",
        )
        (skill_dir / "SKILL.md").write_text(airtable_read_update_writeback_md, encoding="utf-8")
        airtable_read_update_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if airtable_read_update_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow Airtable source writeback "
                "when read and record update access are verified: "
                + (
                    airtable_read_update_writeback_success.stderr
                    or airtable_read_update_writeback_success.stdout
                ).strip()
            )

        airtable_documented_canary_writeback_md = airtable_read_only_writeback_md.replace(
            "Access route: read-only API sample export.",
            "Access route: hosted Airtable MCP.",
        ).replace(
            "Source access route discovery result: read-only API sample export completed.",
            "Source access route discovery result: hosted Airtable MCP route discovery completed.",
        ).replace(
            "Authentication or access check result: passed with read-only API access.",
            "Authentication or access check result: passed with hosted Airtable MCP.",
        ).replace(
            "Sample fetch result: passed with read-only records.",
            "Sample fetch result: passed with Airtable records.",
        ).replace(
            "Target: Airtable `result` field update from the sampled records.",
            "Target: Airtable record update capability and canary writeback/readback passes through hosted Airtable MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_documented_canary_writeback_md,
            encoding="utf-8",
        )
        airtable_documented_canary_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if airtable_documented_canary_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow documented Airtable "
                "canary writeback/readback pass evidence: "
                + (
                    airtable_documented_canary_writeback_success.stderr
                    or airtable_documented_canary_writeback_success.stdout
                ).strip()
            )

        airtable_policy_verified_writeback_md = (
            airtable_read_update_writeback_md.replace(
                "Sample fetch result: passed with Airtable records and record update capability verified.",
                "Sample fetch result: passed with Airtable records.",
            ).replace(
                "Result output policy: source-writeback.\n"
                "Result target mode: source-writeback.\n"
                "Target: Airtable `result` field update from the sampled records.\n",
                "Result output policy: source-writeback with record update verified through hosted Airtable MCP.\n"
                "Result target mode: source-writeback.\n"
                "Target: Airtable `result` field update target.\n",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_policy_verified_writeback_md,
            encoding="utf-8",
        )
        airtable_policy_verified_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if airtable_policy_verified_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow verified Airtable "
                "writeback evidence on result-output policy lines: "
                + (
                    airtable_policy_verified_writeback_success.stderr
                    or airtable_policy_verified_writeback_success.stdout
                ).strip()
            )

        airtable_patch_writeback_md = airtable_read_only_writeback_md.replace(
            "Access route: read-only API sample export.",
            "Access route: Airtable Web API personal access token.",
        ).replace(
            "Source access route discovery result: read-only API sample export completed.",
            "Source access route discovery result: Airtable Web API route discovery completed.",
        ).replace(
            "Authentication or access check result: passed with read-only API access.",
            "Authentication or access check result: passed with Airtable Web API personal access token.",
        ).replace(
            "Sample fetch result: passed with read-only records.",
            "Sample fetch result: passed with Airtable records and PATCH writeback verified.",
        ).replace(
            "Target: Airtable `result` field update from the sampled records.",
            "Target: Airtable `result` field PATCH verified through Airtable Web API.",
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_patch_writeback_md,
            encoding="utf-8",
        )
        airtable_patch_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if airtable_patch_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow verified Airtable "
                "PATCH source writeback evidence: "
                + (
                    airtable_patch_writeback_success.stderr
                    or airtable_patch_writeback_success.stdout
                ).strip()
            )

        notion_public_writeback_md = valid_skill_md.replace(
            "The source contract defines the approved data source and row ownership boundary.",
            "Source family: notion.\nThe source contract defines the approved data source and row ownership boundary.",
        ).replace(
            "Access route: local source credentials.",
            "Access route: public Notion shared page data API.",
        ).replace(
            "Source access route discovery result: host-local route discovery completed before user route selection.",
            "Source access route discovery result: public shared-page read discovery completed.",
        ).replace(
            "Authentication or access check result: passed with local source credentials.",
            "Authentication or access check result: passed with anonymous public shared-page read access.",
        ).replace(
            "Sample fetch result: passed with a representative source instance.",
            "Sample fetch result: passed with public Notion shared-page record data.",
        ).replace(
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Prefer source writeback when verified. Use `source-adjacent-result-artifact`\n"
            "when results should stay in the source system without mutating source records.\n"
            "Otherwise use `result-csv-file` to write a new local result CSV. Use\n"
            "session-table output only as a last-resort attended fallback when durable result\n"
            "output is blocked.\n"
            "Runtime result target mode: source-adjacent-result-artifact resolved before execution approval from fixed creation values or approved runtime parameters.",
            "Result-output behavior records call status, timestamps, summaries, and masked phone numbers.\n"
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n"
            "Durable result output fallback: result-csv-file is available only if source writeback fails later; "
            "session-table output is a last-resort attended fallback.",
        )
        (skill_dir / "SKILL.md").write_text(notion_public_writeback_md, encoding="utf-8")
        notion_public_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_writeback_output = (
            notion_public_writeback_failure.stdout
            + notion_public_writeback_failure.stderr
        )
        if notion_public_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when onboarding used public shared-page access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_writeback_output
        ):
            fail("Generated outbound skill checker Notion public-writeback message changed.")

        notion_public_with_hosted_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data "
                "and canary writeback verified through hosted Notion MCP."
            ),
        ).replace(
            "Target: Notion `result` page property discovered through the public shared-page route.",
            "Target: Notion `result` page property update verified through hosted Notion MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_with_hosted_writeback_md,
            encoding="utf-8",
        )
        notion_public_with_hosted_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_public_with_hosted_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow public Notion sampling "
                "with hosted MCP writeback verification in the same evidence line: "
                + (
                    notion_public_with_hosted_writeback_success.stderr
                    or notion_public_with_hosted_writeback_success.stdout
                ).strip()
            )

        notion_public_page_metadata_writeback_md = notion_public_writeback_md.replace(
            "Access route: public Notion shared page data API.",
            "Access route: public Notion page metadata route.",
        ).replace(
            "Source access route discovery result: public shared-page read discovery completed.",
            "Source access route discovery result: public page metadata discovery completed.",
        ).replace(
            "Authentication or access check result: passed with anonymous public shared-page read access.",
            "Authentication or access check result: passed with public page metadata access.",
        ).replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            "Sample fetch result: passed with public page metadata.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_page_metadata_writeback_md,
            encoding="utf-8",
        )
        notion_public_page_metadata_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_page_metadata_writeback_output = (
            notion_public_page_metadata_writeback_failure.stdout
            + notion_public_page_metadata_writeback_failure.stderr
        )
        if notion_public_page_metadata_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when onboarding used public page metadata access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_page_metadata_writeback_output
        ):
            fail("Generated outbound skill checker Notion public page metadata message changed.")

        notion_public_plain_page_writeback_cases = [
            (
                "public Notion page",
                notion_public_writeback_md.replace(
                    "Access route: public Notion shared page data API.",
                    "Access route: public Notion page.",
                ).replace(
                    "Source access route discovery result: public shared-page read discovery completed.",
                    "Source access route discovery result: public Notion page read discovery completed.",
                ).replace(
                    "Authentication or access check result: passed with anonymous public shared-page read access.",
                    "Authentication or access check result: passed with public Notion page read access.",
                ).replace(
                    "Sample fetch result: passed with public Notion shared-page record data.",
                    "Sample fetch result: passed with public Notion page record data.",
                ),
            ),
            (
                "shared Notion page",
                notion_public_writeback_md.replace(
                    "Access route: public Notion shared page data API.",
                    "Access route: shared Notion page.",
                ).replace(
                    "Source access route discovery result: public shared-page read discovery completed.",
                    "Source access route discovery result: shared Notion page read discovery completed.",
                ).replace(
                    "Authentication or access check result: passed with anonymous public shared-page read access.",
                    "Authentication or access check result: passed with shared Notion page read access.",
                ).replace(
                    "Sample fetch result: passed with public Notion shared-page record data.",
                    "Sample fetch result: passed with shared Notion page record data.",
                ),
            ),
        ]
        for case_name, skill_md in notion_public_plain_page_writeback_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            notion_public_plain_page_writeback_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            notion_public_plain_page_writeback_output = (
                notion_public_plain_page_writeback_failure.stdout
                + notion_public_plain_page_writeback_failure.stderr
            )
            if notion_public_plain_page_writeback_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject Notion source "
                    f"writeback when onboarding used {case_name} access only."
                )
            if (
                "Generated Notion skills cannot mark source writeback ready from public shared-page access"
                not in notion_public_plain_page_writeback_output
            ):
                fail(
                    "Generated outbound skill checker Notion "
                    f"{case_name} message changed."
                )

        notion_public_writeback_with_unavailable_fallback_md = notion_public_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
            "Result target mode: source-writeback.\n"
            "Durable result output fallback: session-table is unavailable "
            "because attended output is blocked.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_writeback_with_unavailable_fallback_md,
            encoding="utf-8",
        )
        notion_public_writeback_with_unavailable_fallback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_writeback_with_unavailable_fallback_output = (
            notion_public_writeback_with_unavailable_fallback_failure.stdout
            + notion_public_writeback_with_unavailable_fallback_failure.stderr
        )
        if notion_public_writeback_with_unavailable_fallback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject public Notion source "
                "writeback even when an unrelated fallback is unavailable."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_writeback_with_unavailable_fallback_output
        ):
            fail(
                "Generated outbound skill checker Notion public-writeback unavailable "
                "fallback message changed."
            )

        notion_public_policy_only_writeback_md = notion_public_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            "Source onboarding completed for this parameterized-bound workflow.\n"
            "Do not mark Notion source writeback ready until hosted Notion MCP "
            "writeback is verified.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_policy_only_writeback_md,
            encoding="utf-8",
        )
        notion_public_policy_only_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_policy_only_writeback_output = (
            notion_public_policy_only_writeback_failure.stdout
            + notion_public_policy_only_writeback_failure.stderr
        )
        if notion_public_policy_only_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source "
                "writeback when public onboarding only documents a future "
                "writeback policy."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_policy_only_writeback_output
        ):
            fail("Generated outbound skill checker Notion policy-only message changed.")

        notion_public_required_writeback_md = notion_public_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            "Source onboarding completed for this parameterized-bound workflow.\n"
            "Source writeback requires hosted Notion MCP page property update capability.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_required_writeback_md,
            encoding="utf-8",
        )
        notion_public_required_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_required_writeback_output = (
            notion_public_required_writeback_failure.stdout
            + notion_public_required_writeback_failure.stderr
        )
        if notion_public_required_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source "
                "writeback when onboarding only documents required future "
                "page-property update capability."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_required_writeback_output
        ):
            fail("Generated outbound skill checker Notion required-writeback message changed.")

        notion_public_pending_writeback_md = notion_public_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            "Source onboarding completed for this parameterized-bound workflow.\n"
            "Writeback is pending until verified through hosted Notion MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_pending_writeback_md,
            encoding="utf-8",
        )
        notion_public_pending_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_pending_writeback_output = (
            notion_public_pending_writeback_failure.stdout
            + notion_public_pending_writeback_failure.stderr
        )
        if notion_public_pending_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source "
                "writeback when writeback verification is only pending."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_pending_writeback_output
        ):
            fail("Generated outbound skill checker Notion pending-writeback message changed.")

        notion_public_configured_writeback_md = notion_public_writeback_md.replace(
            "Source access route discovery result: public shared-page read discovery completed.",
            "Source access route discovery result: public shared-page read discovery completed; "
            "hosted Notion MCP writeback route configured.",
        ).replace(
            "Authentication or access check result: passed with anonymous public shared-page read access.",
            "Authentication or access check result: passed with anonymous public shared-page read access; "
            "hosted Notion MCP writeback access configured.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_configured_writeback_md,
            encoding="utf-8",
        )
        notion_public_configured_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_configured_writeback_output = (
            notion_public_configured_writeback_failure.stdout
            + notion_public_configured_writeback_failure.stderr
        )
        if notion_public_configured_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source "
                "writeback when hosted writeback is only configured."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_configured_writeback_output
        ):
            fail("Generated outbound skill checker Notion configured-writeback message changed.")

        notion_public_save_transactions_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page data; "
                "canary writeback verified through saveTransactions."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_save_transactions_writeback_md,
            encoding="utf-8",
        )
        notion_public_save_transactions_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_save_transactions_writeback_output = (
            notion_public_save_transactions_writeback_failure.stdout
            + notion_public_save_transactions_writeback_failure.stderr
        )
        if notion_public_save_transactions_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when canary writeback evidence uses public saveTransactions access."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_save_transactions_writeback_output
        ):
            fail("Generated outbound skill checker Notion saveTransactions-writeback message changed.")

        notion_public_configured_save_transactions_writeback_md = (
            notion_public_configured_writeback_md.replace(
                "Sample fetch result: passed with public Notion shared-page record data.",
                (
                    "Sample fetch result: passed with public Notion shared-page data; "
                    "canary writeback verified through saveTransactions."
                ),
            )
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_configured_save_transactions_writeback_md,
            encoding="utf-8",
        )
        notion_public_configured_save_transactions_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_configured_save_transactions_writeback_output = (
            notion_public_configured_save_transactions_writeback_failure.stdout
            + notion_public_configured_save_transactions_writeback_failure.stderr
        )
        if notion_public_configured_save_transactions_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when configured hosted-route evidence is paired with public "
                "saveTransactions writeback evidence."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_configured_save_transactions_writeback_output
        ):
            fail(
                "Generated outbound skill checker Notion configured "
                "saveTransactions-writeback message changed."
            )

        notion_public_configured_result_save_transactions_writeback_md = (
            notion_public_configured_writeback_md.replace(
                "Target: Notion `result` page property discovered through the public shared-page route.",
                "Target: canary writeback verified through saveTransactions.",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_configured_result_save_transactions_writeback_md,
            encoding="utf-8",
        )
        notion_public_configured_result_save_transactions_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_configured_result_save_transactions_writeback_output = (
            notion_public_configured_result_save_transactions_writeback_failure.stdout
            + notion_public_configured_result_save_transactions_writeback_failure.stderr
        )
        if notion_public_configured_result_save_transactions_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when configured hosted-route evidence is paired with result-output "
                "saveTransactions writeback evidence."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_configured_result_save_transactions_writeback_output
        ):
            fail(
                "Generated outbound skill checker Notion configured result-output "
                "saveTransactions-writeback message changed."
            )

        notion_public_token_warning_writeback_md = notion_public_writeback_md.replace(
            "Source onboarding completed for this parameterized-bound workflow.",
            (
                "Source onboarding completed for this parameterized-bound workflow.\n"
                "Token handling: do not expose the Notion integration token."
            ),
        ).replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page data; "
                "canary writeback verified through saveTransactions."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_token_warning_writeback_md,
            encoding="utf-8",
        )
        notion_public_token_warning_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_token_warning_writeback_output = (
            notion_public_token_warning_writeback_failure.stdout
            + notion_public_token_warning_writeback_failure.stderr
        )
        if notion_public_token_warning_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when token-handling safety text is the only authenticated route evidence."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_token_warning_writeback_output
        ):
            fail("Generated outbound skill checker Notion token-warning-writeback message changed.")

        notion_public_token_omission_unqualified_writeback_md = (
            notion_public_writeback_md.replace(
                "Source onboarding completed for this parameterized-bound workflow.",
                (
                    "Source onboarding completed for this parameterized-bound workflow.\n"
                    "Token handling: omit Notion integration token from summaries."
                ),
            ).replace(
                "Target: Notion `result` page property discovered through the public shared-page route.",
                "Target: Notion `result` page property update verified.",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_token_omission_unqualified_writeback_md,
            encoding="utf-8",
        )
        notion_public_token_omission_unqualified_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_token_omission_unqualified_writeback_output = (
            notion_public_token_omission_unqualified_writeback_failure.stdout
            + notion_public_token_omission_unqualified_writeback_failure.stderr
        )
        if notion_public_token_omission_unqualified_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject public Notion source "
                "writeback when token-omission safety text is the only authenticated "
                "route evidence."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_token_omission_unqualified_writeback_output
        ):
            fail("Generated outbound skill checker Notion token-omission-writeback message changed.")

        notion_public_future_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback will be verified through hosted Notion MCP before launch."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_future_writeback_md,
            encoding="utf-8",
        )
        notion_public_future_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_future_writeback_output = (
            notion_public_future_writeback_failure.stdout
            + notion_public_future_writeback_failure.stderr
        )
        if notion_public_future_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback verification is future-tense."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_future_writeback_output
        ):
            fail("Generated outbound skill checker Notion future-writeback message changed.")

        notion_public_negated_auth_route_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback verified without Notion integration token."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_negated_auth_route_writeback_md,
            encoding="utf-8",
        )
        notion_public_negated_auth_route_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_negated_auth_route_writeback_output = (
            notion_public_negated_auth_route_writeback_failure.stdout
            + notion_public_negated_auth_route_writeback_failure.stderr
        )
        if notion_public_negated_auth_route_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when authenticated writeback evidence only negates an auth route."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_negated_auth_route_writeback_output
        ):
            fail("Generated outbound skill checker Notion negated-auth-route message changed.")

        notion_public_conditional_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data.\n"
                "Hosted Notion MCP must be used after canary writeback is verified."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_conditional_writeback_md,
            encoding="utf-8",
        )
        notion_public_conditional_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_conditional_writeback_output = (
            notion_public_conditional_writeback_failure.stdout
            + notion_public_conditional_writeback_failure.stderr
        )
        if notion_public_conditional_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback evidence is conditional requirement prose."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_conditional_writeback_output
        ):
            fail("Generated outbound skill checker Notion conditional-writeback message changed.")

        notion_public_conditional_credentials_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback verified through hosted Notion MCP if integration "
                "credentials are later added."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_conditional_credentials_writeback_md,
            encoding="utf-8",
        )
        notion_public_conditional_credentials_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_conditional_credentials_writeback_output = (
            notion_public_conditional_credentials_writeback_failure.stdout
            + notion_public_conditional_credentials_writeback_failure.stderr
        )
        if notion_public_conditional_credentials_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback depends on later credentials."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_conditional_credentials_writeback_output
        ):
            fail("Generated outbound skill checker Notion conditional-credentials-writeback message changed.")

        notion_public_after_later_credentials_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback verified through hosted Notion MCP after integration "
                "credentials are later added."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_after_later_credentials_writeback_md,
            encoding="utf-8",
        )
        notion_public_after_later_credentials_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_after_later_credentials_writeback_output = (
            notion_public_after_later_credentials_writeback_failure.stdout
            + notion_public_after_later_credentials_writeback_failure.stderr
        )
        if notion_public_after_later_credentials_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback waits for later credentials."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_after_later_credentials_writeback_output
        ):
            fail("Generated outbound skill checker Notion after-later-credentials message changed.")

        notion_public_credentials_to_add_later_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback verified through hosted Notion MCP with integration "
                "credentials to be added later."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_credentials_to_add_later_writeback_md,
            encoding="utf-8",
        )
        notion_public_credentials_to_add_later_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_credentials_to_add_later_writeback_output = (
            notion_public_credentials_to_add_later_writeback_failure.stdout
            + notion_public_credentials_to_add_later_writeback_failure.stderr
        )
        if notion_public_credentials_to_add_later_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback credentials are to be added later."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_credentials_to_add_later_writeback_output
        ):
            fail("Generated outbound skill checker Notion credentials-to-add-later message changed.")

        notion_public_conditional_permission_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback verified through hosted Notion MCP if write "
                "permission is granted."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_conditional_permission_writeback_md,
            encoding="utf-8",
        )
        notion_public_conditional_permission_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_conditional_permission_writeback_output = (
            notion_public_conditional_permission_writeback_failure.stdout
            + notion_public_conditional_permission_writeback_failure.stderr
        )
        if notion_public_conditional_permission_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback depends on conditional write permission."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_conditional_permission_writeback_output
        ):
            fail("Generated outbound skill checker Notion conditional-permission message changed.")

        notion_public_without_credentials_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback verified through hosted Notion MCP without "
                "integration credentials."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_without_credentials_writeback_md,
            encoding="utf-8",
        )
        notion_public_without_credentials_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_without_credentials_writeback_output = (
            notion_public_without_credentials_writeback_failure.stdout
            + notion_public_without_credentials_writeback_failure.stderr
        )
        if notion_public_without_credentials_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback lacks integration credentials."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_without_credentials_writeback_output
        ):
            fail("Generated outbound skill checker Notion without-credentials message changed.")

        notion_public_not_through_hosted_writeback_md = notion_public_writeback_md.replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            (
                "Sample fetch result: passed with public Notion shared-page record data; "
                "canary writeback verified not through hosted Notion MCP."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_not_through_hosted_writeback_md,
            encoding="utf-8",
        )
        notion_public_not_through_hosted_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_not_through_hosted_writeback_output = (
            notion_public_not_through_hosted_writeback_failure.stdout
            + notion_public_not_through_hosted_writeback_failure.stderr
        )
        if notion_public_not_through_hosted_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion source writeback "
                "when hosted writeback route evidence is negated with not through."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_not_through_hosted_writeback_output
        ):
            fail("Generated outbound skill checker Notion not-through-hosted message changed.")

        notion_public_with_hosted_writeback_md = notion_public_writeback_md.replace(
            "Source access route discovery result: public shared-page read discovery completed.",
            "Source access route discovery result: public shared-page read discovery completed; "
            "hosted Notion MCP writeback route verified.",
        ).replace(
            "Authentication or access check result: passed with anonymous public shared-page read access.",
            "Authentication or access check result: passed with anonymous public shared-page read access; "
            "hosted Notion MCP OAuth writeback verified.",
        ).replace(
            "Sample fetch result: passed with public Notion shared-page record data.",
            "Sample fetch result: passed with public Notion shared-page record data; "
            "canary writeback verified through hosted Notion MCP.",
        ).replace(
            "Target: Notion `result` page property discovered through the public shared-page route.",
            "Target: Notion `result` page property verified through hosted Notion MCP.",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_with_hosted_writeback_md,
            encoding="utf-8",
        )
        notion_public_with_hosted_writeback_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_public_with_hosted_writeback_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow Notion source writeback "
                "when public sampling has separate hosted MCP writeback verification: "
                + (
                    notion_public_with_hosted_writeback_success.stderr
                    or notion_public_with_hosted_writeback_success.stdout
                ).strip()
            )

        notion_public_source_family_format_cases = [
            ("source_family YAML key", 'source_family: "notion"'),
            ("source family prose", "Source family is notion."),
        ]
        for case_name, source_family_line in notion_public_source_family_format_cases:
            notion_public_source_family_format_md = notion_public_writeback_md.replace(
                "Source family: notion.",
                source_family_line,
            )
            (skill_dir / "SKILL.md").write_text(
                notion_public_source_family_format_md,
                encoding="utf-8",
            )
            notion_public_source_family_format_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            notion_public_source_family_format_output = (
                notion_public_source_family_format_failure.stdout
                + notion_public_source_family_format_failure.stderr
            )
            if notion_public_source_family_format_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject Notion public source writeback "
                    f"when source family is recorded as {case_name}."
                )
            if (
                "Generated Notion skills cannot mark source writeback ready from public shared-page access"
                not in notion_public_source_family_format_output
            ):
                fail(
                    "Generated outbound skill checker Notion source-family-format "
                    f"message changed for {case_name}."
                )

        notion_public_access_route_without_family_md = notion_public_writeback_md.replace(
            "Source family: notion.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_access_route_without_family_md,
            encoding="utf-8",
        )
        notion_public_access_route_without_family_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_access_route_without_family_output = (
            notion_public_access_route_without_family_failure.stdout
            + notion_public_access_route_without_family_failure.stderr
        )
        if notion_public_access_route_without_family_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion public source writeback "
                "when the Notion access route is present without a source-family line."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_access_route_without_family_output
        ):
            fail(
                "Generated outbound skill checker Notion access-route-without-family message changed."
            )

        notion_public_outside_result_writeback_base_md = notion_public_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
            "Target: local result CSV fallback until authenticated Notion writeback is verified.\n",
        )
        notion_public_outside_result_writeback_cases = [
            (
                "Source Onboarding",
                notion_public_outside_result_writeback_base_md.replace(
                    "Source onboarding completed for this parameterized-bound workflow.\n",
                    (
                        "Source onboarding completed for this parameterized-bound workflow.\n"
                        "Result target mode: source-writeback.\n"
                    ),
                ),
            ),
            (
                "Source Contract",
                notion_public_outside_result_writeback_base_md.replace(
                    "## Source Contract\n\n",
                    (
                        "## Source Contract\n\n"
                        "target_mode: source-writeback\n"
                    ),
                ),
            ),
        ]
        for section_name, skill_md in notion_public_outside_result_writeback_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            missing_active_result_target_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            missing_active_result_target_output = (
                missing_active_result_target_failure.stdout
                + missing_active_result_target_failure.stderr
            )
            if missing_active_result_target_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject generated skills whose "
                    f"only result target mode is declared in {section_name}."
                )
            if (
                "Generated skill result-output section must include result target mode"
                not in missing_active_result_target_output
            ):
                fail(
                    "Generated outbound skill checker missing active result-target "
                    f"message changed for {section_name}."
                )

        notion_public_outside_result_writeback_with_active_local_output_md = (
            notion_public_outside_result_writeback_base_md.replace(
                "Target: local result CSV fallback until authenticated Notion writeback is verified.\n",
                "Result target mode: result-csv-file.\n"
                "Target: local result CSV fallback until authenticated Notion writeback is verified.\n",
            )
        )
        notion_public_outside_result_note_cases = [
            (
                "Source Onboarding",
                notion_public_outside_result_writeback_with_active_local_output_md.replace(
                    "Source onboarding completed for this parameterized-bound workflow.\n",
                    (
                        "Source onboarding completed for this parameterized-bound workflow.\n"
                        "target_mode: source-writeback\n"
                    ),
                ),
            ),
            (
                "Source Contract",
                notion_public_outside_result_writeback_with_active_local_output_md.replace(
                    "## Source Contract\n\n",
                    (
                        "## Source Contract\n\n"
                        "target_mode: source-writeback\n"
                    ),
                ),
            ),
        ]
        for section_name, skill_md in notion_public_outside_result_note_cases:
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            notion_public_outside_result_note_success = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            if notion_public_outside_result_note_success.returncode != 0:
                fail(
                    "Generated outbound skill checker must allow public Notion skills "
                    "with an active local result target and an outside result-output "
                    f"source-writeback note in {section_name}: "
                    + (
                        notion_public_outside_result_note_success.stderr
                        or notion_public_outside_result_note_success.stdout
                    ).strip()
                )

        notion_public_blocked_writeback_request_md = (
            notion_public_outside_result_writeback_base_md.replace(
                "Source onboarding completed for this parameterized-bound workflow.\n",
                (
                    "Source onboarding completed for this parameterized-bound workflow.\n"
                    "target_mode: source-writeback is blocked until authenticated "
                    "Notion writeback is verified.\n"
                ),
            ).replace(
                "Target: local result CSV fallback until authenticated Notion writeback is verified.\n",
                "Result target mode: result-csv-file.\n"
                "Target: local result CSV fallback until authenticated Notion writeback is verified.\n",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_blocked_writeback_request_md,
            encoding="utf-8",
        )
        notion_public_blocked_writeback_request_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if notion_public_blocked_writeback_request_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow public Notion skills that block "
                "source-writeback and use an active local result target: "
                + (
                    notion_public_blocked_writeback_request_success.stderr
                    or notion_public_blocked_writeback_request_success.stdout
                ).strip()
            )

        notion_public_runtime_writeback_md = notion_public_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
            "Runtime result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_runtime_writeback_md,
            encoding="utf-8",
        )
        notion_public_runtime_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_runtime_writeback_output = (
            notion_public_runtime_writeback_failure.stdout
            + notion_public_runtime_writeback_failure.stderr
        )
        if notion_public_runtime_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject Notion runtime source writeback "
                "when onboarding used public shared-page access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_runtime_writeback_output
        ):
            fail("Generated outbound skill checker Notion runtime public-writeback message changed.")

        notion_public_prefixed_writeback_md = notion_public_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
            "Runtime result target mode: fixed source-writeback target resolved during creation.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_prefixed_writeback_md,
            encoding="utf-8",
        )
        notion_public_prefixed_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_prefixed_writeback_output = (
            notion_public_prefixed_writeback_failure.stdout
            + notion_public_prefixed_writeback_failure.stderr
        )
        if notion_public_prefixed_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject prefixed Notion source writeback "
                "when onboarding used public shared-page access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_prefixed_writeback_output
        ):
            fail("Generated outbound skill checker Notion prefixed public-writeback message changed.")

        notion_public_structured_writeback_md = notion_public_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
            "result_output:\n"
            "  policy: source-writeback\n"
            "  target_mode: source-adjacent-result-artifact\n"
            "  target: Notion `result` page property discovered through the public shared-page route.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_structured_writeback_md,
            encoding="utf-8",
        )
        notion_public_structured_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_structured_writeback_output = (
            notion_public_structured_writeback_failure.stdout
            + notion_public_structured_writeback_failure.stderr
        )
        if notion_public_structured_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject structured Notion source writeback "
                "when onboarding used public shared-page access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_structured_writeback_output
        ):
            fail("Generated outbound skill checker Notion structured public-writeback message changed.")

        notion_public_structured_target_writeback_md = notion_public_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
            "result_output:\n"
            "  policy: source-adjacent-result-artifact\n"
            "  target_mode: source-writeback\n"
            "  target: Notion `result` page property discovered through the public shared-page route.\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_structured_target_writeback_md,
            encoding="utf-8",
        )
        notion_public_structured_target_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_structured_target_writeback_output = (
            notion_public_structured_target_writeback_failure.stdout
            + notion_public_structured_target_writeback_failure.stderr
        )
        if notion_public_structured_target_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject structured Notion target-mode writeback "
                "when onboarding used public shared-page access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_structured_target_writeback_output
        ):
            fail(
                "Generated outbound skill checker Notion structured target-mode public-writeback message changed."
            )

        notion_public_fenced_structured_writeback_md = notion_public_writeback_md.replace(
            "Result output policy: source-writeback.\n"
            "Result target mode: source-writeback.\n"
            "Target: Notion `result` page property discovered through the public shared-page route.\n",
            "```yaml\n"
            "result_output:\n"
            "  policy: source-adjacent-result-artifact\n"
            "  target_mode: source-writeback\n"
            "  target: Notion `result` page property discovered through the public shared-page route.\n"
            "```\n",
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_fenced_structured_writeback_md,
            encoding="utf-8",
        )
        notion_public_fenced_structured_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_fenced_structured_writeback_output = (
            notion_public_fenced_structured_writeback_failure.stdout
            + notion_public_fenced_structured_writeback_failure.stderr
        )
        if notion_public_fenced_structured_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject fenced structured "
                "Notion target-mode writeback when onboarding used public "
                "shared-page access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_fenced_structured_writeback_output
        ):
            fail(
                "Generated outbound skill checker Notion fenced structured "
                "public-writeback message changed."
            )

        notion_public_labeled_fenced_structured_writeback_md = (
            notion_public_fenced_structured_writeback_md.replace(
                "```yaml\n",
                "Result output policy:\n```yaml\n",
                1,
            )
        )
        (skill_dir / "SKILL.md").write_text(
            notion_public_labeled_fenced_structured_writeback_md,
            encoding="utf-8",
        )
        notion_public_labeled_fenced_structured_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        notion_public_labeled_fenced_structured_writeback_output = (
            notion_public_labeled_fenced_structured_writeback_failure.stdout
            + notion_public_labeled_fenced_structured_writeback_failure.stderr
        )
        if notion_public_labeled_fenced_structured_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject labeled fenced "
                "structured Notion target-mode writeback when onboarding used public "
                "shared-page access only."
            )
        if (
            "Generated Notion skills cannot mark source writeback ready from public shared-page access"
            not in notion_public_labeled_fenced_structured_writeback_output
        ):
            fail(
                "Generated outbound skill checker Notion labeled fenced structured "
                "public-writeback message changed."
            )

        airtable_read_only_fenced_structured_writeback_md = (
            airtable_read_only_writeback_md.replace(
                "Result output policy: source-writeback.\n"
                "Result target mode: source-writeback.\n"
                "Target: Airtable `result` field update from the sampled records.\n",
                "```yaml\n"
                "result_output:\n"
                "  policy: source-adjacent-result-artifact\n"
                "  target_mode: source-writeback\n"
                "  target: Airtable `result` field update from the sampled records.\n"
                "```\n",
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_fenced_structured_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_fenced_structured_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_fenced_structured_writeback_output = (
            airtable_read_only_fenced_structured_writeback_failure.stdout
            + airtable_read_only_fenced_structured_writeback_failure.stderr
        )
        if airtable_read_only_fenced_structured_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject fenced structured "
                "Airtable target-mode writeback when onboarding used read-only "
                "Airtable access."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_fenced_structured_writeback_output
        ):
            fail(
                "Generated outbound skill checker Airtable fenced structured "
                "read-only writeback message changed."
            )

        airtable_read_only_labeled_fenced_structured_writeback_md = (
            airtable_read_only_fenced_structured_writeback_md.replace(
                "```yaml\n",
                "Result output policy:\n```yaml\n",
                1,
            )
        )
        (skill_dir / "SKILL.md").write_text(
            airtable_read_only_labeled_fenced_structured_writeback_md,
            encoding="utf-8",
        )
        airtable_read_only_labeled_fenced_structured_writeback_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        airtable_read_only_labeled_fenced_structured_writeback_output = (
            airtable_read_only_labeled_fenced_structured_writeback_failure.stdout
            + airtable_read_only_labeled_fenced_structured_writeback_failure.stderr
        )
        if airtable_read_only_labeled_fenced_structured_writeback_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject labeled fenced "
                "structured Airtable target-mode writeback when onboarding used "
                "read-only access."
            )
        if (
            "Generated Airtable skills cannot mark source writeback ready from read-only Airtable access"
            not in airtable_read_only_labeled_fenced_structured_writeback_output
        ):
            fail(
                "Generated outbound skill checker Airtable labeled fenced "
                "structured read-only writeback message changed."
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
        missing_preflight_md = valid_skill_md.replace(
            """## Preflight and Creation Summary

Preflight and creation summary records completed source checks, blockers, runtime
parameters, and validation results before real calls.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_preflight_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_preflight_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_preflight_output = missing_preflight_failure.stdout + missing_preflight_failure.stderr
        if missing_preflight_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing preflight summary.")
        if (
            "Generated skill SKILL.md must include preflight and creation summary"
            not in missing_preflight_output
        ):
            fail("Generated outbound skill checker missing-preflight-summary message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_provider_onboarding_md = valid_skill_md.replace(
            """## Provider Onboarding

Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: Codex.
MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.
Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
One-off call capability: passed with the configured MCP route.
Provider onboarding blocker: none.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_provider_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_provider_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_provider_onboarding_output = (
            missing_provider_onboarding_failure.stdout
            + missing_provider_onboarding_failure.stderr
        )
        if missing_provider_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing provider onboarding.")
        if (
            "Generated skill SKILL.md must include provider onboarding"
            not in missing_provider_onboarding_output
        ):
            fail("Generated outbound skill checker missing-provider-onboarding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_provider_terminal_scope_md = valid_skill_md.replace(
            """Provider terminal instructions such as `report_result` or `do not start another call`
apply only to the current provider run. After execution approval, do not ask the
user to continue, confirm the next candidate, or approve additional provider runs.
Continue the approved batch until every approved candidate reaches a terminal
result or skip state unless a batch-level blocker appears.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_provider_terminal_scope_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_provider_terminal_scope_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_provider_terminal_scope_output = (
            missing_provider_terminal_scope_failure.stdout
            + missing_provider_terminal_scope_failure.stderr
        )
        if missing_provider_terminal_scope_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing provider terminal instruction scope.")
        if (
            "Generated skill SKILL.md must include provider terminal instruction scope"
            not in missing_provider_terminal_scope_output
        ):
            fail("Generated outbound skill checker missing-provider-terminal-scope message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_post_approval_autonomy_md = valid_skill_md.replace(
            """After execution approval, do not ask the
user to continue, confirm the next candidate, or approve additional provider runs.
Continue the approved batch until every approved candidate reaches a terminal
result or skip state unless a batch-level blocker appears.
""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_post_approval_autonomy_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_post_approval_autonomy_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_post_approval_autonomy_output = (
            missing_post_approval_autonomy_failure.stdout
            + missing_post_approval_autonomy_failure.stderr
        )
        if missing_post_approval_autonomy_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing post-approval batch autonomy.")
        if (
            "Generated skill SKILL.md must include post-approval batch autonomy"
            not in missing_post_approval_autonomy_output
        ):
            fail("Generated outbound skill checker missing-post-approval-autonomy message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_provider_result_finalization_md = valid_skill_md.replace(
            """## Provider Result Finalization

Provider result finalization runs before result output. Terminal provider status is
not result-output-ready until the generated skill performs a full-history provider
reconciliation without a cursor. Do not write `no_answer`, `failed`, or
`no conversation captured` results until a negative terminal stability check
passes.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_provider_result_finalization_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_provider_result_finalization_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_provider_result_finalization_output = (
            missing_provider_result_finalization_failure.stdout
            + missing_provider_result_finalization_failure.stderr
        )
        if missing_provider_result_finalization_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing provider result finalization.")
        if (
            "Generated skill SKILL.md must include provider result finalization"
            not in missing_provider_result_finalization_output
        ):
            fail("Generated outbound skill checker missing-provider-result-finalization message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_writeback_target_mode_md = valid_skill_md.replace(
            "Runtime result target mode: source-adjacent-result-artifact resolved before execution approval from fixed creation values or approved runtime parameters.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_writeback_target_mode_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_writeback_target_mode_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_writeback_target_mode_output = (
            missing_writeback_target_mode_failure.stdout
            + missing_writeback_target_mode_failure.stderr
        )
        if missing_writeback_target_mode_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing result target mode.")
        if (
            "Generated skill SKILL.md must include result target mode"
            not in missing_writeback_target_mode_output
        ):
            fail("Generated outbound skill checker missing-result-target-mode message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        blocked_provider_onboarding_md = valid_skill_md.replace(
            "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
            "Provider authentication check result: blocked because CALL-E MCP auth is missing.",
        )
        (skill_dir / "SKILL.md").write_text(blocked_provider_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        blocked_provider_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        blocked_provider_onboarding_output = (
            blocked_provider_onboarding_failure.stdout
            + blocked_provider_onboarding_failure.stderr
        )
        if blocked_provider_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject blocked provider onboarding.")
        if (
            "Bound generated skill SKILL.md must include passed provider authentication or auth readiness check result"
            not in blocked_provider_onboarding_output
        ):
            fail("Generated outbound skill checker blocked-provider-onboarding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        inferred_provider_onboarding_md = valid_skill_md.replace(
            "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
            "Provider authentication check result: passed with host MCP route auth readiness inferred from available CALL-E-compatible MCP tools in the current host.",
        ).replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
            "Compatible MCP provider tools: `mcp__codex_apps__call_e_zhiwen_dev._plan_call`, `mcp__codex_apps__call_e_zhiwen_dev._run_call`, and `mcp__codex_apps__call_e_zhiwen_dev._get_call_run`.",
        )
        (skill_dir / "SKILL.md").write_text(inferred_provider_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        inferred_provider_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        inferred_provider_onboarding_output = (
            inferred_provider_onboarding_failure.stdout
            + inferred_provider_onboarding_failure.stderr
        )
        if inferred_provider_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject provider onboarding inferred from app tools.")
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in inferred_provider_onboarding_output
        ):
            fail("Generated outbound skill checker inferred-provider-onboarding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        for provider_evidence_list_prefix in ("- ", "* ", "+ ", "1. ", "1) "):
            bulleted_inferred_provider_onboarding_md = valid_skill_md.replace(
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
                (
                    f"{provider_evidence_list_prefix}Provider authentication check result: "
                    "passed with host MCP route auth readiness inferred from available "
                    "CALL-E-compatible MCP tools in the current host."
                ),
            ).replace(
                "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
                (
                    f"{provider_evidence_list_prefix}Compatible MCP provider tools: "
                    "`mcp__codex_apps__call_e_zhiwen_dev._plan_call`, "
                    "`mcp__codex_apps__call_e_zhiwen_dev._run_call`, and "
                    "`mcp__codex_apps__call_e_zhiwen_dev._get_call_run`."
                ),
            )
            (skill_dir / "SKILL.md").write_text(
                bulleted_inferred_provider_onboarding_md,
                encoding="utf-8",
            )

            bulleted_inferred_provider_onboarding_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            bulleted_inferred_provider_onboarding_output = (
                bulleted_inferred_provider_onboarding_failure.stdout
                + bulleted_inferred_provider_onboarding_failure.stderr
            )
            if bulleted_inferred_provider_onboarding_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject bulleted provider onboarding "
                    f"inferred from app tools with prefix {provider_evidence_list_prefix!r}."
                )
            if (
                "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
                not in bulleted_inferred_provider_onboarding_output
            ):
                fail(
                    "Generated outbound skill checker bulleted-inferred-provider-onboarding "
                    f"message changed for prefix {provider_evidence_list_prefix!r}."
                )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        continuation_line_provider_evidence_md = valid_skill_md.replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
            (
                "Compatible MCP provider tools:\n"
                "- `mcp__codex_apps__call_e_zhiwen_dev._plan_call`\n"
                "- `mcp__codex_apps__call_e_zhiwen_dev._run_call`\n"
                "- `mcp__codex_apps__call_e_zhiwen_dev._get_call_run`"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            continuation_line_provider_evidence_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        continuation_line_provider_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        continuation_line_provider_evidence_output = (
            continuation_line_provider_evidence_failure.stdout
            + continuation_line_provider_evidence_failure.stderr
        )
        if continuation_line_provider_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject continuation-line provider onboarding app tools."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in continuation_line_provider_evidence_output
        ):
            fail(
                "Generated outbound skill checker continuation-line-provider-evidence message changed."
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        hard_wrapped_provider_evidence_md = valid_skill_md.replace(
            "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
            (
                "Provider authentication check result: passed with host MCP route auth readiness\n"
                "inferred from available CALL-E-compatible MCP tools in the current host."
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            hard_wrapped_provider_evidence_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        hard_wrapped_provider_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        hard_wrapped_provider_evidence_output = (
            hard_wrapped_provider_evidence_failure.stdout
            + hard_wrapped_provider_evidence_failure.stderr
        )
        if hard_wrapped_provider_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject hard-wrapped provider onboarding app evidence."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in hard_wrapped_provider_evidence_output
        ):
            fail(
                "Generated outbound skill checker hard-wrapped-provider-evidence message changed."
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        prefixed_provider_evidence_cases = (
            (
                "prefixed provider authentication evidence",
                valid_skill_md.replace(
                    "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
                    "Evidence: Provider authentication check result: passed with host MCP route auth readiness inferred from available CALL-E-compatible MCP tools in the current host.",
                ),
            ),
            (
                "prefixed compatible provider tools evidence",
                valid_skill_md.replace(
                    "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
                    "Evidence: Compatible MCP provider tools: `mcp__codex_apps__call_e_zhiwen_dev._plan_call`, `mcp__codex_apps__call_e_zhiwen_dev._run_call`, and `mcp__codex_apps__call_e_zhiwen_dev._get_call_run`.",
                ),
            ),
        )
        for prefixed_provider_evidence_label, prefixed_provider_evidence_md in (
            prefixed_provider_evidence_cases
        ):
            (skill_dir / "SKILL.md").write_text(
                prefixed_provider_evidence_md,
                encoding="utf-8",
            )

            prefixed_provider_evidence_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            prefixed_provider_evidence_output = (
                prefixed_provider_evidence_failure.stdout
                + prefixed_provider_evidence_failure.stderr
            )
            if prefixed_provider_evidence_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject "
                    f"{prefixed_provider_evidence_label}."
                )
            if (
                "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
                not in prefixed_provider_evidence_output
            ):
                fail(
                    "Generated outbound skill checker "
                    f"{prefixed_provider_evidence_label} message changed."
                )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        nested_child_label_provider_evidence_md = valid_skill_md.replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
            (
                "Compatible MCP provider tools:\n"
                "- Tool namespace: `mcp__codex_apps__call_e_zhiwen_dev`"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            nested_child_label_provider_evidence_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        nested_child_label_provider_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        nested_child_label_provider_evidence_output = (
            nested_child_label_provider_evidence_failure.stdout
            + nested_child_label_provider_evidence_failure.stderr
        )
        if nested_child_label_provider_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject nested child-label provider onboarding app evidence."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in nested_child_label_provider_evidence_output
        ):
            fail(
                "Generated outbound skill checker nested-child-label-provider-evidence message changed."
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        provider_route_evidence_cases = (
            (
                "Provider route",
                "Provider route: mcp__codex_apps__call_e_zhiwen_dev\n",
            ),
            (
                "provider_route",
                "provider_route: mcp__codex_apps__call_e_zhiwen_dev\n",
            ),
        )
        for provider_route_evidence_label, provider_route_evidence_line in (
            provider_route_evidence_cases
        ):
            provider_route_evidence_md = valid_skill_md.replace(
                "Provider onboarding completed for the CALL-E MCP provider route.\n",
                (
                    "Provider onboarding completed for the CALL-E MCP provider route.\n"
                    f"{provider_route_evidence_line}"
                ),
            )
            (skill_dir / "SKILL.md").write_text(
                provider_route_evidence_md,
                encoding="utf-8",
            )

            provider_route_evidence_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            provider_route_evidence_output = (
                provider_route_evidence_failure.stdout
                + provider_route_evidence_failure.stderr
            )
            if provider_route_evidence_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject disallowed "
                    f"{provider_route_evidence_label} provider evidence."
                )
            if (
                "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
                not in provider_route_evidence_output
            ):
                fail(
                    "Generated outbound skill checker disallowed "
                    f"{provider_route_evidence_label} provider evidence message changed."
                )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        one_off_capability_evidence_cases = (
            (
                "One-off call capability",
                "One-off call capability: inferred from `mcp__codex_apps__call_e_zhiwen_dev._run_call`\n",
            ),
            (
                "one_off_call_capability",
                "one_off_call_capability: inferred from `mcp__codex_apps__call_e_zhiwen_dev._run_call`\n",
            ),
        )
        for one_off_capability_evidence_label, one_off_capability_evidence_line in (
            one_off_capability_evidence_cases
        ):
            one_off_capability_evidence_md = valid_skill_md.replace(
                "Provider onboarding completed for the CALL-E MCP provider route.\n",
                (
                    "Provider onboarding completed for the CALL-E MCP provider route.\n"
                    f"{one_off_capability_evidence_line}"
                ),
            )
            (skill_dir / "SKILL.md").write_text(
                one_off_capability_evidence_md,
                encoding="utf-8",
            )

            one_off_capability_evidence_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            one_off_capability_evidence_output = (
                one_off_capability_evidence_failure.stdout
                + one_off_capability_evidence_failure.stderr
            )
            if one_off_capability_evidence_failure.returncode == 0:
                fail(
                    "Generated outbound skill checker must reject disallowed "
                    f"{one_off_capability_evidence_label} provider evidence."
                )
            if (
                "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
                not in one_off_capability_evidence_output
            ):
                fail(
                    "Generated outbound skill checker disallowed "
                    f"{one_off_capability_evidence_label} provider evidence message changed."
                )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        later_nested_child_label_provider_evidence_md = valid_skill_md.replace(
            "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.",
            (
                "Compatible MCP provider tools:\n"
                "- Names: plan_call, run_call, get_call_run\n"
                "- Namespace: `mcp__codex_apps__call_e_zhiwen_dev`"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            later_nested_child_label_provider_evidence_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        later_nested_child_label_provider_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        later_nested_child_label_provider_evidence_output = (
            later_nested_child_label_provider_evidence_failure.stdout
            + later_nested_child_label_provider_evidence_failure.stderr
        )
        if later_nested_child_label_provider_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject later nested child-label provider onboarding app evidence."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in later_nested_child_label_provider_evidence_output
        ):
            fail(
                "Generated outbound skill checker later-nested-child-label-provider-evidence message changed."
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        free_form_provider_evidence_md = valid_skill_md.replace(
            "Provider onboarding completed for the CALL-E MCP provider route.\n",
            (
                "Provider onboarding completed for the CALL-E MCP provider route.\n"
                "Provider onboarding completed based on `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            free_form_provider_evidence_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        free_form_provider_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        free_form_provider_evidence_output = (
            free_form_provider_evidence_failure.stdout
            + free_form_provider_evidence_failure.stderr
        )
        if free_form_provider_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject free-form provider onboarding app evidence."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in free_form_provider_evidence_output
        ):
            fail(
                "Generated outbound skill checker free-form-provider-evidence message changed."
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        contract_only_free_form_provider_evidence_md = valid_skill_md.replace(
            "## Provider Onboarding\n\n",
            "## Provider Onboarding Contract\n\n",
        ).replace(
            "Provider onboarding completed for the CALL-E MCP provider route.\n",
            (
                "Provider onboarding completed for the CALL-E MCP provider route.\n"
                "Provider onboarding completed based on `mcp__codex_apps__call_e_zhiwen_dev._plan_call`.\n"
            ),
        )
        (skill_dir / "SKILL.md").write_text(
            contract_only_free_form_provider_evidence_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        contract_only_free_form_provider_evidence_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        contract_only_free_form_provider_evidence_output = (
            contract_only_free_form_provider_evidence_failure.stdout
            + contract_only_free_form_provider_evidence_failure.stderr
        )
        if contract_only_free_form_provider_evidence_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject contract-only free-form provider onboarding app evidence."
            )
        if (
            "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools"
            not in contract_only_free_form_provider_evidence_output
        ):
            fail(
                "Generated outbound skill checker contract-only-free-form-provider-evidence message changed."
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_mcp_route_setup_md = valid_skill_md.replace(
            "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_mcp_route_setup_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_mcp_route_setup_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_mcp_route_setup_output = (
            missing_mcp_route_setup_failure.stdout
            + missing_mcp_route_setup_failure.stderr
        )
        if missing_mcp_route_setup_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing MCP route setup evidence.")
        if (
            "Bound generated skill SKILL.md must include passed MCP route setup check result"
            not in missing_mcp_route_setup_output
        ):
            fail("Generated outbound skill checker missing-mcp-route-setup message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_serial_execution_md = valid_skill_md.replace(
            """## Serial Candidate Execution

After approval, serially process all ready candidates. For each candidate, plan,
inspect, run, check status when available, record the result, and continue to
the next candidate without another per-candidate confirmation. After all
candidates finish, write source results, a source-adjacent artifact, or a local
result CSV. Use a session table only as a last-resort attended fallback when
durable output is blocked.
Provider terminal instructions such as `report_result` or `do not start another call`
apply only to the current provider run. After execution approval, do not ask the
user to continue, confirm the next candidate, or approve additional provider runs.
Continue the approved batch until every approved candidate reaches a terminal
result or skip state unless a batch-level blocker appears.

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
        missing_source_onboarding_md = valid_skill_md.replace(
            """## Source Onboarding

Source onboarding completed for this parameterized-bound workflow.
Access route: local source credentials.
Source access route discovery result: host-local route discovery completed before user route selection.
Authentication or access check result: passed with local source credentials.
Sample fetch result: passed with a representative source instance.
Sampled source instance: representative-callback-source.
Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.
User-confirmed field mapping: confirmed after the representative sample was shown.
Redaction policy for sample summaries: mask phone numbers and omit credentials.
Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.
Runtime parameters still allowed: date window and approved source instance identifiers.

""",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_source_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_source_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_source_onboarding_output = (
            missing_source_onboarding_failure.stdout + missing_source_onboarding_failure.stderr
        )
        if missing_source_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing source onboarding.")
        if (
            "Generated skill SKILL.md must include source onboarding"
            not in missing_source_onboarding_output
        ):
            fail("Generated outbound skill checker missing-source-onboarding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_access_route_md = valid_skill_md.replace(
            "Access route: local source credentials.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_access_route_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_access_route_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_access_route_output = (
            missing_access_route_failure.stdout + missing_access_route_failure.stderr
        )
        if missing_access_route_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing source access route.")
        if (
            "Bound generated skill SKILL.md must include source access route"
            not in missing_access_route_output
        ):
            fail("Generated outbound skill checker missing-source-access-route message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_route_discovery_md = valid_skill_md.replace(
            "Source access route discovery result: host-local route discovery completed before user route selection.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_route_discovery_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_route_discovery_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_route_discovery_output = (
            missing_route_discovery_failure.stdout + missing_route_discovery_failure.stderr
        )
        if missing_route_discovery_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing source access route discovery result.")
        if (
            "Bound generated skill SKILL.md must include source access route discovery result"
            not in missing_route_discovery_output
        ):
            fail("Generated outbound skill checker missing-source-access-route-discovery message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        missing_confirmed_mapping_md = valid_skill_md.replace(
            "User-confirmed field mapping: confirmed after the representative sample was shown.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(missing_confirmed_mapping_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_confirmed_mapping_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_confirmed_mapping_output = (
            missing_confirmed_mapping_failure.stdout + missing_confirmed_mapping_failure.stderr
        )
        if missing_confirmed_mapping_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing user-confirmed field mapping.")
        if (
            "Bound generated skill SKILL.md must include user-confirmed field mapping"
            not in missing_confirmed_mapping_output
        ):
            fail("Generated outbound skill checker missing-user-confirmed-field-mapping message changed.")

    source_ready_placeholder_cases = [
        (
            "placeholder sampled source instance",
            valid_skill_md.replace(
                "Sampled source instance: representative-callback-source.",
                "Sampled source instance: missing because no representative sample was fetched.",
            ),
            "Bound generated skill SKILL.md must include sampled source instance",
        ),
        (
            "placeholder discovered field mapping",
            valid_skill_md.replace(
                "Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.",
                "Discovered field mapping: missing because no representative sample was fetched.",
            ),
            "Bound generated skill SKILL.md must include discovered field mapping",
        ),
        (
            "placeholder default goal from sampled fields",
            valid_skill_md.replace(
                "Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.",
                "Default goal contract derived from sampled fields: missing because no representative sample was fetched.",
            ),
            "Bound generated skill SKILL.md must include default goal contract derived from sampled fields",
        ),
    ]
    for case_name, skill_md, expected_error in source_ready_placeholder_cases:
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "generated-callback-skill"
            references_dir = skill_dir / "references"
            references_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
            (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

            source_ready_placeholder_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            source_ready_placeholder_output = (
                source_ready_placeholder_failure.stdout
                + source_ready_placeholder_failure.stderr
            )
            if source_ready_placeholder_failure.returncode == 0:
                fail(f"Generated outbound skill checker must reject {case_name}.")
            if expected_error not in source_ready_placeholder_output:
                fail(
                    "Generated outbound skill checker "
                    + case_name
                    + " message changed."
                )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        incomplete_bound_onboarding_md = valid_skill_md.replace(
            "Authentication or access check result: passed with local source credentials.\n",
            "",
        ).replace(
            "Sample fetch result: passed with a representative source instance.\n",
            "",
        )
        (skill_dir / "SKILL.md").write_text(incomplete_bound_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        incomplete_bound_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        incomplete_bound_onboarding_output = (
            incomplete_bound_onboarding_failure.stdout + incomplete_bound_onboarding_failure.stderr
        )
        if incomplete_bound_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject incomplete bound source onboarding.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in incomplete_bound_onboarding_output
        ):
            fail("Generated outbound skill checker incomplete-bound-onboarding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        blocked_bound_onboarding_md = valid_skill_md.replace(
            "Authentication or access check result: passed with local source credentials.",
            "Authentication or access check result: blocked by expired credentials.",
        ).replace(
            "Sample fetch result: passed with a representative source instance.",
            "Sample fetch result: not run because source access is blocked.",
        )
        (skill_dir / "SKILL.md").write_text(blocked_bound_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        blocked_bound_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        blocked_bound_onboarding_output = (
            blocked_bound_onboarding_failure.stdout + blocked_bound_onboarding_failure.stderr
        )
        if blocked_bound_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject blocked bound source onboarding.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in blocked_bound_onboarding_output
        ):
            fail("Generated outbound skill checker blocked-bound-onboarding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        failed_sample_onboarding_md = valid_skill_md.replace(
            "Sample fetch result: passed with a representative source instance.",
            "Sample fetch result: not run because source access is blocked.",
        )
        (skill_dir / "SKILL.md").write_text(failed_sample_onboarding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        failed_sample_onboarding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        failed_sample_onboarding_output = (
            failed_sample_onboarding_failure.stdout + failed_sample_onboarding_failure.stderr
        )
        if failed_sample_onboarding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject failed bound sample fetch.")
        if (
            "Bound generated skill SKILL.md must include passed sample fetch result"
            not in failed_sample_onboarding_output
        ):
            fail("Generated outbound skill checker failed-sample-onboarding message changed.")

    negated_onboarding_status_cases = [
        (
            "negated source authentication status",
            valid_skill_md.replace(
                "Authentication or access check result: passed with local source credentials.",
                "Authentication or access check result: not verified because local source credentials are missing.",
            ),
            "Bound generated skill SKILL.md must include passed authentication or access check result",
        ),
        (
            "negated sample fetch status",
            valid_skill_md.replace(
                "Sample fetch result: passed with a representative source instance.",
                "Sample fetch result: not passed because source access is blocked.",
            ),
            "Bound generated skill SKILL.md must include passed sample fetch result",
        ),
        (
            "negated provider route setup status",
            valid_skill_md.replace(
                "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.",
                "MCP route setup check result: not completed because the CALL-E MCP route is missing.",
            ),
            "Bound generated skill SKILL.md must include passed MCP route setup check result",
        ),
        (
            "negated provider authentication status",
            valid_skill_md.replace(
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
                "Provider authentication check result: not verified because CALL-E MCP auth is missing.",
            ),
            "Bound generated skill SKILL.md must include passed provider authentication or auth readiness check result",
        ),
        (
            "non-dry-run sample fetch not_run status",
            valid_skill_md.replace(
                "Sample fetch result: passed with a representative source instance.",
                "Sample fetch result: not_run because source access is blocked.",
            ),
            "Bound generated skill SKILL.md must include passed sample fetch result",
        ),
        (
            "non-dry-run provider route not run status",
            valid_skill_md.replace(
                "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.",
                "MCP route setup check result: not run because provider onboarding is blocked.",
            ),
            "Bound generated skill SKILL.md must include passed MCP route setup check result",
        ),
    ]
    for case_name, skill_md, expected_error in negated_onboarding_status_cases:
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "generated-callback-skill"
            references_dir = skill_dir / "references"
            references_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
            (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

            negated_status_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            negated_status_output = (
                negated_status_failure.stdout + negated_status_failure.stderr
            )
            if negated_status_failure.returncode == 0:
                fail(f"Generated outbound skill checker must reject {case_name}.")
            if expected_error not in negated_status_output:
                fail(
                    "Generated outbound skill checker "
                    + case_name
                    + " message changed."
                )

    source_placeholder_status_md = valid_skill_md.replace(
        "Authentication or access check result: passed with local source credentials.",
        (
            "Authentication or access check result: pending placeholder example.\n"
            "Authentication or access check result: passed with local source credentials."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(source_placeholder_status_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        source_placeholder_status_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if source_placeholder_status_success.returncode != 0:
            fail(
                "Generated outbound skill checker must scan source status lines after placeholders: "
                + (
                    source_placeholder_status_success.stderr
                    or source_placeholder_status_success.stdout
                ).strip()
            )

    provider_placeholder_status_md = valid_skill_md.replace(
        "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.",
        (
            "MCP route setup check result: pending placeholder example.\n"
            "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(provider_placeholder_status_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        provider_placeholder_status_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if provider_placeholder_status_success.returncode != 0:
            fail(
                "Generated outbound skill checker must scan provider status lines after placeholders: "
                + (
                    provider_placeholder_status_success.stderr
                    or provider_placeholder_status_success.stdout
                ).strip()
            )

    subheading_placeholder_cases = [
        (
            "source onboarding subheading placeholder",
            valid_skill_md.replace(
                "## Source Onboarding\n\n",
                (
                    "## Draft Source Notes\n\n"
                    "### Source Onboarding\n\n"
                    "Authentication or access check result: pending placeholder.\n"
                    "Sample fetch result: pending placeholder.\n\n"
                    "## Source Onboarding\n\n"
                ),
            ),
        ),
        (
            "provider onboarding subheading placeholder",
            valid_skill_md.replace(
                "## Provider Onboarding\n\n",
                (
                    "## Draft Provider Notes\n\n"
                    "### Provider Onboarding\n\n"
                    "MCP route setup check result: pending placeholder.\n"
                    "Provider authentication check result: pending placeholder.\n\n"
                    "## Provider Onboarding\n\n"
                ),
            ),
        ),
    ]
    for case_name, skill_md in subheading_placeholder_cases:
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "generated-callback-skill"
            references_dir = skill_dir / "references"
            references_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
            (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

            subheading_placeholder_success = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            if subheading_placeholder_success.returncode != 0:
                fail(
                    "Generated outbound skill checker must ignore "
                    + case_name
                    + ": "
                    + (
                        subheading_placeholder_success.stderr
                        or subheading_placeholder_success.stdout
                    ).strip()
                )

    dry_run_only_source_blocker_md = valid_skill_md.replace(
        "Source onboarding completed for this parameterized-bound workflow.",
        "Source onboarding recorded an onboarding blocker for this dry-run-only workflow.",
    ).replace(
        "Authentication or access check result: passed with local source credentials.",
        "Authentication or access check result: not passed because onboarding is blocked.",
    ).replace(
        "Sample fetch result: passed with a representative source instance.",
        "Sample fetch result: missing because source access is blocked.",
    ).replace(
        "Sampled source instance: representative-callback-source.\n",
        "",
    ).replace(
        "Discovered field mapping: candidate_id, phone_e164, name, submitted_at, consent, and callback_reason.\n",
        "",
    ).replace(
        "User-confirmed field mapping: confirmed after the representative sample was shown.\n",
        "",
    ).replace(
        "Default goal contract derived from sampled fields: call the respondent about callback_reason and summarize the result.\n",
        "Onboarding blocker: source access is blocked until credentials are refreshed.\n",
    ).replace(
        "Execution mode: dry-run-then-batch-approval.",
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
    )

    execution_section_dry_run_only_blocker_md = dry_run_only_source_blocker_md.replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        (
            "Execution mode: dry-run-then-batch-approval.\n"
            "This workflow is dry-run-only until onboarding is complete."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            execution_section_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        execution_section_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        execution_section_dry_run_only_blocker_output = (
            execution_section_dry_run_only_blocker_failure.stdout
            + execution_section_dry_run_only_blocker_failure.stderr
        )
        if execution_section_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject execution-section dry-run-only source blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in execution_section_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker execution-section source blocker message changed.")

    generated_skill_dry_run_only_blocker_md = dry_run_only_source_blocker_md.replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        (
            "Execution mode: dry-run-then-batch-approval.\n"
            "The generated skill must remain dry-run-only until onboarding is complete."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            generated_skill_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        generated_skill_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        generated_skill_dry_run_only_blocker_output = (
            generated_skill_dry_run_only_blocker_failure.stdout
            + generated_skill_dry_run_only_blocker_failure.stderr
        )
        if generated_skill_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject generated-skill dry-run-only source blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in generated_skill_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker generated-skill source blocker message changed.")

    keeps_generated_skill_dry_run_only_blocker_md = dry_run_only_source_blocker_md.replace(
        "Source onboarding recorded an onboarding blocker for this dry-run-only workflow.",
        (
            "Source onboarding recorded an onboarding blocker. "
            "The blocker keeps the generated skill dry-run-only until onboarding is complete."
        ),
    ).replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        "Execution mode: dry-run-then-batch-approval.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            keeps_generated_skill_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        keeps_generated_skill_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        keeps_generated_skill_dry_run_only_blocker_output = (
            keeps_generated_skill_dry_run_only_blocker_failure.stdout
            + keeps_generated_skill_dry_run_only_blocker_failure.stderr
        )
        if keeps_generated_skill_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject blocker-keeps-dry-run-only source blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in keeps_generated_skill_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker blocker-keeps source blocker message changed.")

    source_section_dry_run_only_blocker_md = dry_run_only_source_blocker_md.replace(
        "Source onboarding recorded an onboarding blocker for this dry-run-only workflow.",
        (
            "Source onboarding recorded an onboarding blocker. "
            "This workflow remains dry-run-only until onboarding is complete."
        ),
    ).replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        "Execution mode: dry-run-then-batch-approval.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            source_section_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        source_section_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        source_section_dry_run_only_blocker_output = (
            source_section_dry_run_only_blocker_failure.stdout
            + source_section_dry_run_only_blocker_failure.stderr
        )
        if source_section_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject source-section dry-run-only source blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in source_section_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker source-section source blocker message changed.")

    safety_section_dry_run_only_blocker_md = dry_run_only_source_blocker_md.replace(
        "Source onboarding recorded an onboarding blocker for this dry-run-only workflow.",
        "Source onboarding recorded an onboarding blocker.",
    ).replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        "Execution mode: dry-run-then-batch-approval.",
    ).replace(
        "no hidden recurring schedules, no credential exposure, and clear cancellation behavior.",
        (
            "no hidden recurring schedules, no credential exposure, and clear cancellation behavior. "
            "This skill remains dry-run-only until onboarding is complete."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            safety_section_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        safety_section_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        safety_section_dry_run_only_blocker_output = (
            safety_section_dry_run_only_blocker_failure.stdout
            + safety_section_dry_run_only_blocker_failure.stderr
        )
        if safety_section_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject safety-section dry-run-only source blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in safety_section_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker safety-section source blocker message changed.")

    contradictory_source_dry_run_only_blocker_md = source_section_dry_run_only_blocker_md.replace(
        "no hidden recurring schedules, no credential exposure, and clear cancellation behavior.",
        (
            "no hidden recurring schedules, no credential exposure, and clear cancellation behavior. "
            "This workflow is not dry-run-only."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            contradictory_source_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        contradictory_source_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        contradictory_source_dry_run_only_blocker_output = (
            contradictory_source_dry_run_only_blocker_failure.stdout
            + contradictory_source_dry_run_only_blocker_failure.stderr
        )
        if contradictory_source_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject contradictory source dry-run-only blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in contradictory_source_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker contradictory source dry-run-only blocker message changed.")

    missing_dry_run_only_blocker_md = dry_run_only_source_blocker_md.replace(
        "Source onboarding recorded an onboarding blocker for this dry-run-only workflow.",
        "Source onboarding recorded an onboarding blocker.",
    ).replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        "Execution mode: dry-run-then-batch-approval.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            missing_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_dry_run_only_blocker_output = (
            missing_dry_run_only_blocker_failure.stdout
            + missing_dry_run_only_blocker_failure.stderr
        )
        if missing_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject blockers without dry-run-only status.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in missing_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker missing-dry-run-only blocker message changed.")

    outside_section_dry_run_only_blocker_md = missing_dry_run_only_blocker_md.replace(
        "Candidate fields include candidate_id, name, phone_e164, timezone, and callback_reason.",
        (
            "This workflow remains dry-run-only until onboarding is complete.\n"
            "Candidate fields include candidate_id, name, phone_e164, timezone, and callback_reason."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            outside_section_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        outside_section_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        outside_section_dry_run_only_blocker_output = (
            outside_section_dry_run_only_blocker_failure.stdout
            + outside_section_dry_run_only_blocker_failure.stderr
        )
        if outside_section_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must ignore dry-run-only text outside allowed sections.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in outside_section_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker outside-section dry-run-only blocker message changed.")

    not_dry_run_only_blocker_md = dry_run_only_source_blocker_md.replace(
        "Source onboarding recorded an onboarding blocker for this dry-run-only workflow.",
        "Source onboarding recorded an onboarding blocker.",
    ).replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        "Execution mode: dry-run-then-batch-approval. This workflow is not dry-run-only.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            not_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        not_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        not_dry_run_only_blocker_output = (
            not_dry_run_only_blocker_failure.stdout
            + not_dry_run_only_blocker_failure.stderr
        )
        if not_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject non-dry-run-only blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in not_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker non-dry-run-only blocker message changed.")

    negated_dry_run_only_variants = [
        "This workflow is not-dry-run-only.",
        "This workflow is not_dry_run_only.",
    ]
    for negated_dry_run_only_variant in negated_dry_run_only_variants:
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "generated-callback-skill"
            references_dir = skill_dir / "references"
            references_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                not_dry_run_only_blocker_md.replace(
                    "This workflow is not dry-run-only.",
                    negated_dry_run_only_variant,
                ),
                encoding="utf-8",
            )
            (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
            (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

            negated_dry_run_only_variant_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            negated_dry_run_only_variant_output = (
                negated_dry_run_only_variant_failure.stdout
                + negated_dry_run_only_variant_failure.stderr
            )
            if negated_dry_run_only_variant_failure.returncode == 0:
                fail("Generated outbound skill checker must reject all non-dry-run-only blockers.")
            if (
                "Bound generated skill SKILL.md must include passed authentication or access check result"
                not in negated_dry_run_only_variant_output
            ):
                fail(
                    "Generated outbound skill checker non-dry-run-only variant message changed."
                )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            dry_run_only_source_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        dry_run_only_source_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        dry_run_only_source_blocker_output = (
            dry_run_only_source_blocker_failure.stdout
            + dry_run_only_source_blocker_failure.stderr
        )
        if dry_run_only_source_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject dry-run-only source blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in dry_run_only_source_blocker_output
        ):
            fail("Generated outbound skill checker dry-run-only source blocker message changed.")

    dry_run_only_source_not_run_blocker_md = dry_run_only_source_blocker_md.replace(
        "Sample fetch result: missing because source access is blocked.",
        "Sample fetch result: not_run because source access is blocked.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            dry_run_only_source_not_run_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        dry_run_only_source_not_run_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        dry_run_only_source_not_run_blocker_output = (
            dry_run_only_source_not_run_blocker_failure.stdout
            + dry_run_only_source_not_run_blocker_failure.stderr
        )
        if dry_run_only_source_not_run_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject dry-run-only source not_run blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in dry_run_only_source_not_run_blocker_output
        ):
            fail("Generated outbound skill checker dry-run-only source not-run blocker message changed.")

    dry_run_only_source_snake_negated_blocker_md = dry_run_only_source_blocker_md.replace(
        "Authentication or access check result: not passed because onboarding is blocked.",
        "Authentication or access check result: not_verified because onboarding is blocked.",
    ).replace(
        "Sample fetch result: missing because source access is blocked.",
        "Sample fetch result: not-passed because source access is blocked.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            dry_run_only_source_snake_negated_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        dry_run_only_source_snake_negated_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        dry_run_only_source_snake_negated_blocker_output = (
            dry_run_only_source_snake_negated_blocker_failure.stdout
            + dry_run_only_source_snake_negated_blocker_failure.stderr
        )
        if dry_run_only_source_snake_negated_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject dry-run-only source snake-case negated blockers.")
        if (
            "Bound generated skill SKILL.md must include passed authentication or access check result"
            not in dry_run_only_source_snake_negated_blocker_output
        ):
            fail("Generated outbound skill checker dry-run-only source snake-case blocker message changed.")

    dry_run_only_provider_blocker_md = valid_skill_md.replace(
        "Provider onboarding completed for the CALL-E MCP provider route.",
        "Provider onboarding recorded a provider onboarding blocker for this dry-run-only workflow.",
    ).replace(
        "MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.",
        "MCP route setup check result: blocked until the CALL-E MCP route is configured.",
    ).replace(
        "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
        "Provider authentication check result: not verified because provider onboarding is blocked.",
    ).replace(
        "Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.\n",
        "",
    ).replace(
        "One-off call capability: passed with the configured MCP route.",
        "One-off call capability: blocked until the CALL-E MCP route is configured.",
    ).replace(
        "Provider onboarding blocker: none.",
        "Provider onboarding blocker: CALL-E MCP route auth is not ready.",
    ).replace(
        "Execution mode: dry-run-then-batch-approval.",
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
    )

    stale_ready_provider_blocker_md = dry_run_only_provider_blocker_md.replace(
        "One-off call capability: blocked until the CALL-E MCP route is configured.",
        "One-off call capability: passed with the configured MCP route.",
    )

    missing_provider_runtime_ready_markers_md = valid_skill_md.replace(
        "Provider onboarding completed for the CALL-E MCP provider route.",
        "Provider onboarding recorded a provider onboarding blocker for this dry-run-only workflow.",
    ).replace(
        "Provider host runtime: Codex.",
        "Provider host runtime: missing because no MCP-capable host runtime is configured.",
    ).replace(
        "Provider onboarding blocker: none.",
        "Provider onboarding blocker: no MCP-capable host runtime is configured.",
    ).replace(
        "Execution mode: dry-run-then-batch-approval.",
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
    )

    provider_section_dry_run_only_blocker_md = dry_run_only_provider_blocker_md.replace(
        "Provider onboarding recorded a provider onboarding blocker for this dry-run-only workflow.",
        (
            "Provider onboarding recorded a provider onboarding blocker. "
            "This skill remains dry-run-only until onboarding is complete."
        ),
    ).replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        "Execution mode: dry-run-then-batch-approval.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            provider_section_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        provider_section_dry_run_only_blocker_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if provider_section_dry_run_only_blocker_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow provider-section dry-run-only blockers: "
                + (
                    provider_section_dry_run_only_blocker_success.stderr
                    or provider_section_dry_run_only_blocker_success.stdout
                ).strip()
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            stale_ready_provider_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        stale_ready_provider_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        stale_ready_provider_blocker_output = (
            stale_ready_provider_blocker_failure.stdout
            + stale_ready_provider_blocker_failure.stderr
        )
        if stale_ready_provider_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject blocked provider with ready evidence.")
        if "blocked provider onboarding must not include passed" not in stale_ready_provider_blocker_output:
            fail("Generated outbound skill checker stale provider-ready evidence message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            missing_provider_runtime_ready_markers_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        missing_provider_runtime_ready_markers_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        missing_provider_runtime_ready_markers_output = (
            missing_provider_runtime_ready_markers_failure.stdout
            + missing_provider_runtime_ready_markers_failure.stderr
        )
        if missing_provider_runtime_ready_markers_failure.returncode == 0:
            fail(
                "Generated outbound skill checker must reject missing provider runtime "
                "with passed ready evidence."
            )
        if (
            "blocked provider onboarding must not include passed"
            not in missing_provider_runtime_ready_markers_output
        ):
            fail(
                "Generated outbound skill checker missing-provider-runtime ready-evidence "
                "message changed."
            )

    contradictory_provider_dry_run_only_blocker_md = provider_section_dry_run_only_blocker_md.replace(
        "Source onboarding completed for this parameterized-bound workflow.",
        (
            "Source onboarding completed for this parameterized-bound workflow. "
            "This skill is not dry-run-only."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            contradictory_provider_dry_run_only_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        contradictory_provider_dry_run_only_blocker_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        contradictory_provider_dry_run_only_blocker_output = (
            contradictory_provider_dry_run_only_blocker_failure.stdout
            + contradictory_provider_dry_run_only_blocker_failure.stderr
        )
        if contradictory_provider_dry_run_only_blocker_failure.returncode == 0:
            fail("Generated outbound skill checker must reject contradictory provider dry-run-only blockers.")
        if (
            "Bound generated skill SKILL.md must include passed MCP route setup check result"
            not in contradictory_provider_dry_run_only_blocker_output
        ):
            fail("Generated outbound skill checker contradictory provider dry-run-only blocker message changed.")

    dry_run_only_provider_snake_negated_blocker_md = dry_run_only_provider_blocker_md.replace(
        "Provider authentication check result: not verified because provider onboarding is blocked.",
        "Provider authentication check result: not_verified because provider onboarding is blocked.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            dry_run_only_provider_snake_negated_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        dry_run_only_provider_snake_negated_blocker_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if dry_run_only_provider_snake_negated_blocker_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow dry-run-only provider snake-case negated blockers: "
                + (
                    dry_run_only_provider_snake_negated_blocker_success.stderr
                    or dry_run_only_provider_snake_negated_blocker_success.stdout
                ).strip()
            )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            dry_run_only_provider_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        dry_run_only_provider_blocker_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if dry_run_only_provider_blocker_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow dry-run-only provider blockers: "
                + (
                    dry_run_only_provider_blocker_success.stderr
                    or dry_run_only_provider_blocker_success.stdout
                ).strip()
            )

    dry_run_only_provider_post_resolution_md = dry_run_only_provider_blocker_md.replace(
        "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.",
        (
            "Execution mode: dry-run-then-batch-approval. This workflow is dry-run-only until onboarding is complete.\n"
            "This workflow is not dry-run-only after provider onboarding is verified and the runtime gate passes."
        ),
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            dry_run_only_provider_post_resolution_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        dry_run_only_provider_post_resolution_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if dry_run_only_provider_post_resolution_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow post-resolution "
                "dry-run-only provider blocker wording: "
                + (
                    dry_run_only_provider_post_resolution_success.stderr
                    or dry_run_only_provider_post_resolution_success.stdout
                ).strip()
            )

    dry_run_only_provider_not_run_blocker_md = dry_run_only_provider_blocker_md.replace(
        "MCP route setup check result: blocked until the CALL-E MCP route is configured.",
        "MCP route setup check result: not run because provider onboarding is blocked.",
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            dry_run_only_provider_not_run_blocker_md,
            encoding="utf-8",
        )
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        dry_run_only_provider_not_run_blocker_success = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if dry_run_only_provider_not_run_blocker_success.returncode != 0:
            fail(
                "Generated outbound skill checker must allow dry-run-only provider not-run blockers: "
                + (
                    dry_run_only_provider_not_run_blocker_success.stderr
                    or dry_run_only_provider_not_run_blocker_success.stdout
                ).strip()
            )

    conflicting_status_cases = [
        (
            "conflicting source authentication status",
            dry_run_only_source_blocker_md.replace(
                "Authentication or access check result: not passed because onboarding is blocked.",
                (
                    "Authentication or access check result: not passed because onboarding is blocked.\n"
                    "Authentication or access check result: passed with local source credentials."
                ),
            ),
            "Generated skill SKILL.md has conflicting passed authentication or access check result lines",
        ),
        (
            "conflicting provider authentication status",
            dry_run_only_provider_blocker_md.replace(
                "Provider authentication check result: not verified because provider onboarding is blocked.",
                (
                    "Provider authentication check result: not verified because provider onboarding is blocked.\n"
                    "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod."
                ),
            ),
            "Generated skill SKILL.md has conflicting passed provider authentication or auth readiness check result lines",
        ),
        (
            "contradictory source authentication status",
            valid_skill_md.replace(
                "Authentication or access check result: passed with local source credentials.",
                "Authentication or access check result: passed but missing credentials.",
            ),
            "Generated skill SKILL.md has contradictory passed authentication or access check result line",
        ),
        (
            "contradictory provider authentication requires onboarding status",
            valid_skill_md.replace(
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
                "Provider authentication check result: passed but requires OAuth login before calls.",
            ),
            "Generated skill SKILL.md has contradictory passed provider authentication or auth readiness check result line",
        ),
        (
            "contradictory provider authentication mixed no-oauth and setup-required status",
            valid_skill_md.replace(
                "Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.",
                (
                    "Provider authentication check result: passed; no separate OAuth required "
                    "but requires connector setup before calls."
                ),
            ),
            "Generated skill SKILL.md has contradictory passed provider authentication or auth readiness check result line",
        ),
        (
            "contradictory one-off call capability status",
            valid_skill_md.replace(
                "One-off call capability: passed with the configured MCP route.",
                "One-off call capability: passed but missing because no run tool is exposed.",
            ),
            "Generated skill SKILL.md has contradictory one-off call capability line",
        ),
        (
            "conflicting sampled source instance evidence",
            valid_skill_md.replace(
                "Sampled source instance: representative-callback-source.\n",
                (
                    "Sampled source instance: representative-callback-source.\n"
                    "Sampled source instance: missing because no representative sample was fetched.\n"
                ),
            ),
            "Generated skill SKILL.md has conflicting sampled source instance lines",
        ),
        (
            "conflicting compatible MCP provider tools evidence",
            valid_skill_md.replace(
                (
                    "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                    "are exposed by the configured MCP route for one-off calls.\n"
                ),
                (
                    "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                    "are exposed by the configured MCP route for one-off calls.\n"
                    "Compatible MCP provider tools: missing because no compatible tools are exposed.\n"
                ),
            ),
            "Generated skill SKILL.md has conflicting compatible MCP provider tools lines",
        ),
        (
            "compatible MCP provider tools without concrete evidence",
            valid_skill_md.replace(
                (
                    "Compatible MCP provider tools: plan_call, run_call, and get_call_run "
                    "are exposed by the configured MCP route for one-off calls."
                ),
                "Compatible MCP provider tools: no extra tools needed.",
            ),
            "Bound generated skill SKILL.md must include compatible MCP provider tools",
        ),
        (
            "conflicting one-off call capability evidence",
            valid_skill_md.replace(
                "One-off call capability: passed with the configured MCP route.\n",
                (
                    "One-off call capability: passed with the configured MCP route.\n"
                    "One-off call capability: missing because no run tool is exposed.\n"
                ),
            ),
            "Generated skill SKILL.md has conflicting one-off call capability lines",
        ),
    ]
    for case_name, skill_md, expected_error in conflicting_status_cases:
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "generated-callback-skill"
            references_dir = skill_dir / "references"
            references_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
            (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

            conflicting_status_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            conflicting_status_output = (
                conflicting_status_failure.stdout + conflicting_status_failure.stderr
            )
            if conflicting_status_failure.returncode == 0:
                fail(f"Generated outbound skill checker must reject {case_name}.")
            if expected_error not in conflicting_status_output:
                fail(
                    "Generated outbound skill checker "
                    + case_name
                    + " message changed."
                )

    dry_run_only_blocker_failure_cases = [
        (
            "dry-run-only source blocker without blocker field",
            dry_run_only_source_blocker_md.replace(
                "Onboarding blocker: source access is blocked until credentials are refreshed.\n",
                "",
            ),
            "Bound generated skill SKILL.md must include passed authentication or access check result",
        ),
        (
            "dry-run-only source blocker with none blocker",
            dry_run_only_source_blocker_md.replace(
                "Onboarding blocker: source access is blocked until credentials are refreshed.",
                "Onboarding blocker: none.",
            ),
            "Bound generated skill SKILL.md must include passed authentication or access check result",
        ),
        (
            "dry-run-only source blocker with contradictory none blocker",
            dry_run_only_source_blocker_md.replace(
                "Onboarding blocker: source access is blocked until credentials are refreshed.",
                (
                    "Onboarding blocker: source access is blocked until credentials are refreshed.\n"
                    "Onboarding blocker: none."
                ),
            ),
            "Bound generated skill SKILL.md must include passed authentication or access check result",
        ),
        (
            "dry-run-only provider blocker without blocker field",
            dry_run_only_provider_blocker_md.replace(
                "Provider onboarding blocker: CALL-E MCP route auth is not ready.\n",
                "",
            ),
            "Dry-run-only blocked provider onboarding must include a non-empty provider onboarding blocker",
        ),
        (
            "dry-run-only provider blocker with none blocker",
            dry_run_only_provider_blocker_md.replace(
                "Provider onboarding blocker: CALL-E MCP route auth is not ready.",
                "Provider onboarding blocker: none.",
            ),
            "Dry-run-only blocked provider onboarding must include a non-empty provider onboarding blocker",
        ),
        (
            "dry-run-only provider blocker with contradictory none blocker",
            dry_run_only_provider_blocker_md.replace(
                "Provider onboarding blocker: CALL-E MCP route auth is not ready.",
                (
                    "Provider onboarding blocker: CALL-E MCP route auth is not ready.\n"
                    "Provider onboarding blocker: none."
                ),
            ),
            "Dry-run-only blocked provider onboarding must include a non-empty provider onboarding blocker",
        ),
    ]
    for case_name, skill_md, expected_error in dry_run_only_blocker_failure_cases:
        with tempfile.TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / "generated-callback-skill"
            references_dir = skill_dir / "references"
            references_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
            (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
            (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

            dry_run_only_blocker_failure = subprocess.run(
                ["node", str(checker), "--skill-dir", str(skill_dir)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            dry_run_only_blocker_output = (
                dry_run_only_blocker_failure.stdout
                + dry_run_only_blocker_failure.stderr
            )
            if dry_run_only_blocker_failure.returncode == 0:
                fail(f"Generated outbound skill checker must reject {case_name}.")
            if expected_error not in dry_run_only_blocker_output:
                fail(
                    "Generated outbound skill checker "
                    + case_name
                    + " message changed."
                )

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        maximum_only_execution_md = valid_skill_md.replace(
            "Execution mode: dry-run-then-batch-approval.",
            "Maximum execution mode: approved-direct-execution.",
        )
        (skill_dir / "SKILL.md").write_text(maximum_only_execution_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        maximum_only_execution_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        maximum_only_execution_output = (
            maximum_only_execution_failure.stdout + maximum_only_execution_failure.stderr
        )
        if maximum_only_execution_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing selected execution mode.")
        if (
            "Generated skill SKILL.md must declare a selected execution mode"
            not in maximum_only_execution_output
        ):
            fail("Generated outbound skill checker missing-selected-execution message changed.")

    unsupported_execution_mode = "per-" + "call-approval"

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        unsupported_execution_md = valid_skill_md.replace(
            "Execution mode: dry-run-then-batch-approval.",
            f"Execution mode: {unsupported_execution_mode}.",
        )
        (skill_dir / "SKILL.md").write_text(unsupported_execution_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        unsupported_execution_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unsupported_execution_output = (
            unsupported_execution_failure.stdout + unsupported_execution_failure.stderr
        )
        if unsupported_execution_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unsupported execution modes.")
        if "unsupported execution modes are not allowed" not in unsupported_execution_output:
            fail("Generated outbound skill checker unsupported-execution message changed.")

    unsupported_binding_level = "un" + "bound-" + "generic"

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        maximum_only_binding_md = valid_skill_md.replace(
            "Binding level: parameterized-bound.",
            "Maximum binding level: parameterized-bound.",
        )
        (skill_dir / "SKILL.md").write_text(maximum_only_binding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        maximum_only_binding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        maximum_only_binding_output = (
            maximum_only_binding_failure.stdout + maximum_only_binding_failure.stderr
        )
        if maximum_only_binding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject missing selected binding level.")
        if (
            "Generated skill SKILL.md must declare a selected binding level"
            not in maximum_only_binding_output
        ):
            fail("Generated outbound skill checker missing-selected-binding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        unsupported_binding_md = valid_skill_md.replace(
            "Binding level: parameterized-bound.",
            f"Binding level: {unsupported_binding_level}.",
        )
        (skill_dir / "SKILL.md").write_text(unsupported_binding_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text("# Examples\n", encoding="utf-8")

        unsupported_binding_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unsupported_binding_output = (
            unsupported_binding_failure.stdout + unsupported_binding_failure.stderr
        )
        if unsupported_binding_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unsupported binding levels.")
        if "unsupported binding levels are not allowed" not in unsupported_binding_output:
            fail("Generated outbound skill checker unsupported-binding message changed.")

    with tempfile.TemporaryDirectory() as temp_dir:
        skill_dir = Path(temp_dir) / "generated-callback-skill"
        references_dir = skill_dir / "references"
        references_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(valid_skill_md, encoding="utf-8")
        (references_dir / "safety.md").write_text("# Safety\n", encoding="utf-8")
        (references_dir / "examples.md").write_text(
            f"# Examples\nBinding level: {unsupported_binding_level}.\n",
            encoding="utf-8",
        )

        unsupported_reference_failure = subprocess.run(
            ["node", str(checker), "--skill-dir", str(skill_dir)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        unsupported_reference_output = (
            unsupported_reference_failure.stdout + unsupported_reference_failure.stderr
        )
        if unsupported_reference_failure.returncode == 0:
            fail("Generated outbound skill checker must reject unsupported binding references.")
        if "unsupported binding levels are not allowed" not in unsupported_reference_output:
            fail("Generated outbound skill checker unsupported-reference message changed.")

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
    validate_skill_email_checker()
    validate_skill_example_and_script_emails()
    validate_readme()
    validate_repository_name_references()
    validate_english_only()
    validate_templates()
    validate_git_naming_conventions()
    validate_apps()
    validate_plugins()
    validate_skill_reference_path_checker()
    validate_skills()
    validate_call_reminder_acceptance_rules()
    validate_outbound_call_skill_creator_acceptance_rules()
    validate_outbound_generated_skill_checker()
    print("Repository validation passed.")


if __name__ == "__main__":
    main()
