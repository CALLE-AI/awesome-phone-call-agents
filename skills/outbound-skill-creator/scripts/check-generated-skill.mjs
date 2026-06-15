#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const REQUIRED_ROUTE = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NON_ENGLISH_SCRIPT_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
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
    label: "execution modes",
    patterns: [/execution modes/iu],
  },
  {
    label: "serial candidate execution",
    patterns: [/serial candidate execution/iu, /serially process all ready candidates/iu],
  },
  {
    label: "writeback behavior",
    patterns: [/writeback behavior/iu],
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
