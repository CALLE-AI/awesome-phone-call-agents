/**
 * Caucus MCP server — lets ANY agent stack drive a mediation over five tools.
 *
 * The Model Context Protocol layer is implemented by hand: JSON-RPC 2.0
 * messages, newline-delimited, over injectable read/write streams (stdio in
 * production). No SDK dependency — the protocol surface Caucus needs
 * (initialize, tools/list, tools/call) is small enough to state exactly, and
 * implementing it directly keeps this file auditable to the same standard as
 * the state machine it fronts.
 *
 * Safety invariants, mirrored from the CLI and enforced here:
 *  - `caucus_open_case` NEVER dials. The first calls of any case are consent
 *    calls, and calls only happen inside `caucus_step_case`.
 *  - `caucus_step_case` uses a deterministic mock client unless BOTH
 *    `live: true` is passed AND `CALLE_API_KEY` is set on the server process.
 *    There is no other path to a real dial.
 *  - Tool outputs are built field-by-field, never by spreading a CaseRecord:
 *    phone numbers are always masked to their last four digits, and
 *    party-private intake data (reservation bounds, notes) is never
 *    serialized into any tool result. The engine's ZOPA estimate is likewise
 *    omitted from status output because it derives from private bounds.
 *
 * Persistence is the hash-chained ledger itself: cases are cached in memory
 * and rehydrated from the ledger after a restart (`rehydrate`), so the MCP
 * server adds no second source of truth. The one ledger-silent transition
 * (created -> consent_pending_a) is re-derived by re-ticking, exactly as the
 * state machine documents.
 */

import { randomUUID } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";

