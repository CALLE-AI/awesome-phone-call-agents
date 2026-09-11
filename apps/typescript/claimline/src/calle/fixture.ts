import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CallStatus, TranscriptTurn } from "../domain/types.js";
import { FIXTURES_DIR } from "../paths.js";
import type {
  CalleGateway,
  CallHandle,
  CallRequest,
  CallSnapshot,
} from "./gateway.js";

/**
 * A canned call outcome. `file` loads a base snapshot from the inspectable JSON
 * fixtures; explicit fields overlay it. This backend NEVER places a real call.
 */
export interface FixtureScenario {
  status: CallStatus;
  file?: string;
  taskCompleted?: boolean | null;
  completionConfidence?: { score: number; label: string } | null;
  structuredResult?: Record<string, unknown> | null;
  evidence?: string[];
  summary?: string | null;
  transcript?: TranscriptTurn[];
  failureCode?: string | null;
  failureMessage?: string | null;
}

const BUILT_IN: Record<string, FixtureScenario> = {
  fnol_ok: { status: "completed", file: "fnol-ravi.json" },
  status_ok: { status: "completed", file: "status-downtown-auto.json" },
  medical_ok: { status: "completed", file: "medical-report.json" },
  bill_ok: { status: "completed", file: "bill-verification.json" },
  voicemail: {
    status: "completed",
    taskCompleted: false,
    completionConfidence: { score: 0.2, label: "low" },
    structuredResult: null,
    summary: "Reached the recipient's voicemail; no information gathered.",
    evidence: [],
    transcript: [
      {
        offsetSeconds: 0,
        speaker: "system",
        text: "You've reached the voicemail of Downtown Auto Body. Please leave a message after the tone.",
      },
    ],
  },
  refusal: {
    status: "completed",
    taskCompleted: false,
    completionConfidence: { score: 0.3, label: "low" },
    structuredResult: null,
    summary: "Recipient declined to answer questions.",
    evidence: [],
    transcript: [
      {
        offsetSeconds: 0,
        speaker: "bot",
        text: "Hi, this is an automated assistant calling about a claim.",
      },
      {
        offsetSeconds: 4,
        speaker: "user",
        text: "I'm not interested. Do not call again.",
      },
    ],
  },
  low_confidence: {
    status: "completed",
    file: "status-downtown-auto.json",
    completionConfidence: { score: 0.42, label: "low" },
    summary:
      "Repair status unclear; the line was noisy and answers were hedged.",
  },
  failed: {
    status: "failed",
    taskCompleted: false,
    completionConfidence: null,
    structuredResult: null,
    summary: null,
    evidence: [],
    transcript: [],
    failureCode: "no_answer",
    failureMessage: "No answer after the configured retries.",
  },
};

interface StoredCall {
  scenario: string;
  callType: string;
}

/**
 * No-call fixture gateway. It simulates the CALL-E lifecycle (a call is
 * "queued" on start and terminal on read) using deterministic canned outcomes,
 * so the whole workflow can be exercised without credentials or a real dial.
 */
export class FixtureCalleGateway implements CalleGateway {
  readonly mode = "fixture" as const;
  private readonly fixturesDir: string;
  private readonly scenarios: Record<string, FixtureScenario>;
  private readonly calls = new Map<string, StoredCall>();
  private readonly fileCache = new Map<string, Partial<CallSnapshot>>();

  constructor(options?: {
    fixturesDir?: string;
    scenarios?: Record<string, FixtureScenario>;
  }) {
    this.fixturesDir = options?.fixturesDir ?? FIXTURES_DIR;
    this.scenarios = { ...BUILT_IN, ...(options?.scenarios ?? {}) };
  }

  registerScenario(name: string, scenario: FixtureScenario): void {
    this.scenarios[name] = scenario;
  }

  async startCall(req: CallRequest): Promise<CallHandle> {
    const callType = String(req.metadata?.callType ?? "");
    const scenario = this.selectScenario(req);
    // Deterministic id from the idempotency key so repeat "dials" collapse.
    const callId = `fixture_${req.idempotencyKey.slice(-24) || randomUUID()}`;
    this.calls.set(callId, { scenario, callType });
    return { callId, status: "queued" };
  }

  async getCall(callId: string): Promise<CallSnapshot> {
    const stored = this.calls.get(callId);
    if (!stored) {
      throw new Error(`Unknown fixture call id: ${callId}`);
    }
    const scenario = this.scenarios[stored.scenario];
    if (!scenario) {
      throw new Error(`Unknown fixture scenario: ${stored.scenario}`);
    }
    return this.buildSnapshot(callId, scenario);
  }

  private selectScenario(req: CallRequest): string {
    const explicit = req.metadata?.fixtureScenario;
    if (typeof explicit === "string" && this.scenarios[explicit]) {
      return explicit;
    }
    const callType = String(req.metadata?.callType ?? "");
    switch (callType) {
      case "status_chase":
        return "status_ok";
      case "medical_report":
        return "medical_ok";
      case "bill_verification":
        return "bill_ok";
      default:
        return "fnol_ok";
    }
  }

  private loadFile(file: string): Partial<CallSnapshot> {
    const cached = this.fileCache.get(file);
    if (cached) return cached;
    const path = resolve(this.fixturesDir, file);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CallSnapshot>;
    this.fileCache.set(file, parsed);
    return parsed;
  }

  private buildSnapshot(
    callId: string,
    scenario: FixtureScenario,
  ): CallSnapshot {
    const base: Partial<CallSnapshot> = scenario.file
      ? this.loadFile(scenario.file)
      : {};
    const pick = <T>(explicit: T | undefined, fromFile: T | undefined, fallback: T): T =>
      explicit !== undefined ? explicit : fromFile !== undefined ? fromFile : fallback;

    return {
      callId,
      status: scenario.status,
      taskCompleted: pick(scenario.taskCompleted, base.taskCompleted, null),
      completionConfidence: pick(
        scenario.completionConfidence,
        base.completionConfidence,
        null,
      ),
      structuredResult: pick(
        scenario.structuredResult,
        base.structuredResult,
        null,
      ),
      evidence: pick(scenario.evidence, base.evidence, []),
      summary: pick(scenario.summary, base.summary, null),
      transcript: pick(scenario.transcript, base.transcript, []),
      failureCode: pick(scenario.failureCode, base.failureCode, null),
      failureMessage: pick(scenario.failureMessage, base.failureMessage, null),
    };
  }
}
