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
import { classifyRecipient, summariseWave } from "./classify.mjs";

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


test("the shipped dry run closes something, escalates something, and queues the escalation first", async () => {
  // The one test that reads the demo a judge actually runs. Everything else in this file
  // checks that the JSON is well formed; this checks that the thing it does is worth
  // watching. It exists because the safeguarding rule shipped before these shapes were
  // updated to carry parent_confirmed_aware, so all three completed rows escalated, closed
  // came out zero, and the resolution rate the plugin README describes printed as 0%. Every
  // one of the 26 tests passed while that was true, because none of them ran the shapes.
  const node = workflow.nodes.find((n) => n.name === "Create Call And Wait");
  assert.ok(node, "the node that holds the dry-run shapes is gone");

  const src = node.parameters.jsCode;
  const open = src.indexOf("const shapes = {");
  assert.ok(open !== -1, "the dry-run shapes are no longer where this test reads them");
  // Matched without a newline escape on purpose: this file is edited by scripts and an
  // escape written through one has already been silently flattened here once.
  const close = src.indexOf("  };", open);
  const literal = src.slice(open + "const shapes = ".length, close + 3).trim();
  const shapes = new Function(`return (${literal})`)();

  // The students come out of the first node, so the two lists cannot drift apart.
  const seed = workflow.nodes.find((n) => n.name === "Absence Config");
  const students = [...seed.parameters.jsCode.matchAll(/id:\s*"(S-\d+)"/g)].map((m) => m[1]);
  assert.ok(students.length >= 5, `only ${students.length} students in the roster`);
  assert.ok(seed, "the node that holds the roster is gone");

  const consented = [...seed.parameters.jsCode.matchAll(/id:\s*"(S-\d+)"[^}]*consent:\s*(true|false)/g)];
  const rows = consented.map(([, id, consent]) => {
    if (consent === "false") return { id, resolution: "skipped" };
    const shape = shapes[id] ?? { status: "completed", structured_result: null };
    const attempts = Array.from({ length: shape.attempts ?? 1 }, (_, i) => ({
      provider_call_id: `dry_${id}_${i + 1}`,
    }));
    return { id, ...classifyRecipient({ ...shape, attempts }) };
  });

  const summary = summariseWave(rows);
  assert.ok(summary.closed > 0,
    `the shipped demo closes ${summary.closed} of ${summary.attempted}, so a judge importing it sees the whole roster land on the human queue`);
  assert.equal(summary.escalated, 1,
    "the demo should show the safeguarding path exactly once, so it is legible");
  assert.ok(summary.resolutionRate > 0, "resolution rate prints as zero");
  assert.equal(summary.queue[0].escalation, "safeguarding",
    "the escalated row is not at the top of the queue a person works from");

  // All three resolutions plus a skip, so the demo shows the whole vocabulary.
  assert.deepEqual(
    Object.entries(summary.counts).filter(([, n]) => n === 0).map(([k]) => k),
    [],
    "an outcome the classifier can produce never appears in the shipped demo",
  );

  // The README tells a reader what this run prints. Those numbers come from here, so they
  // are read back out of it rather than repeated in this file: a gate holding its own copy
  // of the quantity it checks agrees with itself forever.
  const readme = await readFile(join(HERE, "..", "README.md"), "utf8");
  const stated = readme.match(
    /(\w+) attempted, (\w+) closed, a\s+resolution rate of (\d+) percent/,
  );
  assert.ok(stated, "the README no longer states what the dry run prints, so nothing checks it");

  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const spoken = (w) => (/^\d+$/.test(w) ? Number(w) : words[w.toLowerCase()]);

  assert.equal(spoken(stated[1]), summary.attempted,
    `the README says ${stated[1]} attempted; the run attempts ${summary.attempted}`);
  assert.equal(spoken(stated[2]), summary.closed,
    `the README says ${stated[2]} closed; the run closes ${summary.closed}`);
  assert.equal(Number(stated[3]), Math.round(summary.resolutionRate * 100),
    `the README says ${stated[3]} percent; the run reports ` +
    `${Math.round(summary.resolutionRate * 100)}`);
});
