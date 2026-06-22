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
        if (skill_dir / "README.md").exists():
            fail(
                f"Skill directory must not include README.md; move long-form guidance to docs/: "
                f"{(skill_dir / 'README.md').relative_to(ROOT)}"
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
        "docs/codex-implementation-plan.md",
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
        "skills/outbound-call-skill-creator/references/binding-contract.md",
        "skills/outbound-call-skill-creator/references/creation-summary.md",
        "skills/outbound-call-skill-creator/references/data-sources.md",
        "skills/outbound-call-skill-creator/references/execution-modes.md",
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
        skill_dir / "references" / "output-targets.md",
    ]:
        forbid_text(path, ["ttmcp"])
    require_text(
        skill_dir / "SKILL.md",
        [
            "Creation-Time Source Onboarding",
            "source onboarding",
            "sampled fields",
            "Minimum source binding is mandatory.",
            "stop before writing the generated skill and ask for the missing contract details",
            "scope-first output rule",
            "If the installed `outbound-call-skill-creator` folder is inside a recognized user-level skills root",
            "Never write a generated business skill into the downloaded `outbound-call-skill-creator` skill folder itself.",
            "For any authenticated or connector-backed source family",
            "minimum connection details",
            "When the user names only an authenticated source family such as `google-form` or `tiktok-ads`, the next creation step must be source access onboarding",
            "When a host-local source adapter, connector, MCP tool, or helper script is available, inspect it before asking the user to choose an access route.",
            "Do not ask the user to choose `use local OAuth to list accessible forms` when a local OAuth helper can be checked directly.",
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
            "Do not ask for the default outbound goal, result-output mapping, or full field mapping before the access check and sample fetch have been attempted.",
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
            "If the user replies only `google-form`, do not ask for the default outbound goal yet.",
            "The same pattern applies when the user replies only `tiktok-ads`",
            "I need the minimum Google access details first so I can authorize or verify access and fetch a redacted representative sample before we define fields or the default goal.",
            "I will first check whether this host already exposes Google Forms access.",
            "If local OAuth is available, I will run its auth check and list accessible forms before asking you for a Form ID.",
            "## TikTok Ads Lead Follow-Up Skill",
            "If this host has no TikTok Ads MCP server configured, I will add the default route first and then inspect it",
            "- source family: `tiktok-ads`",
            "source-adjacent result artifact",
        ],
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

        other_agent_provider_onboarding_md = valid_skill_md.replace(
            """Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: Codex.
MCP route setup check result: passed with `codex mcp get calle-prod` for the required route.
Provider authentication check result: passed with `codex mcp list` reporting OAuth for calle-prod.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
Provider onboarding blocker: none.""",
            """Provider onboarding completed for the CALL-E MCP provider route.
Provider host runtime: example-agent.
MCP route setup check result: passed with example-agent MCP connector configured for the required route.
Provider authentication check result: passed with example-agent OAuth connection verified for the required route.
Compatible MCP provider tools: plan_call, run_call, and get_call_run are exposed by the configured MCP route for one-off calls.
Provider onboarding blocker: none.""",
        )
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
    validate_skills()
    validate_call_reminder_acceptance_rules()
    validate_outbound_call_skill_creator_acceptance_rules()
    validate_outbound_generated_skill_checker()
    print("Repository validation passed.")


if __name__ == "__main__":
    main()
