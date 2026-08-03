import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { resolvePublicDirectory } from "../src/public-dir.js";

function writePublicTree(publicDir: string): void {
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "index.html"), "<!DOCTYPE html><title>DrillSignal</title>");
}

test("resolvePublicDirectory prefers sibling public/ for compiled dist layout", () => {
  const root = mkdtempSync(join(tmpdir(), "drill-public-dist-"));
  try {
    const distDir = join(root, "dist");
    mkdirSync(distDir, { recursive: true });
    writePublicTree(join(distDir, "public"));
    writeFileSync(join(distDir, "server.js"), "// compiled server");

    const resolved = resolvePublicDirectory(pathToFileURL(join(distDir, "server.js")).href);
    assert.equal(resolved, join(distDir, "public"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePublicDirectory uses parent public/ for dev src layout", () => {
  const root = mkdtempSync(join(tmpdir(), "drill-public-src-"));
  try {
    const srcDir = join(root, "src");
    mkdirSync(srcDir, { recursive: true });
    writePublicTree(join(root, "public"));
    writeFileSync(join(srcDir, "server.ts"), "// dev server");

    const resolved = resolvePublicDirectory(pathToFileURL(join(srcDir, "server.ts")).href);
    assert.equal(resolved, join(root, "public"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePublicDirectory fails clearly when no public directory exists", () => {
  const root = mkdtempSync(join(tmpdir(), "drill-public-missing-"));
  try {
    const distDir = join(root, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "server.js"), "// compiled server");

    assert.throws(
      () => resolvePublicDirectory(pathToFileURL(join(distDir, "server.js")).href),
      /static assets not found/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
