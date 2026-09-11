import assert from "node:assert/strict";
import test from "node:test";
import { buildTask, fingerprint, memoryResultValidator } from "../lib/callbacks.ts";

test("callback fingerprints are stable and payload-bound", async () => {
  const first = await fingerprint({ company: "alpha", member: "m1", mode: "deposit" });
  const replay = await fingerprint({ company: "alpha", member: "m1", mode: "deposit" });
  const changed = await fingerprint({ company: "alpha", member: "m2", mode: "deposit" });
  assert.equal(first, replay);
  assert.notEqual(first, changed);
  assert.equal(first.length, 64);
});

test("memory extraction accepts typed, evidence-linked results", () => {
  const parsed = memoryResultValidator.safeParse({
    outcome: "complete",
    memory_items: [{
      type: "decision",
      title: "Ship the private beta",
      body: "The founders explicitly approved a five-team private beta.",
      status: "accepted",
      confidence: "high",
      source_excerpt: "Yes, five teams is the decision.",
      audience: ["team"],
    }],
    unresolved_questions: [],
  });
  assert.equal(parsed.success, true);
});

test("memory extraction rejects unsupported types", () => {
  const parsed = memoryResultValidator.safeParse({
    outcome: "complete",
    memory_items: [{ type: "opinion", title: "x", body: "x", status: "open", confidence: "high", source_excerpt: "x", audience: ["team"] }],
    unresolved_questions: [],
  });
  assert.equal(parsed.success, false);
});

test("call task preserves uncertainty and forbids silent commitments", () => {
  const task = buildTask({ companyName: "Acme", memberName: "Amina", mode: "deposit" });
  assert.match(task, /Never invent another teammate's belief/);
  assert.match(task, /Do not make commitments/);
  assert.match(task, /Company: Acme/);
});
