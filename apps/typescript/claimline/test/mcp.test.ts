import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ClaimLineApp } from "../src/app.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { buildTools, type ClaimlineTool } from "../src/mcp/tools.js";
import { makeApp } from "./helpers.js";

let app: ClaimLineApp;

afterEach(() => {
  app?.close();
});

function tool(tools: ClaimlineTool[], name: string): ClaimlineTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

describe("MCP tools (handlers)", () => {
  it("lists claims with masked phone numbers", async () => {
    app = makeApp();
    app.seedDemo();
    const tools = buildTools(app);

    const out = (await tool(tools, "list_claims").handler({})) as {
      claims: { claim: { reference: string; claimantPhone: string } }[];
    };
    const ravi = out.claims.find((c) => c.claim.reference === "CLM-1001")!;
    expect(ravi.claim.claimantPhone).toMatch(/^\+\*+0142$/);
    expect(ravi.claim.claimantPhone).not.toContain("2025550142");
  });

  it("creates and reads a claim by reference", async () => {
    app = makeApp();
    const tools = buildTools(app);

    const created = (await tool(tools, "create_claim").handler({
      reference: "CLM-3001",
      policyholderName: "Test User",
      claimantPhone: "+12025550100",
      incidentType: "auto_collision",
    })) as { claimantPhone: string };
    expect(created.claimantPhone).toMatch(/^\+\*+0100$/);

    const view = (await tool(tools, "get_claim").handler({
      claim: "CLM-3001",
    })) as { claim: { reference: string } };
    expect(view.claim.reference).toBe("CLM-3001");
  });

  it("previews without placing a call, then dispatches and reconciles", async () => {
    app = makeApp();
    app.seedDemo();
    const tools = buildTools(app);

    const preview = (await tool(tools, "preview_call").handler({
      claim: "CLM-1001",
      callType: "fnol",
    })) as { maskedDestination: string };
    expect(preview.maskedDestination).toMatch(/^\+\*+0142$/);

    const previewOnly = (await tool(tools, "dispatch_call").handler({
      claim: "CLM-1001",
      callType: "fnol",
    })) as { status: string; intent: { state: string; destinationPhone: string } };
    expect(previewOnly.status).toBe("preview");
    expect(previewOnly.intent.state).toBe("reserved");
    expect(previewOnly.intent.destinationPhone).toMatch(/^\+\*+0142$/);

    const dispatched = (await tool(tools, "dispatch_call").handler({
      claim: "CLM-1001",
      callType: "fnol",
      confirm: true,
      fixtureScenario: "fnol_ok",
    })) as { status: string; intent: { state: string } };
    expect(dispatched.status).toBe("submitted");

    await tool(tools, "reconcile").handler({});
    const view = (await tool(tools, "get_claim").handler({ claim: "CLM-1001" })) as {
      intents: { intent: { callType: string; state: string } }[];
    };
    const fnol = view.intents.find((i) => i.intent.callType === "fnol_intake")!;
    expect(fnol.intent.state).toBe("terminal_verified");
  });
});

describe("MCP server (client round-trip)", () => {
  it("exposes tools and returns content over a real transport", async () => {
    app = makeApp();
    app.seedDemo();
    const server = buildMcpServer(app);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain("dispatch_call");
    expect(names).toContain("reconcile");

    const res = (await client.callTool({
      name: "list_claims",
      arguments: {},
    })) as { content: { type: string; text: string }[] };
    const payload = JSON.parse(res.content[0]!.text) as {
      claims: { claim: { claimantPhone: string } }[];
    };
    expect(payload.claims.length).toBe(3);
    expect(payload.claims[0]!.claim.claimantPhone).toMatch(/^\+\*/);

    await client.close();
    await server.close();
  });
});
