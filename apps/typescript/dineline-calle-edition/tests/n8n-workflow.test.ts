import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type WorkflowNode = {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  retryOnFail?: boolean;
  maxTries?: number;
  credentials?: unknown;
};

type Workflow = {
  id: string;
  name: string;
  active: boolean;
  nodes: WorkflowNode[];
};

const loadWorkflow = (filename: string): Workflow => {
  const path = fileURLToPath(new URL(`../n8n/${filename}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Workflow;
};

const integration = loadWorkflow("dineline-calle-edition.workflow.json");
const fixture = loadWorkflow("dineline-calle-fixture-roundtrip.workflow.json");

const findNode = (workflow: Workflow, name: string): WorkflowNode => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  expect(node, `Missing n8n node: ${name}`).toBeDefined();
  return node!;
};

describe("sanitized n8n workflow artifacts", () => {
  it("keeps both workflow artifacts inactive and credential-free", () => {
    for (const workflow of [integration, fixture]) {
      expect(workflow.active).toBe(false);
      expect(workflow.nodes.every((node) => node.credentials === undefined)).toBe(true);
    }

    const serialized = JSON.stringify([integration, fixture]);
    expect(serialized).not.toMatch(/AC[a-fA-F0-9]{32}/);
    const e164Numbers = serialized.match(/\+1\d{10}/g) ?? [];
    expect(e164Numbers.length).toBeGreaterThan(0);
    expect(e164Numbers.every((number) => /^\+1\d{3}555\d{4}$/.test(number))).toBe(true);
  });

  it("removes Vapi and preserves Google Places between two bounded CALL-E stages", () => {
    const serialized = JSON.stringify(integration);
    const intake = findNode(integration, "Dispatch CALL-E Preference Agent");
    const places = findNode(integration, "Google Places Text Search");
    const booking = findNode(integration, "Dispatch CALL-E Booking");

    expect(serialized).not.toMatch(/vapi/i);
    expect(JSON.stringify(places.parameters)).toContain("GOOGLE_PLACES_API_KEY");
    for (const dispatch of [intake, booking]) {
      expect(dispatch.retryOnFail).toBe(false);
      expect(dispatch.maxTries).toBe(1);
      expect(dispatch.parameters?.options).toMatchObject({ timeout: 330_000 });
    }

    expect(findNode(integration, "Start CALL-E Dinner Plan").type).toBe(
      "n8n-nodes-base.webhook",
    );
    expect(findNode(integration, "Submit Approved Restaurant").type).toBe(
      "n8n-nodes-base.webhook",
    );
  });

  it("keeps the two-agent fixture proof bounded and reserved-number only", () => {
    const source = findNode(fixture, "Create CALL-E Intake Fixture");
    const intake = findNode(fixture, "Dispatch Intake Fixture");
    const booking = findNode(fixture, "Dispatch Booking Fixture");
    const assertion = findNode(fixture, "Assert Two Agent Round Trip");

    expect(JSON.stringify(source.parameters)).toContain("+12025550109");
    for (const dispatch of [intake, booking]) {
      expect(dispatch.retryOnFail).toBe(false);
      expect(dispatch.maxTries).toBe(1);
      expect(dispatch.parameters?.options).toMatchObject({ timeout: 150_000 });
    }
    expect(JSON.stringify(assertion.parameters)).toMatch(/verification:\s*['"]passed['"]/);
    expect(JSON.stringify(assertion.parameters)).toContain("agents: 2");
    expect(JSON.stringify(assertion.parameters)).toContain("automaticRetryAllowed");
  });
});
