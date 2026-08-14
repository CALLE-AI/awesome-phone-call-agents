/**
 * MCP server tests: JSON-RPC protocol correctness, the five caucus tools end
 * to end against a temp sqlite ledger with the mock client, the live-dial
 * safety gate, privacy of every tool output, ledger-only persistence across
 * server restarts, and the newline-delimited stream transport.
 *
 * All phone numbers are fictional (+1555…) per repository convention. No test
 * here can dial: the only CalleClients constructed are MockCalleClient and
 * in-test recording fakes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CaucusMcpServer,
  serveOverStreams,
  TOOL_DEFINITIONS,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  type JsonRpcOutbound,
} from "../src/mcp.js";
import { openLedger } from "../src/ledger.js";
import { createCase, genesisEvent } from "../src/state.js";
import { MockCalleClient, agreeableLandlord, stubbornTenant } from "../src/calle.js";
import type {
  CalleClient,
  CallResult,
  CaseRecord,
  Party,
  RenderedCall,
} from "../src/types.js";
import type { MockScript } from "../src/calle.js";

const PHONE_A = "+15550000001";
const PHONE_B = "+15550000002";

/** Deterministic clock: one minute per call, reproducible timestamps. */
function stepClock(startIso = "2026-08-01T15:00:00.000Z"): () => string {
  let t = Date.parse(startIso);
  return () => {
    const iso = new Date(t).toISOString();
    t += 60_000;
    return iso;
  };
}

const OPEN_ARGS = {
  vertical: "security_deposit",
  summary:
    "Disputed deductions from a residential security deposit after move-out.",
  amount_dollars: 1200,
  party_a: { label: "the landlord", phone: PHONE_A },
  party_b: { label: "the tenant", phone: PHONE_B },
} as const;

