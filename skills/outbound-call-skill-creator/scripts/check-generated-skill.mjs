#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_ROUTE = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NON_ENGLISH_SCRIPT_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const BINDING_LEVEL_RE = /\bbinding level\s*(?:is|:)\s*`?(fully-bound|parameterized-bound|unbound-generic)`?/iu;
const EXECUTION_MODE_RE =
  /^\s*(?:selected\s+)?execution mode\s*(?:is|:)\s*`?(dry-run-then-batch-approval|per-call-approval|approved-direct-execution)`?/imu;
const REQUIRED_SKILL_MARKERS = [
  {
    label: "purpose and when to use",
    patterns: [/purpose and when to use/iu, /when to use/iu],
  },
  {
    label: "when not to use",
    patterns: [/when not to use/iu, /do not use/iu],
  },
  {
    label: "binding level and runtime parameters",
    patterns: [/binding level/iu, /runtime parameters/iu],
  },
  {
    label: "source contract",
    patterns: [/source contract/iu],
  },
  {
    label: "candidate fields",
    patterns: [/candidate fields/iu],
  },
  {
    label: "outbound goal contract",
    patterns: [/outbound goal contract/iu],
  },
  {
    label: "MCP provider route",
    patterns: [/mcp provider route/iu],
  },
  {
    label: "provider onboarding",
    patterns: [/provider onboarding/iu],
  },
  {
    label: "execution modes",
    patterns: [/execution modes/iu],
  },
  {
    label: "serial candidate execution",
    patterns: [/serial candidate execution/iu, /serially process all ready candidates/iu],
  },
  {
    label: "provider terminal instruction scope",
    patterns: [
      /provider terminal instructions such as `?report_result`? or `?do not start another call`?\s+apply only to the current provider run/iu,
      /provider terminal instruction[\s\S]*current provider run/iu,
    ],
  },
  {
    label: "post-approval batch autonomy",
    patterns: [
      /after execution approval,\s*do not ask the\s+user to continue,\s*confirm the next candidate,\s*or approve additional provider runs/iu,
      /do not ask the\s+user to continue,\s*confirm the next candidate,\s*or approve additional provider runs/iu,
    ],
  },
  {
    label: "provider result finalization",
    patterns: [
      /provider result finalization[\s\S]*full-history provider\s+reconciliation[\s\S]*negative terminal stability check/iu,
      /terminal provider status is\s+not writeback-ready[\s\S]*full-history provider\s+reconciliation/iu,
    ],
  },
  {
    label: "writeback behavior",
    patterns: [/writeback behavior/iu],
  },
  {
    label: "writeback target mode",
    patterns: [
      /runtime writeback target mode\s*:/iu,
      /writeback target mode\s*:\s*(?:resolved|fixed|runtime|parameterized|source-writeback|source-csv-in-place|result-csv-file|session-table)/iu,
      /writeback target mode\s*:\s*(?:source-writeback|source-csv-in-place|result-csv-file|session-table)/iu,
      /target mode\s*:\s*(?:source-writeback|source-csv-in-place|result-csv-file|session-table)/iu,
    ],
  },
  {
    label: "preflight and creation summary",
    patterns: [/preflight and creation summary/iu],
  },
  {
    label: "safety summary",
    patterns: [/safety summary/iu],
  },
  {
    label: "validation commands",
    patterns: [/validation commands/iu],
  },
];
const BOUND_ONBOARDING_MARKERS = [
  {
    label: "passed authentication or access check result",
    patterns: [
      /^\s*(?:source\s+)?authentication or access check result\s*:\s*(?:passed|verified|confirmed|completed|succeeded)\b/imu,
      /^\s*(?:source\s+)?auth(?:entication)? check result\s*:\s*(?:passed|verified|confirmed|completed|succeeded)\b/imu,
    ],
  },
  {
    label: "source access route",
    patterns: [/^\s*(?:source\s+)?access route\s*:/imu],
  },
  {
    label: "source access route discovery result",
    patterns: [/^\s*source access route discovery result\s*:/imu],
  },
  {
    label: "passed sample fetch result",
    patterns: [/sample fetch result\s*:\s*(?:passed|verified|confirmed|completed|succeeded)\b/iu],
  },
  {
    label: "sampled source instance",
    patterns: [/sampled source instance\s*:/iu],
  },
  {
    label: "discovered field mapping",
    patterns: [/discovered field mapping\s*:/iu],
  },
  {
    label: "user-confirmed field mapping",
    patterns: [
      /user-confirmed field mapping\s*:/iu,
      /field mapping confirmed after (?:the )?(?:representative )?sample/iu,
    ],
  },
  {
    label: "redaction policy for sample summaries",
    patterns: [/redaction policy(?: for sample summaries)?\s*:/iu],
  },
  {
    label: "default goal contract derived from sampled fields",
    patterns: [/default goal contract derived from sampled fields\s*:/iu],
  },
  {
    label: "runtime parameters still allowed",
    patterns: [/runtime parameters still allowed\s*:/iu],
  },
];
const BOUND_PROVIDER_ONBOARDING_MARKERS = [
  {
    label: "configured provider host runtime",
    patterns: [/provider host runtime\s*:/iu, /host runtime\s*:/iu],
  },
  {
    label: "passed MCP route setup check result",
    patterns: [
      /mcp route setup check result\s*:\s*(?:passed|verified|confirmed|completed|succeeded)\b/iu,
      /provider route setup check result\s*:\s*(?:passed|verified|confirmed|completed|succeeded)\b/iu,
    ],
  },
  {
    label: "passed provider authentication or auth readiness check result",
    patterns: [
      /provider (?:authentication|auth readiness) check result\s*:\s*(?:passed|verified|confirmed|completed|succeeded)\b/iu,
      /provider auth(?:entication)?\s*:\s*(?:passed|verified|confirmed|completed|succeeded)\b/iu,
    ],
  },
  {
    label: "compatible MCP provider tools",
    patterns: [/compatible MCP provider tools\s*:/iu, /compatible provider tools\s*:/iu],
  },
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing file: ${filePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseFrontmatter(text, filePath) {
  if (!text.startsWith("---\n")) {
    fail(`Missing YAML frontmatter: ${filePath}`);
    return {};
  }

  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    fail(`Unterminated YAML frontmatter: ${filePath}`);
    return {};
  }

  const result = {};
  const block = text.slice(4, end).trim();
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      fail(`Invalid frontmatter line in ${filePath}: ${line}`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^[\u2019'"]|[\u2019'"]$/g, "");
    result[key] = value;
  }
  return result;
}

function walkTextFiles(dirPath) {
  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTextFiles(fullPath));
      continue;
    }
    if (/\.(md|mjs|json|yaml|yml|txt)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseArgs(argv) {
  const args = { skillDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skill-dir") {
      args.skillDir = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

function extractRequiredValue(text, pattern, label) {
  const match = pattern.exec(text);
  if (!match) {
    fail(`Generated skill SKILL.md must declare a selected ${label}`);
    return "";
  }
  return match[1].toLowerCase();
}

const args = parseArgs(process.argv.slice(2));
if (!args.skillDir) {
  fail("Usage: check-generated-skill.mjs --skill-dir <path>");
  process.exit();
}

const skillDir = path.resolve(args.skillDir);
const skillName = path.basename(skillDir);
const skillMd = path.join(skillDir, "SKILL.md");
const safetyMd = path.join(skillDir, "references", "safety.md");
const examplesMd = path.join(skillDir, "references", "examples.md");

if (!SLUG_RE.test(skillName)) {
  fail(`Skill directory is not a lowercase slug: ${skillName}`);
}

const skillText = readText(skillMd);
const frontmatter = parseFrontmatter(skillText, skillMd);
const frontmatterKeys = Object.keys(frontmatter);

if (
  frontmatterKeys.some((key) => !["name", "description"].includes(key)) ||
  !frontmatterKeys.includes("name") ||
  !frontmatterKeys.includes("description")
) {
  fail("Generated skill frontmatter must include only name and description");
}

if (frontmatter.name !== skillName) {
  fail(`Skill name '${frontmatter.name || ""}' must match directory '${skillName}'`);
}

if (!frontmatter.description || frontmatter.description.length < 40) {
  fail("Skill description must be at least 40 characters");
}

if (!/phone|call/iu.test(frontmatter.description || "")) {
  fail("Skill description must mention phone or call workflow");
}

for (const marker of REQUIRED_SKILL_MARKERS) {
  if (!marker.patterns.some((pattern) => pattern.test(skillText))) {
    fail(`Generated skill SKILL.md must include ${marker.label}`);
  }
}

if (!/source onboarding/iu.test(skillText)) {
  fail("Generated skill SKILL.md must include source onboarding");
}

const selectedBindingLevel = extractRequiredValue(
  skillText,
  BINDING_LEVEL_RE,
  "binding level",
);
const selectedExecutionMode = extractRequiredValue(
  skillText,
  EXECUTION_MODE_RE,
  "execution mode",
);
const providerOnboardingMatch = /##\s+Provider Onboarding\s*([\s\S]*?)(?:\n##\s+|$)/iu.exec(
  skillText,
);
const providerOnboardingText = providerOnboardingMatch ? providerOnboardingMatch[1] : "";

if (["fully-bound", "parameterized-bound"].includes(selectedBindingLevel)) {
  for (const marker of BOUND_ONBOARDING_MARKERS) {
    if (!marker.patterns.some((pattern) => pattern.test(skillText))) {
      fail(`Bound generated skill SKILL.md must include ${marker.label}`);
    }
  }
  if (/inferred|mcp__codex_apps__|call_e_zhiwen|botlab/iu.test(providerOnboardingText)) {
    fail(
      "Provider onboarding must use host MCP route setup and authentication evidence, not app connector tools",
    );
  }
  for (const marker of BOUND_PROVIDER_ONBOARDING_MARKERS) {
    if (!marker.patterns.some((pattern) => pattern.test(skillText))) {
      fail(`Bound generated skill SKILL.md must include ${marker.label}`);
    }
  }
}

if (selectedBindingLevel === "unbound-generic") {
  if (!/dry-run-only/iu.test(skillText)) {
    fail("Unbound generic generated skill must declare dry-run-only behavior");
  }
  if (!/onboarding blocker/iu.test(skillText)) {
    fail("Unbound generic generated skill must record a source onboarding blocker");
  }
}

if (
  selectedBindingLevel === "unbound-generic" &&
  selectedExecutionMode !== "dry-run-then-batch-approval"
) {
  fail(`Generated skill cannot use ${selectedExecutionMode} with unbound-generic`);
}

if (!/runtime gate/iu.test(skillText)) {
  fail("Generated skill SKILL.md must mention runtime gate requirements");
}

if (
  !skillText.includes("must not use a CLI bootstrap path") &&
  !skillText.includes("Do not use a CLI bootstrap path")
) {
  fail(
    "Generated skill SKILL.md must explicitly say it must not use a CLI bootstrap path",
  );
}

readText(safetyMd);
readText(examplesMd);

if (fs.existsSync(path.join(skillDir, "template.md"))) {
  fail("Generated outbound skills must not use template.md");
}

const textFiles = fs.existsSync(skillDir) ? walkTextFiles(skillDir) : [];
const allText = textFiles.map((filePath) => readText(filePath)).join("\n");

if (!allText.includes(REQUIRED_ROUTE)) {
  fail(`Generated skill must mention MCP provider route ${REQUIRED_ROUTE}`);
}

for (const filePath of textFiles) {
  const text = readText(filePath);
  if (NON_ENGLISH_SCRIPT_RE.test(text)) {
    fail(`Non-English CJK, Japanese, or Korean script found in generated skill file: ${filePath}`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`Generated skill validation passed: ${skillDir}`);
