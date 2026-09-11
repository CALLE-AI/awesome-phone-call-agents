/**
 * Assemble the hackathon entry.
 *
 *   node scripts/make-submission.mjs <path-to-fork>
 *
 * Copies this app into <fork>/apps/typescript/arc-platform/, which is the
 * layout the awesome-phone-call-agents repo expects: full source, plus
 * package.json, package-lock.json, tsconfig.json, .env.example and
 * PULL_REQUEST.md.
 *
 * It REFUSES rather than copies when something is wrong, because the two
 * mistakes that matter here are both silent: shipping a .env, and shipping a
 * real phone number. Both would be public and permanent the moment the PR
 * opens, and neither is visible in a diff of 298 files.
 *
 * Nothing is deleted at the target beyond the entry directory itself, and that
 * only when --force is given.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = "apps/typescript/arc-platform";

const target = process.argv[2];
const force = process.argv.includes("--force");
if (!target) {
  console.error("usage: node scripts/make-submission.mjs <path-to-fork> [--force]");
  process.exit(1);
}

/* git decides what ships. Anything ignored - node_modules, .next, .env - is
   ignored here too, by construction rather than by a list that drifts. */
/* Internal working notes that are ours and not the entry's. Excluded rather
   than edited: pre-filming-checklist.md points at a live call in our own
   workspace as a demo fallback, and stripping that reference to make it fit
   for publication would break a note we actually use. It stays whole in
   arc-platform, which is private. */
const PRIVATE_TO_US = [
  "docs/pre-filming-checklist.md",
  /* A support ticket written for CALL-E's team. Its substance is per-call
     telemetry - queue and talk times, turn counts, and seven of their own
     recording identifiers - about calls to people who never agreed to appear
     in a public repository. Redacting it would leave a document with nothing
     in it; excluding it keeps it useful to the one party it was written for. */
  "docs/calle-support.md",
];

const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !PRIVATE_TO_US.includes(f));

const REQUIRED = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".env.example",
  "PULL_REQUEST.md",
  "README.md",
  "LICENSE",
];
const missing = REQUIRED.filter((f) => !files.includes(f));
if (missing.length) {
  console.error(`REFUSING: the entry needs these and they are not tracked:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

/* A tracked .env would mean secrets in a public PR. */
const secrets = files.filter((f) => /^\.env$|^\.env\.local$|\.pem$|\.key$/.test(f));
if (secrets.length) {
  console.error(`REFUSING: these would be published:\n  ${secrets.join("\n  ")}`);
  process.exit(1);
}

/* The two real handsets were redacted on 5 September. THESE are what must
   never ship: a public PR is permanent, and a phone number in it belongs to a
   person who did not agree to that.

   Matched by HASH, not by literal. The first version of this listed both
   numbers as regexes - and then correctly refused to run, because this file
   ships inside scripts/ and would have exported the exact numbers it exists to
   block. A guard cannot name what it forbids if the guard is part of the
   cargo.

   The repo also carries plenty of obviously-fictional numbers - +923001234567
   and friends, in tests and .env.example - and refusing on those would make
   this script something people learn to --force past, which is worse than not
   having it. They are counted and shown, not blocked. */
const BLOCKED = new Set([
  "5539ea7447636461",
  "206c01faa601b736",
]);
const digest = (n) => createHash("sha256").update(n).digest("hex").slice(0, 16);

const leaked = [];
const otherNumbers = new Set();
for (const f of files) {
  const p = path.join(ROOT, f);
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    continue; // binary
  }
  for (const m of text.match(/\+?92\d{10}/g) ?? []) {
    const bare = m.replace(/^\+/, "");
    if (BLOCKED.has(digest(bare))) leaked.push(`${f}: ${m.slice(0, 5)}…`);
    else otherNumbers.add(m);
  }
}
if (leaked.length) {
  console.error(`REFUSING: a real handset appears in these files:\n  ${leaked.join("\n  ")}`);
  process.exit(1);
}

const dest = path.join(path.resolve(target), ENTRY);
if (fs.existsSync(dest)) {
  if (!force) {
    console.error(`REFUSING: ${dest} already exists. Re-run with --force to replace it.`);
    process.exit(1);
  }
  fs.rmSync(dest, { recursive: true });
}

for (const f of files) {
  const to = path.join(dest, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), to);
}

console.log(`entry written: ${dest}`);
console.log(`files: ${files.length}`);
console.log(`checks passed: required files present, no secrets, no real handset`);
if (otherNumbers.size) {
  console.log(`\nfictional numbers that will ship (${otherNumbers.size} distinct) - worth an eye:`);
  console.log(`  ${[...otherNumbers].sort().join("\n  ")}`);
}