interface ToolResult {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Simple recording client for gate tests — responds from a fixed function. */
class RecordingClient implements CalleClient {
  readonly requests: RenderedCall[] = [];
  constructor(private readonly respond: (req: RenderedCall) => CallResult) {}
  async createAndWait(req: RenderedCall): Promise<CallResult> {
    this.requests.push(req);
    return this.respond(req);
  }
}

const consentYes = (req: RenderedCall): CallResult => ({
  callId: `fake_live_${req.idempotencyKey}`,
  outcome: "completed",
  structured: { consent: "yes", concerns: "" },
  evidence: ["Yes, I agree to take these calls."],
  transcript: [],
});

describe("caucus MCP server", () => {
  let dir: string;
  let server: CaucusMcpServer;
  let nextId = 0;

  const rpc = (method: string, params?: unknown): Promise<JsonRpcOutbound | undefined> =>
    server.handle({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method,
      ...(params === undefined ? {} : { params }),
    });

  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    on: CaucusMcpServer = server,
  ): Promise<ToolResult> => {
    const response = await on.handle({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method: "tools/call",
      params: { name, arguments: args },
    });
    expect(response?.error, `tool ${name} returned protocol error`).toBeUndefined();
    return response?.result as ToolResult;
  };

  const structured = (r: ToolResult): Record<string, unknown> => {
    expect(r.isError, `tool errored: ${r.content[0]?.text}`).not.toBe(true);
    expect(r.structuredContent).toBeDefined();
    return r.structuredContent as Record<string, unknown>;
  };

  /** Drive a case to a terminal state via repeated tools/call steps. */
  const stepToTerminal = async (
    caseId: string,
    on: CaucusMcpServer = server,
    maxSteps = 25,
  ): Promise<Record<string, unknown>[]> => {
    const steps: Record<string, unknown>[] = [];
    for (let i = 0; i < maxSteps; i += 1) {
      const step = structured(await callTool("caucus_step_case", { case_id: caseId }, on));
      steps.push(step);
      if (step["terminal"] === true || step["noop"] === true) break;
    }
    return steps;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "caucus-mcp-"));
    server = new CaucusMcpServer({
      dbPath: join(dir, "main.db"),
      env: {},
      now: stepClock(),
    });
  });

  afterEach(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // JSON-RPC protocol layer
  // -------------------------------------------------------------------------

  describe("JSON-RPC protocol layer", () => {
    it("initialize returns server info and echoes a supported protocol version", async () => {
      const response = await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      });
      expect(response?.error).toBeUndefined();
      const result = response?.result as Record<string, unknown>;
      expect(result["protocolVersion"]).toBe("2024-11-05");
      expect((result["serverInfo"] as Record<string, unknown>)["name"]).toBe("caucus");
      expect(result["capabilities"]).toHaveProperty("tools");
      expect(typeof result["instructions"]).toBe("string");
    });

    it("initialize falls back to its own version when the requested one is unknown", async () => {
      const response = await rpc("initialize", { protocolVersion: "1999-01-01" });
      const result = response?.result as Record<string, unknown>;
      expect(result["protocolVersion"]).toBe("2025-06-18");
    });

    it("responds METHOD_NOT_FOUND to unknown methods", async () => {
      const response = await rpc("resources/list");
      expect(response?.error?.code).toBe(METHOD_NOT_FOUND);
      expect(response?.error?.message).toContain("resources/list");
    });

    it("rejects batch requests and non-object messages as INVALID_REQUEST", async () => {
      const batch = await server.handle([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
      expect(batch?.error?.code).toBe(INVALID_REQUEST);
      const text = await server.handle("hello");
      expect(text?.error?.code).toBe(INVALID_REQUEST);
    });

    it("never responds to notifications or id-less requests", async () => {
      expect(
        await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
      ).toBeUndefined();
      expect(await server.handle({ jsonrpc: "2.0", method: "tools/list" })).toBeUndefined();
    });

    it("answers ping with an empty result", async () => {
      const response = await rpc("ping");
      expect(response?.error).toBeUndefined();
      expect(response?.result).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // tools/list
  // -------------------------------------------------------------------------

  describe("tools/list", () => {
    /** Recursively check a JSON-schema node is structurally sound. */
    function checkSchemaNode(node: unknown, path: string): void {
      expect(node, path).toBeTypeOf("object");
      const n = node as Record<string, unknown>;
      expect(typeof n["type"], `${path}.type`).toBe("string");
      if (n["type"] === "object") {
        const properties = n["properties"] as Record<string, unknown>;
        expect(properties, `${path}.properties`).toBeTypeOf("object");
        for (const [key, child] of Object.entries(properties)) {
          checkSchemaNode(child, `${path}.${key}`);
        }
        if (n["required"] !== undefined) {
          expect(Array.isArray(n["required"]), `${path}.required`).toBe(true);
          for (const name of n["required"] as string[]) {
            expect(Object.keys(properties), `${path}.required lists undeclared "${name}"`).toContain(
              name,
            );
          }
        }
      }
      if (n["type"] === "array") {
        checkSchemaNode(n["items"], `${path}.items`);
      }
    }

    it("lists exactly the five caucus tools with valid object input schemas", async () => {
      const response = await rpc("tools/list");
      const tools = (response?.result as { tools: Record<string, unknown>[] }).tools;
      expect(tools.map((t) => t["name"]).sort()).toEqual([
        "caucus_case_memo",
        "caucus_case_status",
        "caucus_open_case",
        "caucus_step_case",
        "caucus_verify_case",
      ]);
      for (const tool of tools) {
        const name = tool["name"] as string;
        expect((tool["description"] as string).length, `${name} description`).toBeGreaterThan(80);
        const schema = tool["inputSchema"] as Record<string, unknown>;
        expect(schema["type"], `${name} inputSchema.type`).toBe("object");
        checkSchemaNode(schema, name);
        // Every top-level property must carry a description an LLM can act on.
        for (const [prop, node] of Object.entries(schema["properties"] as Record<string, unknown>)) {
          expect(
            typeof (node as Record<string, unknown>)["description"],
            `${name}.${prop} description`,
          ).toBe("string");
        }
      }
      // tools/list must agree with the exported catalog.
      expect(tools.length).toBe(TOOL_DEFINITIONS.length);
    });

    it("tool descriptions state the safety-critical facts", async () => {
      const byName = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t.description]));
      // open_case must promise it does not dial.
      expect(byName.get("caucus_open_case")).toMatch(/NEVER places a phone call/i);
      // step_case must disclose the mock default and the double-keyed live gate.
      const step = byName.get("caucus_step_case") ?? "";
      expect(step).toMatch(/mock/i);
      expect(step).toMatch(/live:true/i);
      expect(step).toMatch(/CALLE_API_KEY/);
      expect(step).toMatch(/REAL phone call/i);
    });
  });

  // -------------------------------------------------------------------------
  // tools/call protocol errors
  // -------------------------------------------------------------------------

  describe("tools/call protocol errors", () => {
    it("unknown tool yields INVALID_PARAMS with the known-tool list", async () => {
      const response = await rpc("tools/call", { name: "caucus_dial_now", arguments: {} });
      expect(response?.error?.code).toBe(INVALID_PARAMS);
      expect(response?.error?.message).toContain("caucus_dial_now");
      const data = response?.error?.data as { knownTools: string[] };
      expect(data.knownTools).toContain("caucus_open_case");
      expect(data.knownTools.length).toBe(5);
    });

    it("missing tool name and non-object arguments yield INVALID_PARAMS", async () => {
      const noName = await rpc("tools/call", { arguments: {} });
      expect(noName?.error?.code).toBe(INVALID_PARAMS);
      const badArgs = await rpc("tools/call", { name: "caucus_case_status", arguments: "cs_x" });
      expect(badArgs?.error?.code).toBe(INVALID_PARAMS);
    });

    it("schema-invalid open_case arguments yield INVALID_PARAMS naming the bad path", async () => {
      const response = await rpc("tools/call", {
        name: "caucus_open_case",
        arguments: { ...OPEN_ARGS, party_a: { label: "the landlord", phone: "5550000001" } },
      });
      expect(response?.error?.code).toBe(INVALID_PARAMS);
      const data = response?.error?.data as { issues: { path: string; message: string }[] };
      expect(data.issues.some((i) => i.path === "party_a.phone")).toBe(true);
    });

    it("schema-invalid step_case arguments yield INVALID_PARAMS", async () => {
      const response = await rpc("tools/call", {
        name: "caucus_step_case",
        arguments: { case_id: 123 },
      });
      expect(response?.error?.code).toBe(INVALID_PARAMS);
      const data = response?.error?.data as { issues: { path: string }[] };
      expect(data.issues.some((i) => i.path === "case_id")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Tool-domain errors (inside results, per MCP convention)
  // -------------------------------------------------------------------------

  describe("tool-domain errors", () => {
    it("an unknown case id is a tool error result, not a protocol error", async () => {
      const result = await callTool("caucus_case_status", { case_id: "cs_missing" });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("no such case");
    });

    it("a sub-cent amount is refused as a tool error", async () => {
      const result = await callTool("caucus_open_case", {
        ...OPEN_ARGS,
        amount_dollars: 10.005,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("whole-cent");
    });
  });

  // -------------------------------------------------------------------------
  // Full mediation happy path
  // -------------------------------------------------------------------------

  describe("full mediation over the five tools", () => {
    it("open -> step* -> status -> verify -> memo settles a case end to end", async () => {
      // Open: registers the case, dials nothing.
      const opened = structured(await callTool("caucus_open_case", { ...OPEN_ARGS }));
      const caseId = opened["case_id"] as string;
      expect(caseId).toMatch(/^cs_/);
      expect(opened["state"]).toBe("created");
      expect(opened["epoch"]).toBe(0);
      expect(String(opened["note"])).toContain("No call was placed");
      const openedParties = opened["parties"] as { phone_masked: string }[];
      expect(openedParties.map((p) => p.phone_masked)).toEqual(["***0001", "***0002"]);

      // Step to terminal with the default mock personas.
      const steps = await stepToTerminal(caseId);
      const last = steps.at(-1)!;
      expect(last["terminal"]).toBe(true);
      expect(last["state"]).toBe("settled");
      for (const step of steps) {
        expect(step["mode"]).toBe("mock");
        const call = step["call"] as { phone_masked?: string } | null;
        if (call !== null) {
          expect(call.phone_masked).toMatch(/^\*\*\*\d{4}$/);
        }
      }
      // The protocol shape: first step is the clock tick, then consent A, consent B.
      expect(steps[0]!["summary"]).toBe("advanced clock");
      expect(steps[1]!["summary"]).toContain("consent call to party A");
      expect(steps[2]!["summary"]).toContain("consent call to party B");

      // Stepping a settled case is a harmless noop that appends nothing.
      const extra = structured(await callTool("caucus_step_case", { case_id: caseId }));
      expect(extra["noop"]).toBe(true);
      expect(extra["state"]).toBe("settled");
      expect(extra["ledger_entries_appended"]).toBe(0);

      // Status: settled, with rounds, assessment, and a dual-attested settlement.
      const status = structured(await callTool("caucus_case_status", { case_id: caseId }));
      expect(status["state"]).toBe("settled");
      expect(status["terminal"]).toBe(true);
      expect((status["rounds"] as unknown[]).length).toBeGreaterThanOrEqual(2);
      const settlement = status["settlement"] as {
        amount_cents: number;
        terms_digest: string;
        attestation_phrase: string;
        attestations: { party: string; call_id: string; verified: boolean }[];
      };
      expect(settlement.amount_cents).toBeGreaterThan(0);
      expect(settlement.amount_cents).toBeLessThanOrEqual(120_000);
      expect(settlement.terms_digest).toMatch(/^[0-9a-f]{64}$/);
      expect(settlement.attestation_phrase).toMatch(/^\d{6}$/);
      expect(settlement.attestations.map((a) => a.party).sort()).toEqual(["A", "B"]);
      expect(settlement.attestations.every((a) => a.verified)).toBe(true);
      const [attA, attB] = settlement.attestations;
      expect(attA!.call_id).not.toBe(attB!.call_id);

      // Verify: full chain + attestation checks pass.
      const verdict = structured(await callTool("caucus_verify_case", { case_id: caseId }));
      expect(verdict["verdict"]).toBe("pass");
      const ledgerInfo = verdict["ledger"] as { ok: boolean; entries: number; head_hash: string };
      expect(ledgerInfo.ok).toBe(true);
      expect(ledgerInfo.entries).toBeGreaterThan(5);
      expect(ledgerInfo.head_hash).toMatch(/^[0-9a-f]{64}$/);
      const checks = verdict["checks"] as { name: string; ok: boolean }[];
      expect(checks.length).toBeGreaterThanOrEqual(4);
      expect(checks.every((c) => c.ok)).toBe(true);
      expect(checks.map((c) => c.name)).toContain("attestation_calls_distinct");

      // Memo: markdown with the digest, the non-binding notice, masked phones.
      const memoResult = await callTool("caucus_case_memo", { case_id: caseId });
      const memo = memoResult.content[0]!.text;
      expect(memo).toContain("Settlement Memorandum");
      expect(memo).toContain(settlement.terms_digest);
      expect(memo.toLowerCase()).toContain("non-binding");
      expect(memo).toContain("***0001");
      expect((memoResult.structuredContent as { markdown: string }).markdown).toBe(memo);
    });
  });

  // -------------------------------------------------------------------------
  // No tool but step_case may dial
  // -------------------------------------------------------------------------

  describe("dialing boundaries", () => {
    it("open_case and the read-only tools place zero calls; only step_case dials the mock", async () => {
      const clients: MockCalleClient[] = [];
      const script = (rec: CaseRecord): MockScript => {
        const a = agreeableLandlord(400, 700);
        const b = stubbornTenant(rec.dispute.amountCents / 100);
        return {
          matchers: [
            { when: (r: RenderedCall) => r.callee === "A", respond: (r) => a.default!(r) },
            { when: (r: RenderedCall) => r.callee === "B", respond: (r) => b.default!(r) },
          ],
        };
      };
      const spying = new CaucusMcpServer({
        dbPath: join(dir, "spy.db"),
        env: {},
        now: stepClock(),
        makeMockClient: (rec) => {
          const client = new MockCalleClient(script(rec));
          clients.push(client);
          return client;
        },
      });
      try {
        const opened = structured(await callTool("caucus_open_case", { ...OPEN_ARGS }, spying));
        const caseId = opened["case_id"] as string;
        const placed = () => clients.reduce((n, c) => n + c.requests.length, 0);
        expect(placed()).toBe(0);

        await callTool("caucus_case_status", { case_id: caseId }, spying);
        await callTool("caucus_verify_case", { case_id: caseId }, spying);
        await callTool("caucus_case_memo", { case_id: caseId }, spying);
        expect(placed()).toBe(0);

        // First step is the created->consent tick: still no call.
        structured(await callTool("caucus_step_case", { case_id: caseId }, spying));
        expect(placed()).toBe(0);
        // Second step is the consent call to A: exactly one mock call.
        structured(await callTool("caucus_step_case", { case_id: caseId }, spying));
        expect(placed()).toBe(1);
        expect(clients.some((c) => c.requests.some((r) => r.phone === PHONE_A))).toBe(true);
      } finally {
        spying.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // The live gate
  // -------------------------------------------------------------------------

  describe("live-mode safety gate", () => {
    it("refuses live:true when CALLE_API_KEY is absent, without touching the live client", async () => {
      let liveConstructed = 0;
      const gated = new CaucusMcpServer({
        dbPath: join(dir, "gate.db"),
        env: {}, // no CALLE_API_KEY
        now: stepClock(),
        makeLiveClient: () => {
          liveConstructed += 1;
          return new RecordingClient(consentYes);
        },
      });
      try {
        const opened = structured(await callTool("caucus_open_case", { ...OPEN_ARGS }, gated));
        const caseId = opened["case_id"] as string;

        const refused = await callTool("caucus_step_case", { case_id: caseId, live: true }, gated);
        expect(refused.isError).toBe(true);
        expect(refused.content[0]?.text).toContain("CALLE_API_KEY");
        expect(refused.content[0]?.text).toContain("refusing live mode");
        expect(liveConstructed).toBe(0);

        // The refused step changed nothing.
        const status = structured(await callTool("caucus_case_status", { case_id: caseId }, gated));
        expect(status["state"]).toBe("created");
        expect(status["epoch"]).toBe(0);
      } finally {
        gated.close();
      }
    });

    it("uses the injected live client only when BOTH live:true and the key are present", async () => {
      const live = new RecordingClient(consentYes);
      let liveConstructed = 0;
      const keyed = new CaucusMcpServer({
        dbPath: join(dir, "keyed.db"),
        env: { CALLE_API_KEY: "test_key_not_real" },
        now: stepClock(),
        makeLiveClient: () => {
          liveConstructed += 1;
          return live;
        },
      });
      try {
        const opened = structured(await callTool("caucus_open_case", { ...OPEN_ARGS }, keyed));
        const caseId = opened["case_id"] as string;

        // Key present but live omitted: mock path, live factory untouched.
        const tick = structured(await callTool("caucus_step_case", { case_id: caseId }, keyed));
        expect(tick["mode"]).toBe("mock");
        expect(liveConstructed).toBe(0);

        // live:true + key: this step's consent call goes through the injected client.
        const stepped = structured(
          await callTool("caucus_step_case", { case_id: caseId, live: true }, keyed),
        );
        expect(stepped["mode"]).toBe("live");
        expect(liveConstructed).toBe(1);
        expect(live.requests.length).toBe(1);
        expect(live.requests[0]!.phone).toBe(PHONE_A);
        expect(stepped["state"]).toBe("consent_pending_b");

        // Dropping back to the default keeps the mock: live client sees nothing new.
        const mockAgain = structured(await callTool("caucus_step_case", { case_id: caseId }, keyed));
        expect(mockAgain["mode"]).toBe("mock");
        expect(live.requests.length).toBe(1);
      } finally {
        keyed.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Privacy: masked phones, no private intake data, no ZOPA
  // -------------------------------------------------------------------------

  describe("privacy of tool outputs", () => {
    it("status, verify, and memo never leak private intake data, full phones, or ZOPA", async () => {
      // Seed a case that carries party-private data directly into the ledger —
      // the MCP open tool cannot create private data, but a rehydrated case
      // (opened by the CLI, say) can carry it, and no tool output may show it.
      const dbPath = join(dir, "sentinel.db");
      const parties: [Party, Party] = [
        {
          id: "A",
          label: "the landlord",
          phone: PHONE_A,
          private: { reservationCents: 40_000, notes: "ZEPHYRQUARTZ would settle at four hundred" },
        },
        {
          id: "B",
          label: "the tenant",
          phone: PHONE_B,
          private: { reservationCents: 55_000, notes: "MARMALADEHELIX cannot afford court fees" },
        },
      ];
      const rec = createCase(
        {
          caseId: "cs_sentinel_privacy",
          dispute: {
            vertical: "security_deposit",
            summary: "Disputed deductions from a residential security deposit after move-out.",
            amountCents: 120_000,
            currency: "USD",
          },
          parties,
          policy: {
            maxRounds: 8,
            coolingOffMinutes: 0,
            callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
            retryDelaysMinutes: [],
            ttlHours: 72,
          },
        },
        "2026-08-01T15:00:00.000Z",
      );
      const seed = openLedger(dbPath);
      const genesis = genesisEvent(rec);
      seed.append({
        caseId: rec.caseId,
        epoch: rec.epoch,
        type: genesis.type,
        payload: genesis.payload,
        at: rec.createdAt,
      });
      seed.close();

      const sentinelServer = new CaucusMcpServer({
        dbPath,
        env: {},
        now: stepClock("2026-08-01T15:05:00.000Z"),
      });
      try {
        const assertClean = (text: string, where: string): void => {
          expect(text, `${where} leaks note sentinel A`).not.toContain("ZEPHYRQUARTZ");
          expect(text, `${where} leaks note sentinel B`).not.toContain("MARMALADEHELIX");
          expect(text, `${where} leaks phone A`).not.toContain(PHONE_A);
          expect(text, `${where} leaks phone B`).not.toContain(PHONE_B);
          expect(text, `${where} leaks phone digits`).not.toContain("5550000001");
          expect(text, `${where} leaks phone digits`).not.toContain("5550000002");
          expect(text, `${where} exposes a private field`).not.toContain("reservationCents");
          expect(text, `${where} exposes a private field`).not.toContain('"private"');
          expect(text, `${where} exposes a private field`).not.toContain('"notes"');
          expect(text, `${where} exposes the ZOPA estimate`).not.toContain("zopa");
        };

        // Before any step: the case is exactly what the ledger genesis carried.
        const before = structured(
          await callTool("caucus_case_status", { case_id: rec.caseId }, sentinelServer),
        );
        expect(before["state"]).toBe("created");
        assertClean(JSON.stringify(before), "status(before)");

        // Full run, then re-check every read surface.
        const steps = await stepToTerminal(rec.caseId, sentinelServer);
        expect(steps.at(-1)!["state"]).toBe("settled");
        for (const step of steps) assertClean(JSON.stringify(step), "step");

        const status = structured(
          await callTool("caucus_case_status", { case_id: rec.caseId }, sentinelServer),
        );
        assertClean(JSON.stringify(status), "status(after)");
        const parties_ = status["parties"] as { phone_masked: string }[];
        expect(parties_.map((p) => p.phone_masked)).toEqual(["***0001", "***0002"]);

        const verdict = structured(
          await callTool("caucus_verify_case", { case_id: rec.caseId }, sentinelServer),
        );
        expect(verdict["verdict"]).toBe("pass");
        assertClean(JSON.stringify(verdict), "verify");

        const memoResult = await callTool(
          "caucus_case_memo",
          { case_id: rec.caseId },
          sentinelServer,
        );
        assertClean(memoResult.content[0]!.text, "memo");
        expect(memoResult.content[0]!.text).toContain("***0001");
      } finally {
        sentinelServer.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Persistence: the ledger is the only source of truth
  // -------------------------------------------------------------------------

  describe("ledger-only persistence", () => {
    it("a fresh server on the same db resumes mid-case from the ledger and finishes it", async () => {
      const dbPath = join(dir, "resume.db");
      const first = new CaucusMcpServer({ dbPath, env: {}, now: stepClock() });
      let caseId: string;
      try {
        const opened = structured(await callTool("caucus_open_case", { ...OPEN_ARGS }, first));
        caseId = opened["case_id"] as string;
        // Advance partway: tick, consent A, consent B, round 1.
        for (let i = 0; i < 4; i += 1) {
          structured(await callTool("caucus_step_case", { case_id: caseId }, first));
        }
        const mid = structured(await callTool("caucus_case_status", { case_id: caseId }, first));
        expect(mid["state"]).toBe("rounds_active");
        expect(mid["rounds_used"]).toBe(1);
      } finally {
        first.close();
      }

      // New process, same db: the case must rehydrate from ledger entries alone.
      const second = new CaucusMcpServer({
        dbPath,
        env: {},
        now: stepClock("2026-08-01T16:00:00.000Z"),
      });
      try {
        const resumed = structured(
          await callTool("caucus_case_status", { case_id: caseId }, second),
        );
        expect(resumed["state"]).toBe("rounds_active");
        expect(resumed["rounds_used"]).toBe(1);

        const steps = await stepToTerminal(caseId, second);
        expect(steps.at(-1)!["state"]).toBe("settled");

        const verdict = structured(
          await callTool("caucus_verify_case", { case_id: caseId }, second),
        );
        expect(verdict["verdict"]).toBe("pass");
      } finally {
        second.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Stream transport
  // -------------------------------------------------------------------------

  describe("stream transport", () => {
    it("frames newline-delimited JSON-RPC, reports parse errors, and preserves order", async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const streamed = new CaucusMcpServer({
        dbPath: join(dir, "stream.db"),
        env: {},
        now: stepClock(),
      });
      let collected = "";
      output.on("data", (chunk: Buffer) => {
        collected += chunk.toString();
      });
      const handle = serveOverStreams(streamed, input, output);
      try {
        input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
        input.write("this is not json\n");
        // One message split across two chunks must still frame correctly.
        input.write('{"jsonrpc":"2.0","id":2,');
        input.write('"method":"tools/list"}\n');
        // A notification gets no response line.
        input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
        // A trailing line without a newline is flushed on stream end.
        await new Promise<void>((resolve) => {
          input.end('{"jsonrpc":"2.0","id":3,"method":"ping"}', () => resolve());
        });
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        await handle.idle();

        const lines = collected
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .map((l) => JSON.parse(l) as JsonRpcOutbound);
        expect(lines.length).toBe(4);
        expect(lines[0]!.id).toBe(1);
        expect((lines[0]!.result as Record<string, unknown>)["protocolVersion"]).toBe("2025-06-18");
        expect(lines[1]!.id).toBeNull();
        expect(lines[1]!.error?.code).toBe(PARSE_ERROR);
        expect(lines[2]!.id).toBe(2);
        expect((lines[2]!.result as { tools: unknown[] }).tools.length).toBe(5);
        expect(lines[3]!.id).toBe(3);
        expect(lines[3]!.result).toEqual({});
      } finally {
        handle.close();
        streamed.close();
      }
    });
  });
});
