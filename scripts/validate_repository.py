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
SKILL_SCRIPT_REFERENCE_RE = re.compile(r"(?<![A-Za-z0-9_./-])(scripts/[A-Za-z0-9][A-Za-z0-9._/-]*)")
REPOSITORY_TITLE = "Awesome Phone Call Agents"
OLD_REPOSITORY_TITLE = "Awesome Phone Call " + "Skill"
OLD_REPOSITORY_SLUG = "awesome-phone-call-" + "skill"
README_SUBTITLE = "A community hub for reusable phone-call Agent Skills, runnable apps, workflow plugins, adapters, scheduler recipes, and safety patterns."
CLI_REFERENCE_SENTENCE = "CALL-E CLI parameters and command flags are documented in [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md)."
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


def extract_referenced_skill_script_paths(text: str) -> set[Path]:
    paths: set[Path] = set()
    for match in SKILL_SCRIPT_REFERENCE_RE.finditer(text):
        raw_path = match.group(1).rstrip(".,;:)]}`'\"")
        path = Path(raw_path)
        if len(path.parts) < 2 or path.parts[0] != "scripts":
            continue
        if any(part in {"", ".", ".."} for part in path.parts):
            continue
        paths.add(path)
    return paths


def missing_referenced_skill_script_paths(skill_dir: Path, text: str) -> list[Path]:
    return sorted(
        (
            relative_path
            for relative_path in extract_referenced_skill_script_paths(text)
            if not (skill_dir / relative_path).is_file() and not (ROOT / relative_path).is_file()
        ),
        key=str,
    )


def iter_skill_dirs() -> list[Path]:
    skills_dir = ROOT / "skills"
    if not skills_dir.exists():
        fail("Missing skills/ directory.")
    skill_dirs = sorted(path for path in skills_dir.iterdir() if path.is_dir())
    if not skill_dirs:
        fail("No skills found in skills/.")
    return skill_dirs


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
    sample = "Use `scripts/render-runtime-prompt.mjs`, then run scripts/validate-reminder-input.mjs."
    expected = {
        Path("scripts/render-runtime-prompt.mjs"),
        Path("scripts/validate-reminder-input.mjs"),
    }
    actual = extract_referenced_skill_script_paths(sample)
    if expected - actual:
        fail("Skill helper-script reference checker must find local scripts/ references.")

    missing = missing_referenced_skill_script_paths(
        ROOT / "skills" / "call-reminder",
        "Use scripts/does-not-exist.mjs for this workflow.",
    )
    if missing != [Path("scripts/does-not-exist.mjs")]:
        fail("Skill helper-script reference checker must report missing local scripts.")


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
        for missing_script in missing_referenced_skill_script_paths(skill_dir, text):
            fail(
                f"Skill references missing helper script: "
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
            "If this host has no TikTok Ads MCP server configured, I will ask whether to add the default route before running `codex mcp add`",
            "- source family: `tiktok-ads`",
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
