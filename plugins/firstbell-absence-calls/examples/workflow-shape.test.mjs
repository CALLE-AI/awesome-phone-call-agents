/**
 * Structural checks on the workflow JSON. Run from the plugin directory:
 *
 *   node --test examples/workflow-shape.test.mjs
 *
 * Why these exist. This plugin's only entrypoint is a JSON file, and until now the
 * manifest said plainly that its importability was not claimed. That honesty was correct
 * and it left a deliverable in a directory people import from with nothing checking it at
 * all: a workflow can be well-formed JSON, pass every classifier test, and still be
 * rejected by n8n on load because a connection names a node that was renamed.
 *
 * These do not prove the workflow imports. Only an n8n instance proves that, and this
 * repository does not have one. What they prove is the class of defect that would stop it
 * importing, which is the part that can rot silently while nobody is looking: a dangling
 * connection, a duplicate name, a node with no position, a workflow with no trigger.
 *
 * The distinction is stated in `manifest.json` rather than blurred, because "validated"
 * and "imported" are different words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(
  await readFile(join(HERE, "absence-wave.workflow.json"), "utf8"),
);

const names = workflow.nodes.map((n) => n.name);

test("the file has the two collections n8n loads a workflow from", () => {
  assert.ok(Array.isArray(workflow.nodes), "nodes must be an array");
  assert.ok(workflow.nodes.length > 0, "a workflow with no nodes imports as an empty canvas");
  assert.equal(typeof workflow.connections, "object");
  assert.notEqual(workflow.connections, null);
});

test("every node carries the five fields the editor needs to draw it", () => {
  for (const node of workflow.nodes) {
    assert.equal(typeof node.name, "string", `node has no name: ${JSON.stringify(node).slice(0, 80)}`);
    assert.ok(node.name.length > 0, "a node name may not be empty");
    assert.equal(typeof node.type, "string", `${node.name} has no type`);
    assert.ok(node.type.includes("."), `${node.name} has a type with no package prefix: ${node.type}`);
    assert.equal(typeof node.typeVersion, "number", `${node.name} has no typeVersion`);
    assert.ok(Array.isArray(node.position) && node.position.length === 2,
      `${node.name} has no [x, y] position, so it lands on top of another node`);
    assert.ok(node.position.every((n) => typeof n === "number"),
      `${node.name} has a non-numeric coordinate`);
    assert.equal(typeof node.parameters, "object", `${node.name} has no parameters object`);
  }
});

test("names and ids are unique", () => {
  // n8n keys connections by name, so two nodes sharing one silently merges their wiring.
  assert.equal(new Set(names).size, names.length,
    `duplicate node name: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
  const ids = workflow.nodes.map((n) => n.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length,
    `duplicate node id: ${ids.filter((n, i) => ids.indexOf(n) !== i)}`);
});

test("no connection names a node that is not in the file", () => {
  // The defect this whole file exists for. Rename a node in the editor, export, hand-edit
  // one reference and miss another, and the workflow still parses as JSON.
  const missing = [];
  for (const [source, spec] of Object.entries(workflow.connections)) {
    if (!names.includes(source)) missing.push(`source "${source}"`);
    for (const output of spec.main ?? []) {
      for (const link of output ?? []) {
        if (!names.includes(link.node)) missing.push(`target "${link.node}" from "${source}"`);
        assert.equal(typeof link.index, "number", `link from "${source}" has no index`);
      }
    }
  }
  assert.deepEqual(missing, [], `connections point at nodes that do not exist: ${missing}`);
});

test("something can start the workflow", () => {
  const triggers = workflow.nodes.filter((n) => /trigger|webhook|cron/i.test(n.type));
  assert.ok(triggers.length > 0,
    "no trigger node, so this imports and can never run on a schedule or by hand");
});

test("every node except the triggers and the notes is reachable", () => {
  // A node nobody wires to is dead weight on the canvas and usually a wiring mistake.
  const reached = new Set();
  for (const spec of Object.values(workflow.connections)) {
    for (const output of spec.main ?? []) {
      for (const link of output ?? []) reached.add(link.node);
    }
  }
  const orphans = workflow.nodes
    .filter((n) => !/trigger|webhook|cron/i.test(n.type))
    .filter((n) => n.type !== "n8n-nodes-base.stickyNote")
    .filter((n) => !reached.has(n.name))
    .map((n) => n.name);
  assert.deepEqual(orphans, [], `nodes nothing connects to: ${orphans}`);
});

test("no credential is baked into the file", () => {
  // A workflow JSON is the thing people paste into an issue.
  const raw = JSON.stringify(workflow);
  assert.ok(!/iams_live_/.test(raw), "a live CALL-E key is embedded in the workflow");
  assert.ok(!/"credentials"\s*:\s*\{[^}]*"id"/.test(raw),
    "a credential id is embedded, which ties this template to one account");
});
