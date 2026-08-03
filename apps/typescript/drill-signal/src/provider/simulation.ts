/**
 * In-process simulation provider — default mode, no network I/O.
 */

import { randomUUID } from "node:crypto";
import type { CallePort, CreateCallInput } from "../calle.js";
import type { CallSnapshot } from "../types.js";
import { parseStructuredResult } from "../schema.js";

export interface SimulationScenario {
  phone: string;
  status?: "completed" | "failed" | "canceled";
  failureCode?: string | null;
  structuredResult?: Record<string, unknown> | null;
  transcript?: { speaker: "bot" | "user"; text: string }[];
  delayMs?: number;
  stall?: boolean;
  /** When set, overrides inferred taskCompleted for terminal snapshots. */
  taskCompleted?: boolean;
}

export const SIMULATION_PRESETS: Record<string, SimulationScenario[]> = {
  "primary-success": [
    {
      phone: "+15550100001",
      structuredResult: {
        reached_live_person: true,
        acknowledged_scenario: true,
        can_take_ownership: true,
        first_action: "Open the incident bridge and verify monitoring dashboards.",
        escalation_target: "platform-lead",
        needs_help: false,
        follow_up_required: false,
        opt_out: false,
      },
      transcript: [
        { speaker: "bot", text: "This is a scheduled outage drill call." },
        { speaker: "user", text: "Acknowledged. I can take ownership." },
      ],
    },
  ],
  "primary-unavailable-backup-success": [
    {
      phone: "+15550100002",
      status: "failed",
      failureCode: "no_answer",
      structuredResult: null,
      transcript: [
        { speaker: "bot", text: "This is a scheduled outage drill call for the primary on-call role." },
        { speaker: "user", text: "[no answer — call routed to voicemail]" },
      ],
    },
    {
      phone: "+15550100003",
      structuredResult: {
        reached_live_person: true,
        acknowledged_scenario: true,
        can_take_ownership: true,
        first_action: "Assume primary on-call duties and notify stakeholders.",
        escalation_target: null,
        needs_help: false,
        follow_up_required: true,
        opt_out: false,
      },
      transcript: [
        { speaker: "bot", text: "Backup on-call: this is a business-continuity drill." },
        { speaker: "user", text: "Understood. I can take ownership of the incident bridge." },
      ],
    },
  ],
  "opt-out": [
    {
      phone: "+15550100004",
      structuredResult: {
        reached_live_person: true,
        acknowledged_scenario: true,
        can_take_ownership: false,
        first_action: "none",
        escalation_target: null,
        needs_help: false,
        follow_up_required: true,
        opt_out: true,
      },
      transcript: [
        { speaker: "bot", text: "This is a consented outage drill — may we continue?" },
        { speaker: "user", text: "Please remove me from future drill calls." },
      ],
    },
  ],
  "malformed-result": [
    {
      phone: "+15550100005",
      structuredResult: { reached_live_person: true, incomplete: true },
      taskCompleted: true,
    },
  ],
  "timeout-unknown": [
    {
      phone: "+15550100006",
      stall: true,
    },
  ],
  cancellation: [
    {
      phone: "+15550100007",
      delayMs: 30_000,
      structuredResult: {
        reached_live_person: true,
        acknowledged_scenario: true,
        can_take_ownership: true,
        first_action: "Continue incident checklist.",
        escalation_target: null,
        needs_help: false,
        follow_up_required: false,
        opt_out: false,
      },
    },
  ],
};

interface StoredSimCall {
  id: string;
  scenario: SimulationScenario;
  input: CreateCallInput;
  createdAtMs: number;
  polls: number;
}

export class SimulationProvider implements CallePort {
  static createCallCount = 0;

  private readonly scenarioQueue: SimulationScenario[];
  private readonly calls = new Map<string, StoredSimCall>();
  private readonly cancelled = new Set<string>();
  private nextScenarioIndex = 0;

  constructor(scenarios: SimulationScenario[] | Record<string, SimulationScenario[]>, preset?: string) {
    const list = Array.isArray(scenarios) ? scenarios : scenarios[preset ?? "primary-success"] ?? [];
    this.scenarioQueue = [...list];
  }