import type { CalleClient, CasePolicy, CaseRecord, Party, PartyId } from "./types.js";
import { openLedger, type Ledger } from "./ledger.js";
import { createCase, genesisEvent, isTerminal, rehydrate } from "./state.js";
import { runStep } from "./runner.js";
import { assess } from "./engine.js";
import { maskPhone, renderMemo } from "./memo.js";
import { verifySpokenPhrase } from "./attest.js";
import {
  agreeableLandlord,
  MockCalleClient,
  RealCalleClient,
  stubbornTenant,
  type MockScript,
} from "./calle.js";

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 plumbing
// ---------------------------------------------------------------------------

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcOutbound {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

function ok(id: JsonRpcId, result: unknown): JsonRpcOutbound {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcOutbound {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Tool argument schemas (zod validates; JSON Schema below documents)
// ---------------------------------------------------------------------------

const E164_RE = /^\+[1-9]\d{6,14}$/;

const partyArg = z.object({
  label: z.string().min(1),
  phone: z.string().regex(E164_RE, "must be E.164, e.g. +15550000001"),
});

const policyArg = z.object({
  max_rounds: z.number().int().min(1).max(100).optional(),
  cooling_off_minutes: z.number().min(0).optional(),
  ttl_hours: z.number().positive().optional(),
  call_window: z
    .object({
      start_hour: z.number().int().min(0).max(23),
      end_hour: z.number().int().min(0).max(24),
      timezone: z.string().min(1),
    })
    .optional(),
  retry_delays_minutes: z.array(z.number().min(0)).optional(),
});

const openCaseArgs = z.object({
  vertical: z.string().min(1),
  summary: z.string().min(1),
  amount_dollars: z.number().positive(),
  party_a: partyArg,
  party_b: partyArg,
  policy: policyArg.optional(),
});

const stepCaseArgs = z.object({
  case_id: z.string().min(1),
  live: z.boolean().optional(),
});

const caseIdArgs = z.object({ case_id: z.string().min(1) });

type OpenCaseArgs = z.infer<typeof openCaseArgs>;
type StepCaseArgs = z.infer<typeof stepCaseArgs>;
type CaseIdArgs = z.infer<typeof caseIdArgs>;

/** Whole-cent dollars -> integer cents; null for non-finite/sub-cent/non-positive. */
function dollarsToCents(dollars: number): number | null {
  if (!Number.isFinite(dollars)) return null;
  const cents = Math.round(dollars * 100);
  if (Math.abs(dollars * 100 - cents) > 0.01) return null;
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

// ---------------------------------------------------------------------------
// Tool catalog (names, LLM-facing descriptions, JSON input schemas)
// ---------------------------------------------------------------------------

const PHONE_SCHEMA = {
  type: "string",
  description:
    "This party's phone number in E.164 format, e.g. +15550000001. In live mode this exact " +
    "number is dialed for real — verify it with the party before opening a case.",
};

const LABEL_SCHEMA = {
  type: "string",
  description:
    'How the neutral mediator refers to this party on calls, e.g. "the landlord" or ' +
    '"Alex from Sunrise LLC". It is spoken aloud to BOTH parties, so it must not contain ' +
    "anything one party considers private.",
};

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "caucus_open_case",
    description:
      "Open a new Caucus mediation case for a two-party money dispute. Registers the dispute, " +
      "both parties, and the case policy, and appends the genesis entry to the tamper-evident " +
      "hash-chained ledger. This tool NEVER places a phone call — dialing only ever happens " +
      "inside caucus_step_case, and the first two calls of every case ask each party for " +
      "recorded consent. Returns the case_id that every other caucus tool takes. Precondition " +
      "you must satisfy before calling: BOTH parties have already agreed, outside this system, " +
      "to attempt phone mediation. Never open a case to pressure one party who has not agreed " +
      "— Caucus refuses to act as a one-sided collections tool.",
    inputSchema: {
      type: "object",
      properties: {
        vertical: {
          type: "string",
          description:
            'Dispute category slug, e.g. "security_deposit", "unpaid_invoice", ' +
            '"freight_detention". Free-form; used for labeling, not logic.',
        },
        summary: {
          type: "string",
          description:
            "One neutral sentence describing the dispute that BOTH parties would agree with. " +
            "It is read aloud to each party on every call. State the disagreement " +
            '("disputed deductions from a residential security deposit after move-out"), ' +
            'never one side\'s claim ("tenant damaged the unit").',
        },
        amount_dollars: {
          type: "number",
          description:
            "Total amount in dispute in US dollars, e.g. 1200 or 1200.50. Must be positive and " +
            "whole-cent. All offers in the mediation must fall within [0, this amount].",
        },
        party_a: {
          type: "object",
          description:
            "The first party. Party A receives the first consent call, the odd-numbered " +
            "shuttle rounds, and the first attestation call.",
          properties: { label: LABEL_SCHEMA, phone: PHONE_SCHEMA },
          required: ["label", "phone"],
        },
        party_b: {
          type: "object",
          description:
            "The second party. Party B receives the second consent call, the even-numbered " +
            "shuttle rounds, and the second attestation call.",
          properties: { label: LABEL_SCHEMA, phone: PHONE_SCHEMA },
          required: ["label", "phone"],
        },
        policy: {
          type: "object",
          description:
            "Optional policy overrides. Defaults: max_rounds 8, ttl_hours 72, " +
            "cooling_off_minutes 0, call window 09:00-20:00 America/New_York, " +
            "retry_delays_minutes [15, 60].",
          properties: {
            max_rounds: {
              type: "integer",
              description: "Maximum shuttle rounds before the case is declared an impasse.",
            },
            cooling_off_minutes: {
              type: "number",
              description: "Minutes between shuttle rounds (cooling-off). 0 for demos.",
            },
            ttl_hours: {
              type: "number",
              description: "Case time-to-live in hours; an unfinished case expires after this.",
            },
            call_window: {
              type: "object",
              description: "Local quiet hours: dialing only inside [start_hour, end_hour).",
              properties: {
                start_hour: { type: "integer", description: "Earliest local hour to dial (0-23)." },
                end_hour: { type: "integer", description: "Local hour dialing must stop (0-24)." },
                timezone: { type: "string", description: 'IANA timezone, e.g. "America/New_York".' },
              },
              required: ["start_hour", "end_hour", "timezone"],
            },
            retry_delays_minutes: {
              type: "array",
              description:
                "Retry ladder for unanswered calls, in minutes after each attempt. " +
                "Empty array = single attempt.",
              items: { type: "number" },
            },
          },
        },
      },
      required: ["vertical", "summary", "amount_dollars", "party_a", "party_b"],
    },
  },
  {
    name: "caucus_step_case",
    description:
      "Advance a mediation case by exactly ONE step. One step is one phone call (a consent " +
      "call, a shuttle call relaying the other side's offer, or a settlement attestation " +
      "call) or one clock tick (no call). Call this repeatedly — checking the returned state " +
      "each time — until state is terminal (settled, impasse, declined_consent, expired, " +
      "cancelled) or noop is true. When noop is true the step changed nothing (a no-answer " +
      "waiting out its retry window, or a terminal case): STOP looping and inspect " +
      "caucus_case_status instead of immediately calling again. By default every step runs " +
      "against a deterministic MOCK phone client that simulates both parties and never dials " +
      "anyone. Passing live:true places a REAL phone call that rings a real human and costs " +
      "money; it is refused with an error unless the server process also has CALLE_API_KEY " +
      "set. Steps are deliberately one-at-a-time: never hand a loop unbounded authority to " +
      "dial strangers.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "Case id returned by caucus_open_case." },
        live: {
          type: "boolean",
          description:
            "DANGER — real side effects. When true, this step places a REAL phone call to a " +
            "real person. Refused unless the server process has CALLE_API_KEY set. Default " +
            "false: a deterministic mock client simulates the callee and nothing is dialed.",
        },
      },
      required: ["case_id"],
    },
  },
  {
    name: "caucus_case_status",
    description:
      "Inspect a mediation case without side effects: state machine position, epoch, dispute, " +
      "parties (phone numbers ALWAYS masked to last four digits), per-round offer history, " +
      "the negotiation engine's assessment (impasse detection, neutral midpoint suggestion, " +
      "concession curve), and the settlement with attestation records once one exists. Never " +
      "includes party-private intake data or reservation bounds — everything in this output " +
      "is already known to both parties or derived from what they openly offered.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "Case id returned by caucus_open_case." },
      },
      required: ["case_id"],
    },
  },
  {
    name: "caucus_verify_case",
    description:
      "Independently verify a mediation case and return a structured verdict. Recomputes the " +
      "entire hash-chained ledger for the case (every entry's SHA-256 and prev-hash link — " +
      "any tampered byte breaks the chain) and checks each party's spoken attestation " +
      "read-back against the settlement's digest-derived confirmation code, including that " +
      "the two attestations came from two distinct calls. Use after a case settles, before " +
      "presenting results to anyone, or whenever tampering is suspected. verdict is " +
      '"pass" only when every check passes.',
    inputSchema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "Case id returned by caucus_open_case." },
      },
      required: ["case_id"],
    },
  },
  {
    name: "caucus_case_memo",
    description:
      "Render the case's settlement memorandum as markdown: parties (phones masked), " +
      "round-by-round offer history with verbatim evidence quotes, settlement terms, the " +
      "SHA-256 terms digest, attestation records, ledger head hash, and a mandatory " +
      "non-binding notice. Works at any case state — before settlement it documents the " +
      "rounds so far and states plainly that no settlement was reached. Deliver the SAME " +
      "memo to both parties; it contains nothing either party may not see.",
    inputSchema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "Case id returned by caucus_open_case." },
      },
      required: ["case_id"],
    },
  },
];

const TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map((t) => t.name));

// ---------------------------------------------------------------------------
// Default mock personas
// ---------------------------------------------------------------------------

/**
 * Deterministic two-party script for mock mode, scaled to the disputed amount
 * so that a default-policy case (max_rounds 8) reaches settlement: party A
 * opens at ~45% of the total and concedes upward toward a ~60% ceiling; party
 * B opens at the full amount and concedes ~20% per own round. These are DEMO
 * personas — they exercise the full protocol (consent, shuttle rounds,
 * accept, dual attestation) without dialing anyone; they are not a model of
 * real negotiators.
 */
function defaultMockScript(rec: CaseRecord): MockScript {
  const totalDollars = rec.dispute.amountCents / 100;
  const partyA = agreeableLandlord(
    Math.max(1, Math.round(totalDollars * 0.45)),
    Math.max(1, Math.round(totalDollars * 0.6)),
  );
  const partyB = stubbornTenant(Math.max(1, Math.round(totalDollars)));
  const respondA = partyA.default;
  const respondB = partyB.default;
  /* c8 ignore next 3 — personas always define default responders */
  if (respondA === undefined || respondB === undefined) {
    throw new Error("defaultMockScript: personas must provide default responders");
  }
  return {
    matchers: [
      { when: (req) => req.callee === "A", respond: respondA },
      { when: (req) => req.callee === "B", respond: respondB },
    ],
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface CaucusMcpServerOptions {
  /** Path to the sqlite ledger database (created if absent). */
  dbPath: string;
  /** Environment for the CALLE_API_KEY live gate. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Clock. Defaults to real time; tests inject a deterministic one. */
  now?: () => string;
  /** Factory for the live client. Called only after the live gate passes. */
  makeLiveClient?: () => CalleClient;
  /** Factory for the per-case mock client. Defaults to the scripted personas. */
  makeMockClient?: (rec: CaseRecord) => CalleClient;
}

interface CaseSlot {
  rec: CaseRecord;
  mock: CalleClient;
}

interface ToolOutcome {
  text: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
}

function toolError(message: string): ToolOutcome {
  return { text: message, isError: true };
}

function jsonOutcome(structured: Record<string, unknown>): ToolOutcome {
  return { structured, text: JSON.stringify(structured, null, 2) };
}

const SUPPORTED_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
]);
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export class CaucusMcpServer {
  private readonly ledger: Ledger;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => string;
  private readonly makeLiveClient: () => CalleClient;
  private readonly makeMockClient: (rec: CaseRecord) => CalleClient;
  private readonly cases = new Map<string, CaseSlot>();

  constructor(options: CaucusMcpServerOptions) {
    this.ledger = openLedger(options.dbPath);
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date().toISOString());
    this.makeLiveClient =
      options.makeLiveClient ??
      (() => new RealCalleClient({ apiKey: this.env["CALLE_API_KEY"] ?? "" }));
    this.makeMockClient = options.makeMockClient ?? ((rec) => new MockCalleClient(defaultMockScript(rec)));
  }

  close(): void {
    this.ledger.close();
  }

  /**
   * Handle one JSON-RPC message. Returns the response object, or undefined
   * when the message was a notification (which never gets a response).
   * Transport-independent: tests call this directly.
   */
  async handle(message: unknown): Promise<JsonRpcOutbound | undefined> {
    if (Array.isArray(message)) {
      return rpcError(null, INVALID_REQUEST, "batch requests are not supported");
    }
    if (!isPlainObject(message)) {
      return rpcError(null, INVALID_REQUEST, "request must be a JSON object");
    }
    const hasId = Object.hasOwn(message, "id");
    const rawId = message["id"];
    const id: JsonRpcId =
      typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
    const method = message["method"];

    if (message["jsonrpc"] !== "2.0" || typeof method !== "string") {
      return hasId
        ? rpcError(id, INVALID_REQUEST, 'request requires jsonrpc:"2.0" and a string method')
        : undefined;
    }
    // Notifications (no id) never get a response, even on error.
    if (!hasId || method.startsWith("notifications/")) {
      return undefined;
    }

    try {
      switch (method) {
        case "initialize":
          return ok(id, this.initializeResult(message["params"]));
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, {
            tools: TOOL_DEFINITIONS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        case "tools/call":
          return await this.callTool(id, message["params"]);
        default:
          return rpcError(id, METHOD_NOT_FOUND, `method not found: ${method}`);
      }
    } catch (err) {
      return rpcError(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
    }
  }

  private initializeResult(params: unknown): Record<string, unknown> {
    const requested = isPlainObject(params) ? params["protocolVersion"] : undefined;
    const protocolVersion =
      typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "caucus", version: "0.1.0" },
      instructions:
        "Caucus mediates a two-party money dispute over phone calls: caucus_open_case " +
        "registers the case (never dials), then caucus_step_case advances it one call at a " +
        "time — consent calls to both parties first, then alternating shuttle calls relaying " +
        "typed offers, then two attestation calls confirming a digest-derived code. Steps run " +
        "against a mock phone client unless live:true AND CALLE_API_KEY are both present. " +
        "Statuses, verdicts and memos always mask phone numbers and never contain " +
        "party-private data.",
    };
  }

  private async callTool(id: JsonRpcId, params: unknown): Promise<JsonRpcOutbound> {
    if (!isPlainObject(params) || typeof params["name"] !== "string") {
      return rpcError(id, INVALID_PARAMS, "tools/call requires params.name (string)");
    }
    const name = params["name"];
    if (!TOOL_NAMES.has(name)) {
      return rpcError(id, INVALID_PARAMS, `unknown tool: ${name}`, {
        knownTools: [...TOOL_NAMES],
      });
    }
    const rawArgs = params["arguments"] ?? {};
    if (!isPlainObject(rawArgs)) {
      return rpcError(id, INVALID_PARAMS, "params.arguments must be an object");
    }

    const invalid = (error: z.ZodError): JsonRpcOutbound =>
      rpcError(id, INVALID_PARAMS, `invalid arguments for ${name}`, {
        issues: error.issues.map((i) => ({
          path: i.path.map(String).join("."),
          message: i.message,
        })),
      });

    let outcome: ToolOutcome;
    try {
      switch (name) {
        case "caucus_open_case": {
          const parsed = openCaseArgs.safeParse(rawArgs);
          if (!parsed.success) return invalid(parsed.error);
          outcome = this.openCase(parsed.data);
          break;
        }
        case "caucus_step_case": {
          const parsed = stepCaseArgs.safeParse(rawArgs);
          if (!parsed.success) return invalid(parsed.error);
          outcome = await this.stepCase(parsed.data);
          break;
        }
        case "caucus_case_status": {
          const parsed = caseIdArgs.safeParse(rawArgs);
          if (!parsed.success) return invalid(parsed.error);
          outcome = this.caseStatus(parsed.data);
          break;
        }
        case "caucus_verify_case": {
          const parsed = caseIdArgs.safeParse(rawArgs);
          if (!parsed.success) return invalid(parsed.error);
          outcome = this.verifyCase(parsed.data);
          break;
        }
        case "caucus_case_memo": {
          const parsed = caseIdArgs.safeParse(rawArgs);
          if (!parsed.success) return invalid(parsed.error);
          outcome = this.caseMemo(parsed.data);
          break;
        }
        /* c8 ignore next 2 — unreachable behind the TOOL_NAMES membership check */
        default:
          return rpcError(id, INVALID_PARAMS, `unknown tool: ${name}`);
      }
    } catch (err) {
      // Tool-domain failure: reported inside the result so the calling LLM
      // can read it, per MCP convention. Protocol-level errors stay JSON-RPC.
      outcome = toolError(`${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return ok(id, {
      content: [{ type: "text", text: outcome.text }],
      ...(outcome.structured === undefined ? {} : { structuredContent: outcome.structured }),
      ...(outcome.isError === true ? { isError: true } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // Case loading (memory cache over ledger rehydration)
  // -------------------------------------------------------------------------

  private loadCase(caseId: string): CaseSlot | null {
    const cached = this.cases.get(caseId);
    if (cached !== undefined) return cached;
    const entries = this.ledger.entries(caseId);
    if (entries.length === 0) return null;
    const rec = rehydrate(caseId, entries);
    const slot: CaseSlot = { rec, mock: this.makeMockClient(rec) };
    this.cases.set(caseId, slot);
    return slot;
  }

  // -------------------------------------------------------------------------
  // Tool implementations
  // -------------------------------------------------------------------------

  private openCase(args: OpenCaseArgs): ToolOutcome {
    const amountCents = dollarsToCents(args.amount_dollars);
    if (amountCents === null) {
      return toolError(
        `amount_dollars must be a positive whole-cent dollar amount (e.g. 1200 or 1200.50); got ${args.amount_dollars}`,
      );
    }
    const policy: CasePolicy = {
      maxRounds: args.policy?.max_rounds ?? 8,
      coolingOffMinutes: args.policy?.cooling_off_minutes ?? 0,
      callWindow:
        args.policy?.call_window !== undefined
          ? {
              startHour: args.policy.call_window.start_hour,
              endHour: args.policy.call_window.end_hour,
              timezone: args.policy.call_window.timezone,
            }
          : { startHour: 9, endHour: 20, timezone: "America/New_York" },
      retryDelaysMinutes: args.policy?.retry_delays_minutes ?? [15, 60],
      ttlHours: args.policy?.ttl_hours ?? 72,
    };
    const parties: [Party, Party] = [
      { id: "A", label: args.party_a.label, phone: args.party_a.phone, private: {} },
      { id: "B", label: args.party_b.label, phone: args.party_b.phone, private: {} },
    ];
    const caseId = `cs_${randomUUID()}`;
    const rec = createCase(
      {
        caseId,
        dispute: {
          vertical: args.vertical,
          summary: args.summary,
          amountCents,
          currency: "USD",
        },
        parties,
        policy,
      },
      this.now(),
    );
    const genesis = genesisEvent(rec);
    this.ledger.append({
      caseId,
      epoch: rec.epoch,
      type: genesis.type,
      payload: genesis.payload,
      at: rec.createdAt,
    });
    this.cases.set(caseId, { rec, mock: this.makeMockClient(rec) });

    return jsonOutcome({
      case_id: caseId,
      state: rec.state,
      epoch: rec.epoch,
      dispute: {
        vertical: rec.dispute.vertical,
        summary: rec.dispute.summary,
        amount_cents: rec.dispute.amountCents,
        currency: rec.dispute.currency,
      },
      parties: rec.parties.map((p) => ({
        id: p.id,
        label: p.label,
        phone_masked: maskPhone(p.phone),
      })),
      policy: {
        max_rounds: policy.maxRounds,
        cooling_off_minutes: policy.coolingOffMinutes,
        ttl_hours: policy.ttlHours,
        call_window: {
          start_hour: policy.callWindow.startHour,
          end_hour: policy.callWindow.endHour,
          timezone: policy.callWindow.timezone,
        },
        retry_delays_minutes: policy.retryDelaysMinutes,
      },
      note:
        "No call was placed. Advance the case with caucus_step_case; the first two calls " +
        "ask each party for recorded consent, and a 'no' ends the case.",
    });
  }

  private async stepCase(args: StepCaseArgs): Promise<ToolOutcome> {
    const slot = this.loadCase(args.case_id);
    if (slot === null) return toolError(`no such case: ${args.case_id}`);

    const live = args.live === true;
    let client: CalleClient;
    if (live) {
      // SAFETY GATE: a real dial requires BOTH the explicit live flag AND a key.
      const key = this.env["CALLE_API_KEY"];
      if (typeof key !== "string" || key.length === 0) {
        return toolError(
          "refusing live mode: CALLE_API_KEY is not set on the server process. Real dialing " +
            "requires BOTH live:true AND that environment variable — neither alone dials. " +
            "Omit live (or pass live:false) to run this step against the deterministic mock " +
            "client, which never places calls.",
        );
      }
      client = this.makeLiveClient();
    } else {
      client = slot.mock;
    }

    const step = await runStep({
      rec: slot.rec,
      client,
      ledger: this.ledger,
      now: this.now(),
    });
    slot.rec = step.rec;

    const purpose = step.call?.metadata["purpose"] ?? null;
    return jsonOutcome({
      case_id: args.case_id,
      mode: live ? "live" : "mock",
      summary: step.summary,
      noop: step.noop,
      state: step.rec.state,
      epoch: step.rec.epoch,
      terminal: isTerminal(step.rec.state),
      rounds_completed: step.rec.rounds.length,
      call:
        step.call === undefined
          ? null
          : {
              purpose,
              round: step.call.round,
              callee: step.call.callee,
              phone_masked: maskPhone(step.call.phone),
            },
      result:
        step.result === undefined
          ? null
          : { call_id: step.result.callId, outcome: step.result.outcome },
      ledger_entries_appended: step.appended.length,
    });
  }

  private caseStatus(args: CaseIdArgs): ToolOutcome {
    const slot = this.loadCase(args.case_id);
    if (slot === null) return toolError(`no such case: ${args.case_id}`);
    const rec = slot.rec;
    const assessment = assess(rec);
    const settlement = rec.settlement;

    // Built field-by-field on purpose: nothing party-private (reservation
    // bounds, intake notes) and no full phone number can reach this output.
    // assessment.zopa is likewise omitted — it derives from private bounds.
    return jsonOutcome({
      case_id: rec.caseId,
      state: rec.state,
      terminal: isTerminal(rec.state),
      epoch: rec.epoch,
      created_at: rec.createdAt,
      updated_at: rec.updatedAt,
      dispute: {
        vertical: rec.dispute.vertical,
        summary: rec.dispute.summary,
        amount_cents: rec.dispute.amountCents,
        currency: rec.dispute.currency,
      },
      parties: rec.parties.map((p) => ({
        id: p.id,
        label: p.label,
        phone_masked: maskPhone(p.phone),
      })),
      rounds_used: rec.rounds.length,
      max_rounds: rec.policy.maxRounds,
      rounds: [...rec.rounds]
        .sort((a, b) => a.n - b.n)
        .map((r) => ({
          n: r.n,
          callee: r.callee,
          outcome: r.outcome,
          offer:
            r.offer === undefined
              ? null
              : {
                  kind: r.offer.kind,
                  amount_cents: r.offer.amountCents ?? null,
                  conditions: [...r.offer.conditions],
                  public_rationale: r.offer.publicRationale ?? null,
                  evidence: [...r.offer.evidence],
                },
        })),
      assessment: {
        impasse: assessment.impasse,
        impasse_reason: assessment.impasseReason ?? null,
        next_suggestion_cents: assessment.nextSuggestionCents ?? null,
        curve: assessment.curve.map((c) => ({
          round: c.round,
          party: c.party,
          amount_cents: c.amountCents,
        })),
      },
      settlement:
        settlement === undefined
          ? null
          : {
              amount_cents: settlement.amountCents,
              conditions: [...settlement.conditions],
              terms_digest: settlement.termsDigest,
              attestation_phrase: settlement.attestationPhrase,
              attestations: (["A", "B"] as const).flatMap((party: PartyId) => {
                const att = settlement.attestations[party];
                return att === undefined
                  ? []
                  : [
                      {
                        party,
                        call_id: att.callId,
                        spoken_phrase: att.spokenPhrase,
                        verified: att.verified,
                        at: att.at,
                      },
                    ];
              }),
            },
    });
  }

  private verifyCase(args: CaseIdArgs): ToolOutcome {
    const slot = this.loadCase(args.case_id);
    if (slot === null) return toolError(`no such case: ${args.case_id}`);
    const rec = slot.rec;
    const entries = this.ledger.entries(args.case_id);
    const chain = this.ledger.verifyChain(args.case_id);

    const checks: { name: string; ok: boolean; detail: string }[] = [];
    checks.push({
      name: "ledger_chain",
      ok: chain.ok,
      detail: chain.ok
        ? `all ${entries.length} entries hash-verified back to genesis`
        : `chain broken at seq ${chain.brokenAtSeq ?? "?"}`,
    });

    const settlement = rec.settlement;
    if (settlement === undefined) {
      checks.push({
        name: "settlement_present",
        ok: rec.state !== "settled",
        detail:
          rec.state === "settled"
            ? "case is settled but carries no settlement record"
            : `no settlement yet (state: ${rec.state}) — nothing to attest`,
      });
    } else {
      for (const party of ["A", "B"] as const) {
        const att = settlement.attestations[party];
        if (att === undefined) {
          checks.push({
            name: `attestation_${party}`,
            ok: rec.state !== "settled",
            detail:
              rec.state === "settled"
                ? "missing on a settled case"
                : `not yet recorded (state: ${rec.state})`,
          });
          continue;
        }
        const verification = verifySpokenPhrase(settlement.attestationPhrase, att.spokenPhrase);
        const pass = verification.match && att.verified;
        checks.push({
          name: `attestation_${party}`,
          ok: pass,
          detail:
            `spoken ${JSON.stringify(att.spokenPhrase)} vs code "${settlement.attestationPhrase}": ` +
            `${verification.match ? "match" : "MISMATCH"}` +
            `${att.verified ? "" : " (recorded unverified)"} (call ${att.callId})`,
        });
      }
      const attA = settlement.attestations["A"];
      const attB = settlement.attestations["B"];
      if (attA !== undefined && attB !== undefined) {
        checks.push({
          name: "attestation_calls_distinct",
          ok: attA.callId !== attB.callId,
          detail:
            attA.callId !== attB.callId
              ? "each party attested on a separate call"
              : `both attestations cite the same call ${attA.callId}`,
        });
      }
    }

    const verdict = checks.every((c) => c.ok) ? "pass" : "fail";
    return jsonOutcome({
      case_id: args.case_id,
      state: rec.state,
      verdict,
      ledger: {
        ok: chain.ok,
        entries: entries.length,
        head_hash: entries.at(-1)?.hash ?? null,
        ...(chain.brokenAtSeq === undefined ? {} : { broken_at_seq: chain.brokenAtSeq }),
      },
      settlement_present: settlement !== undefined,
      checks,
    });
  }

  private caseMemo(args: CaseIdArgs): ToolOutcome {
    const slot = this.loadCase(args.case_id);
    if (slot === null) return toolError(`no such case: ${args.case_id}`);
    const markdown = renderMemo(slot.rec, this.ledger.entries(args.case_id), this.now());
    return {
      text: markdown,
      structured: { case_id: args.case_id, state: slot.rec.state, markdown },
    };
  }
}

// ---------------------------------------------------------------------------
// Stream transport (newline-delimited JSON-RPC; stdio in production)
// ---------------------------------------------------------------------------

export interface StreamServerHandle {
  close(): void;
  /** Resolves when every message received so far has been handled. */
  idle(): Promise<void>;
}

/**
 * Wire a server to newline-delimited JSON-RPC streams. Messages are handled
 * strictly in arrival order (one promise chain), so ledger writes from
 * consecutive tool calls can never interleave.
 */
export function serveOverStreams(
  server: CaucusMcpServer,
  input: Readable,
  output: Writable,
): StreamServerHandle {
  let buffer = "";
  let queue: Promise<void> = Promise.resolve();

  const write = (message: JsonRpcOutbound): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };

  const enqueue = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    queue = queue.then(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        write(rpcError(null, PARSE_ERROR, "invalid JSON"));
        return;
      }
      const response = await server.handle(parsed);
      if (response !== undefined) write(response);
    });
  };

  const onData = (chunk: Buffer | string): void => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      enqueue(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  };

  const onEnd = (): void => {
    if (buffer.trim().length > 0) enqueue(buffer);
    buffer = "";
  };

  input.on("data", onData);
  input.on("end", onEnd);

  return {
    close(): void {
      input.off("data", onData);
      input.off("end", onEnd);
    },
    idle(): Promise<void> {
      return queue;
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point: `node dist/mcp.js` serves over stdio
// ---------------------------------------------------------------------------

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

/* c8 ignore start — exercised as a process, not under the unit-test runner */
if (isDirectInvocation) {
  const server = new CaucusMcpServer({
    dbPath: process.env["CAUCUS_DB"] ?? "./caucus.db",
  });
  const handle = serveOverStreams(server, process.stdin, process.stdout);
  process.stdin.on("end", () => {
    void handle.idle().then(() => {
      handle.close();
      server.close();
    });
  });
}
/* c8 ignore stop */
