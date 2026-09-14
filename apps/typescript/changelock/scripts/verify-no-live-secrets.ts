import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "data",
  "dist",
  ".vercel",
]);

const SECRET_PATTERNS: [RegExp, string][] = [
  [/iams_(live|test)_[A-Za-z0-9]/, "CALL-E API key material"],
  [/sk_live_[A-Za-z0-9]/, "live secret key material"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/CALLE_API_KEY[ \t]*=[ \t]*\S/, "assigned CALL-E API key"],
  [/TURSO_AUTH_TOKEN[ \t]*=[ \t]*\S/, "assigned Turso auth token"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT-shaped credential (Turso auth tokens are JWTs)"],
];

const E164 = /\+[1-9]\d{7,14}/;
const RESERVED_OK = /^\+1\d{3}55501\d\d$/;

const failures: string[] = [];

function scan(file: string): void {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) failures.push(`${rel}: contains ${label}`);
  }
  if (/\.(ts|tsx|md|json)$/.test(file) && !rel.startsWith("tests")) {
    for (const m of text.matchAll(new RegExp(E164.source, "g"))) {
      if (!RESERVED_OK.test(m[0])) {
        failures.push(`${rel}: full E.164 number outside reserved +1 202-555-01xx range: ${m[0]}`);
      }
    }
  }
}

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|json|md|env|example|ya?ml|toml)$/.test(name)) scan(p);
  }
}

walk(ROOT);

if (failures.length > 0) {
  process.stderr.write(`Secret scan failed:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("No live secrets or unexpected full phone numbers found.\n");
