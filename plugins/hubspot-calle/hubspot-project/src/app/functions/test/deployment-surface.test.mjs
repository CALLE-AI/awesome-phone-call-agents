import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const deployableExtensions = new Set([".js", ".jsx", ".json", ".mjs"]);

async function readDeployableProject(directory = appDir) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test") {
        sources.push(await readDeployableProject(path));
      }
    } else if (deployableExtensions.has(extname(entry.name))) {
      sources.push(await readFile(path, "utf8"));
    }
  }
  return sources.join("\n");
}

test("deployable project excludes legacy CRM mutation components", async () => {
  const source = await readDeployableProject();

  for (const componentUid of [
    "calle_approve_and_start_call",
    "calle_cancel_call_candidate",
    "calle_get_call_candidate",
    "calle_write_back_result",
  ]) {
    assert.doesNotMatch(source, new RegExp(componentUid));
  }

  for (const mutationHelper of [
    "patchCrmProperties",
    "createHubSpotTask",
    "createHubSpotNote",
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${mutationHelper}\\s*\\(`));
  }
});

test("generated function bundles end with exactly one newline", async () => {
  for (const bundle of [
    "createCallCandidate.bundle.js",
    "startCallFromCard.bundle.js",
  ]) {
    const source = await readFile(join(appDir, "functions", bundle), "utf8");
    assert.match(source, /[^\n]\n$/);
  }
});
