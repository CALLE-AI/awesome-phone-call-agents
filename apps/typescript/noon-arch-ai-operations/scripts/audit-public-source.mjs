import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".next", ".vinext", ".wrangler", "dist", "node_modules", "submission-artifacts"]);
const ignoredFiles = new Set([".env.local", "package-lock.json", "tsconfig.tsbuildinfo"]);
const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".md", ".mjs", ".sql", ".ts", ".tsx", ".txt", ".yml", ".yaml"]);

const checks = [
  { name: "non-empty server secret", pattern: /(?:CALLE_API_KEY|INTEGRATION_ENCRYPTION_KEY|CLICKUP_TOKEN)\s*=\s*[^\s#]{8,}/i },
  { name: "credential-shaped token", pattern: /(?:^|[^A-Za-z0-9])(?:iams_[A-Za-z0-9]{12,}|pk_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/m },
  { name: "unmasked Saudi mobile number", pattern: /(?:\+|00)?9665\d{8}/ },
  { name: "operational ClickUp URL", pattern: /app\.clickup\.com\/\d{6,}(?:\/|\b)/i },
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && ignoredFiles.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(fullPath));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

const findings = [];
for (const file of await collect(root)) {
  const content = await readFile(file, "utf8");
  for (const check of checks) {
    if (check.pattern.test(content)) findings.push({ file: path.relative(root, file), rule: check.name });
  }
}

if (findings.length) {
  console.error("Public-source audit failed. Matched values are intentionally hidden:");
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.rule}`);
  process.exitCode = 1;
} else {
  console.log("Public-source audit passed: no configured secret, private-phone, or operational-ID patterns found.");
}
