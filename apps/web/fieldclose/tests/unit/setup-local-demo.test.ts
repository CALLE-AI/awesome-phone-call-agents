import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The setup script is plain JavaScript with a side-effect-free exported
// writer; the declaration file under scripts/ types the imported function.
import { writeLocalDemoEnvironment } from "../../scripts/setup-local-demo.mjs";

const isPosix = process.platform !== "win32";

let tempDirectory = "";

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "fieldclose-setup-"));
});

afterEach(() => {
  rmSync(tempDirectory, { recursive: true, force: true });
});

function localPath() {
  return resolve(tempDirectory, ".env.local");
}

function expectOwnerOnly(path: string) {
  if (isPosix) {
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  }
}

describe("writeLocalDemoEnvironment", () => {
  it("creates a missing file with owner-only permissions", () => {
    const target = localPath();

    writeLocalDemoEnvironment(target, "BETTER_AUTH_SECRET=abc\n");

    expect(existsSync(target)).toBe(true);
    expectOwnerOnly(target);
    expect(readFileSync(target, "utf8")).toBe("BETTER_AUTH_SECRET=abc\n");
  });

  it("narrows an existing permissive file to owner-only before writing", () => {
    const target = localPath();
    writeFileSync(target, "BETTER_AUTH_SECRET=old\n", { mode: 0o644 });

    writeLocalDemoEnvironment(target, "BETTER_AUTH_SECRET=new\n");

    expectOwnerOnly(target);
    expect(readFileSync(target, "utf8")).toBe("BETTER_AUTH_SECRET=new\n");
  });

  it("narrows an existing owner-only file and writes through it", () => {
    const target = localPath();
    writeFileSync(target, "BETTER_AUTH_SECRET=old\n", { mode: 0o600 });

    writeLocalDemoEnvironment(target, "FIELDCLOSE_DATA_KEY=new\n");

    expectOwnerOnly(target);
    expect(readFileSync(target, "utf8")).toBe("FIELDCLOSE_DATA_KEY=new\n");
  });

  it("rejects a symlink target and refuses to follow it", (context) => {
    const canCreateSymlinks = isPosix;
    context.skip(!canCreateSymlinks);

    const target = localPath();
    const link = resolve(tempDirectory, ".env.local.link");
    writeFileSync(target, "secret\n", { mode: 0o600 });
    symlinkSync(target, link);

    expect(() => writeLocalDemoEnvironment(link, "BETTER_AUTH_SECRET=evil\n"))
      .toThrow(/not a regular file/);
    expect(readFileSync(target, "utf8")).toBe("secret\n");
  });

  it("rejects a directory target", () => {
    const directory = resolve(tempDirectory, "env-dir");
    mkdirSync(directory);

    expect(() => writeLocalDemoEnvironment(directory, "secret\n")).toThrow(
      /not a regular file/,
    );
  });
});