  markCancelled(callId: string): void {
    this.cancelled.add(callId);
  }

  async cancelCall(callId: string): Promise<void> {
    this.markCancelled(callId);
  }

  async createCall(input: CreateCallInput, _idempotencyKey: string): Promise<CallSnapshot> {
    SimulationProvider.createCallCount += 1;
    const phone = input.recipients[0]?.phones[0];
    const scenario =
      this.scenarioQueue.find((candidate) => candidate.phone === phone) ??
      this.scenarioQueue[this.nextScenarioIndex] ??
      this.scenarioQueue[this.scenarioQueue.length - 1];
    if (!scenario) {
      throw new Error(`No simulation scenario configured for ${String(phone)}`);
    }
    this.nextScenarioIndex += 1;
    if (scenario.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(scenario.delayMs ?? 0, 100)));
    }
    const id = `sim_${randomUUID().slice(0, 8)}`;
    this.calls.set(id, { id, scenario, input, createdAtMs: Date.now(), polls: 0 });
    return this.snapshot(id, false);
  }

  async waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot> {
    const started = Date.now();
    while (Date.now() - started < options.timeoutMs) {
      const snapshot = await this.getCall(callId);
      if (this.cancelled.has(callId)) {
        return { ...snapshot, status: "canceled" };
      }
      if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "canceled") {
        return snapshot;
      }
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
    throw new Error("simulation_wait_timeout");
  }

  async getCall(callId: string): Promise<CallSnapshot> {
    const call = this.calls.get(callId);
    if (!call) {
      throw new Error(`Unknown simulation call ${callId}`);
    }
    call.polls += 1;
    if (this.cancelled.has(callId)) {
      return this.snapshot(callId, true, "canceled");
    }
    if (call.scenario.stall === true) {
      return this.snapshot(callId, false);
    }
    return this.snapshot(callId, call.polls >= 1);
  }

  private snapshot(callId: string, terminal: boolean, forcedStatus?: string): CallSnapshot {
    const call = this.calls.get(callId)!;
    const scenario = call.scenario;
    const status = forcedStatus ?? (terminal ? scenario.status ?? "completed" : "in_progress");
    const structured = terminal ? scenario.structuredResult ?? null : null;
    const turns = (scenario.transcript ?? []).map((turn, index) => ({
      offset_seconds: index * 4,
      speaker: turn.speaker,
      text: turn.text,
    }));
    const completedAt = terminal ? new Date(call.createdAtMs + 8000).toISOString() : null;
    return {
      id: callId,
      status,
      recipients: [
        {
          id: `rcp_${callId}`,
          phones: call.input.recipients[0]?.phones ?? [],
          status: status,
          structuredResult: structured,
          summary: terminal ? "Simulation call finished." : null,
          attempts: [
            {
              id: `att_${callId}`,
              phone: call.input.recipients[0]?.phones[0] ?? "",
              status,
              startedAt: new Date(call.createdAtMs).toISOString(),
              completedAt,
              summary: null,
              transcriptTurns: terminal ? turns : [],
              providerCallId: `sim_provider_${callId}`,
              failureCode: terminal ? scenario.failureCode ?? null : null,
              failureMessage: null,
            },
          ],
        },
      ],
      structuredResult: structured,
      summary: terminal ? "Simulation call finished." : null,
      taskCompleted: terminal
        ? (scenario.taskCompleted ?? (status === "completed" && parseStructuredResult(structured) !== null))
        : null,
      completionConfidence: terminal ? { score: 0.95, label: "high" } : null,
      evidence: terminal
        ? (scenario.transcript ?? []).map((turn) => `${turn.speaker}: ${turn.text}`).slice(0, 3)
        : [],
      failureCode: terminal ? scenario.failureCode ?? null : null,
      failureMessage: null,
      createdAt: new Date(call.createdAtMs).toISOString(),
      completedAt,
    };
  }
}

export function presetScenarios(preset: string): SimulationScenario[] {
  return SIMULATION_PRESETS[preset] ?? SIMULATION_PRESETS["primary-success"] ?? [];
}
