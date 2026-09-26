import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import demo from "../fixtures/demo-run.json" with { type: "json" };

const script = path.resolve("scripts/promote-run.ts");

test("promotion redacts phone fields before saving a local replay", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "clarity-promote-"));
  try {
    await mkdir(path.join(sandbox, "fixtures"));
    const call = structuredClone(demo.call);
    call.recipients[0]!.phones = ["+15555550101"];
    call.recipients[0]!.attempts[0]!.phone = "+15555550101";
    const source = path.join(sandbox, "capture.json");
    await writeFile(source, JSON.stringify(call));
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), script, source], {
      cwd: sandbox,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const saved = await readFile(path.join(sandbox, "fixtures/golden-run.json"), "utf8");
    assert.ok(!saved.includes("+15555550101"));
    assert.ok(saved.includes("+15555550100"));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("a rejected promotion preserves the existing fixture and does not print private numbers", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "clarity-promote-"));
  try {
    await mkdir(path.join(sandbox, "fixtures"));
    const out = path.join(sandbox, "fixtures/golden-run.json");
    await writeFile(out, "existing fixture");
    const call = structuredClone(demo.call);
    call.recipients[0]!.attempts[0]!.transcriptTurns[0]!.text = "Call me at +15555550101.";
    const source = path.join(sandbox, "capture.json");
    await writeFile(source, JSON.stringify(call));
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), script, source], {
      cwd: sandbox,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to promote/);
    assert.ok(!result.stderr.includes("+15555550101"));
    assert.equal(await readFile(out, "utf8"), "existing fixture");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
