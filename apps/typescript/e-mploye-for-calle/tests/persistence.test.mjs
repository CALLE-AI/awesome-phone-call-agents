import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "../server/persistence.mjs";

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

describe("atomic state persistence", () => {
  it("publishes complete JSON and cleans staging files", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "employe-persistence-")); dirs.push(directory);
    const file = path.join(directory, "nested", "state.json");
    writeJsonAtomic(file, { version: 1, jobs: [] });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, jobs: [] });
    expect(readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("keeps the previous snapshot if serialization fails", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "employe-persistence-")); dirs.push(directory);
    const file = path.join(directory, "state.json"); writeJsonAtomic(file, { version: 1 });
    const cyclic = {}; cyclic.self = cyclic;
    expect(() => writeJsonAtomic(file, cyclic)).toThrow();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1 });
  });
});
