#!/usr/bin/env node
/**
 * CALL-E health gate — run before hackathon demo or PR.
 * Usage: node scripts/calle-health-gate.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const steps = [
  { name: "typecheck", cmd: "pnpm", args: ["check"] },
  {
    name: "calle-tests",
    cmd: "pnpm",
    args: ["exec", "vitest", "run", "tests/calle-workflow.test.ts", "tests/calle-v2.test.ts", "tests/calle-v3.test.ts", "tests/calle-v4.test.ts", "tests/calle-v5.test.ts", "tests/hackathon-e2e.test.ts", "tests/architecture-guard.test.ts", "tests/calle-lifecycle-e2e.test.ts", "tests/calle.core.test.ts", "tests/calle.utilities.test.ts", "tests/calle.router.test.ts", "tests/calle-v4-api.test.ts", "tests/calle-v4.integration.test.ts"],
  },
];

let failed = false;
for (const step of steps) {
  process.stdout.write(`\n▶ ${step.name}...\n`);
  const result = spawnSync(step.cmd, step.args, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`✗ ${step.name} failed\n`);
  } else {
    process.stdout.write(`✓ ${step.name} passed\n`);
  }
}

const progressPath = join(root, "docs", "calle-v5", "progress.md");
if (!existsSync(progressPath)) {
  process.stderr.write("✗ missing docs/calle-v5/progress.md\n");
  failed = true;
}

process.exit(failed ? 1 : 0);
