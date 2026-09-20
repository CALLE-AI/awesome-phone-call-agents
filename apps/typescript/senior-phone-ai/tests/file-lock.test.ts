import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withFileLock } from "../lib/storage/file-lock";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

test("file lock serializes mutations and removes its lock file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "senior-phone-ai-lock-"));
  const lockPath = join(directory, "registry.lock");
  let active = 0;
  let maximumActive = 0;
  const run = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await pause(40);
    active -= 1;
  };
  try {
    await Promise.all([
      withFileLock(lockPath, run),
      withFileLock(lockPath, run),
    ]);
    assert.equal(maximumActive, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file lock recovers an abandoned stale lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "senior-phone-ai-stale-lock-"));
  const lockPath = join(directory, "registry.lock");
  try {
    await writeFile(lockPath, "abandoned", { mode: 0o600 });
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);
    assert.equal(await withFileLock(lockPath, async () => "recovered", { staleAfterMs: 10 }), "recovered");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
