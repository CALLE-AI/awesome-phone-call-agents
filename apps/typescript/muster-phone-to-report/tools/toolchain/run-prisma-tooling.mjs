import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireFromRoot = createRequire(new URL("../../package.json", import.meta.url));
const prismaCli = requireFromRoot.resolve("prisma/build/index.js");
const generatedPrismaRoot = fileURLToPath(
  new URL("../../packages/infrastructure-postgres/src/generated/prisma/", import.meta.url),
);
const toolingDatabaseUrl = "postgresql://prisma-tooling.invalid/muster_tooling";
const allowedCommands = new Set(["generate", "validate"]);

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listGeneratedTypeScriptFiles(directory) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listGeneratedTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

function normalizeGeneratedPrismaOutput() {
  for (const path of listGeneratedTypeScriptFiles(generatedPrismaRoot)) {
    const source = readFileSync(path, "utf8");
    const normalized = source.replace(/\r\n?/gu, "\n").replace(/[\t ]+$/gmu, "");
    if (normalized !== source) {
      writeFileSync(path, normalized, "utf8");
    }
  }
}

const [command, ...unexpectedArguments] = process.argv.slice(2);
if (command === undefined || !allowedCommands.has(command) || unexpectedArguments.length > 0) {
  process.stderr.write("Prisma tooling accepts exactly one command: generate or validate\n");
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [prismaCli, command], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      // Schema-only commands require a parseable URL but never connect. The reserved
      // .invalid host keeps this tooling fallback non-routable and unusable at runtime.
      MIGRATION_DATABASE_URL: toolingDatabaseUrl,
    },
    stdio: "inherit",
    windowsHide: true,
  });

  let exitCode = result.status ?? 1;
  if (result.error !== undefined) {
    process.stderr.write(`Prisma ${command} could not start\n`);
  } else if (exitCode === 0 && command === "generate") {
    try {
      normalizeGeneratedPrismaOutput();
    } catch {
      process.stderr.write("Prisma generated output could not be normalized\n");
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}
