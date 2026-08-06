#!/usr/bin/env node

const HELP = `Usage:
  node skills/call-outcome-reconciler/scripts/sync-mapping.mjs [--check] [--help]

Copies the mapping table from the skill to the Python companion app.

The skill owns outcome-code-map.yaml. The app ships a synchronised copy so it
stays installable on its own, without reading files from outside its directory.
A second hand-edited copy would violate the isolation the mapping depends on,
so this script is the only supported way to update it.

  (no flags)  copy skill -> app
  --check     exit 1 if the two copies differ; change nothing
`;

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(SKILL_DIR, "..", "..");
const SOURCE = join(SKILL_DIR, "outcome-code-map.yaml");
const TARGET = join(REPO_ROOT, "apps", "python", "outcome-reconciler", "outcome-code-map.yaml");

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const checkOnly = argv.includes("--check");

  let source;
  try {
    source = readFileSync(SOURCE);
  } catch (error) {
    process.stderr.write(`Cannot read mapping table at ${SOURCE}: ${error.message}\n`);
    return 1;
  }

  let target = null;
  try {
    target = readFileSync(TARGET);
  } catch {
    target = null;
  }

  const inSync = target !== null && source.equals(target);
  const shortTarget = relative(REPO_ROOT, TARGET);

  if (checkOnly) {
    if (inSync) {
      process.stdout.write(`Mapping table is in sync: ${shortTarget}\n`);
      return 0;
    }
    process.stderr.write(
      `Mapping table has drifted: ${shortTarget}\n` +
        "Run: node skills/call-outcome-reconciler/scripts/sync-mapping.mjs\n",
    );
    return 1;
  }

  if (inSync) {
    process.stdout.write(`Already in sync: ${shortTarget}\n`);
    return 0;
  }

  try {
    writeFileSync(TARGET, source);
  } catch (error) {
    process.stderr.write(`Cannot write ${TARGET}: ${error.message}\n`);
    return 1;
  }
  process.stdout.write(`Updated ${shortTarget}\n`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
