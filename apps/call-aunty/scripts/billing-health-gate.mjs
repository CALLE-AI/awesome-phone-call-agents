#!/usr/bin/env node
/**
 * V6 billing health gate
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let failed = false;

for (const step of [
  { name: "typecheck", cmd: "pnpm", args: ["check"] },
  {
    name: "billing-tests",
    cmd: "pnpm",
    args: ["exec", "vitest", "run", "tests/billing-v6.test.ts", "tests/workflow-errors.test.ts"],
  },
  {
    name: "calle-tests",
    cmd: "pnpm",
    args: [
      "exec",
      "vitest",
      "run",
      "tests/calle-workflow.test.ts",
      "tests/hackathon-e2e.test.ts",
    ],
  },
]) {
  process.stdout.write(`\n▶ ${step.name}...\n`);
  const result = spawnSync(step.cmd, step.args, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`✗ ${step.name} failed\n`);
  } else {
    process.stdout.write(`✓ ${step.name} passed\n`);
  }
}

for (const doc of [
  "docs/MONETIZATION_ARCHITECTURE.md",
  "docs/MONETIZATION_SAFETY_AND_ETHICS.md",
  "server/billing/service.ts",
]) {
  if (!existsSync(join(root, doc))) {
    process.stderr.write(`✗ missing ${doc}\n`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
