/**
 * In-memory run registry.
 *
 * A "run" is one execution of a CallGraph. We keep a serializable snapshot of
 * the graph plus an append-only event log so that:
 *   - late-joining SSE clients can be replayed the full history, then follow live
 *   - the UI can render node status, confidence, transcript, and verification
 *
 * This is intentionally memory-only (no DB) — it's a hackathon demo/orchestrator
 * driven by the same executor used on the CLI.
 */

import { randomUUID } from "node:crypto";
import type { CalleClient } from "../calle/client.js";
import { executeGraph, type ExecutorEvent } from "../graph/executor.js";
import type { CallGraph, CallNode } from "../graph/types.js";
import { maskPhone, redactPhones } from "../util/phone.js";

/** A UI-facing, JSON-safe view of a node (drops functions, trims heavy fields). */
export interface NodeSnapshot {
  id: string;
  /** Masked phone (e.g. +1•••••••88). Full numbers are never serialized. */
  phoneMasked: string;
  region: string;
  locale: string;
  goal: string;
  dependsOn: string[];
  spawnedBy?: string;
  status: CallNode["status"];
  confidence?: number;
  result?: Record<string, unknown>;
  evidence?: string[];
  transcript?: { speaker: string; text: string; at?: number }[];
  verification?: {
    trusted: boolean;
    status: string;
    notes: string[];
    policyFlags: string[];
  };
  attemptedLocales?: string[];
  /** Why a consequential call was proposed (shown at the approval gate). */
  proposedReason?: string;
  /** This call must be authorized by a human before it dials. */
  requiresApproval?: boolean;
  /** Whether a human has authorized it. */
  approved?: boolean;
}

export interface RunSnapshot {
  id: string;
  scenario: string;
  mode: CallGraph["mode"];
  state: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  nodes: NodeSnapshot[];
  error?: string;
}

/** A serialized event pushed to SSE clients. */
export interface RunEvent {
  seq: number;
  type: ExecutorEvent["type"] | "snapshot" | "node_approved" | "run_paused";
  nodeId?: string;
  from?: string;
  to?: string;
  parentId?: string;
  /** Always included so clients can re-render without tracking deltas. */
  snapshot: RunSnapshot;
}

type Listener = (event: RunEvent) => void;

/**
 * Deeply redact phone-like values anywhere in a JSON value (strings, nested
 * objects, arrays). Provider-discovered numbers (e.g. a nested referral_phone)
 * must never leak in full at any depth.
 */
function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactPhones(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

function redactResult(
  result: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!result) return undefined;
  return redactDeep(result) as Record<string, unknown>;
}

function snapshotNode(n: CallNode): NodeSnapshot {
  return {
    id: n.id,
    // Personal data: never expose the full number in a snapshot/event.
    phoneMasked: maskPhone(n.phone),
    region: n.region,
    locale: n.locale,
    goal: redactPhones(n.goal),
    dependsOn: n.dependsOn,
    spawnedBy: n.spawnedBy,
    status: n.status,
    confidence: n.confidence,
    result: redactResult(n.result as Record<string, unknown> | undefined),
    evidence: n.evidence?.map((e) => redactPhones(e)),
    transcript: n.transcript?.map((t) => ({
      speaker: t.speaker,
      text: redactPhones(t.text),
      at: t.at,
    })),
    verification: n.verification
      ? {
          trusted: n.verification.trusted,
          status: n.verification.status,
          // Notes/flags are human-facing text and can contain numbers.
          notes: n.verification.notes.map((s) => redactPhones(s)),
          policyFlags: n.verification.policyFlags.map((s) => redactPhones(s)),
        }
      : undefined,
    attemptedLocales: n.attemptedLocales,
    proposedReason: n.proposedReason
      ? redactPhones(n.proposedReason)
      : undefined,
    requiresApproval: n.requiresApproval,
    approved: n.approved,
  };
}

class Run {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  finishedAt?: number;
  state: RunSnapshot["state"] = "running";
  error?: string;

  private readonly events: RunEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private seq = 0;

  // Retained so a human approval can resume execution (dial a now-authorized
  // consequential call and any dependents).
  private client?: CalleClient;
  private maxConcurrency = 4;
  private executing = false;

  constructor(
    readonly scenario: string,
    private readonly graph: CallGraph
  ) {}

  snapshot(): RunSnapshot {
    return {
      id: this.id,
      scenario: this.scenario,
      mode: this.graph.mode,
      state: this.state,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      nodes: this.graph.nodes.map(snapshotNode),
      // Error text can include a number (e.g. a failed E.164) — mask it.
      error: this.error ? redactPhones(this.error) : undefined,
    };
  }

  /**
   * Human decision on a node awaiting a person.
   *
   * Two cases:
   *   1. awaiting_approval — a consequential call (e.g. GP / emergency contact)
   *      proposed by escalation but not yet authorized to dial. Approving marks
   *      it approved and RESUMES execution so it (and any dependents) are placed.
   *   2. needs_review / needs_user — a completed call whose result a human
   *      accepts. Approving marks it done and records the decision.
   *
   * Returns false if the node doesn't exist or isn't awaiting a decision.
   */
  approveNode(nodeId: string, note?: string): boolean {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return false;

    const stamp = note?.trim()
      ? `Approved by reviewer: ${note.trim()}`
      : "Approved by reviewer.";

    // Case 1: authorize a proposed consequential call, then resume the run.
    if (node.status === "awaiting_approval") {
      node.approved = true;
      node.status = "pending"; // becomes runnable on the next execute pass
      this.emit({ type: "node_approved", nodeId });
      void this.resume();
      return true;
    }

    // Case 2: accept a completed-but-flagged result.
    if (node.status === "needs_review" || node.status === "needs_user") {
      node.status = "done";
      if (node.verification) {
        node.verification.status = "done";
        node.verification.trusted = true;
        node.verification.notes = [...node.verification.notes, stamp];
      } else {
        node.verification = {
          trusted: true,
          status: "done",
          notes: [stamp],
          policyFlags: [],
        };
      }
      this.emit({ type: "node_approved", nodeId });
      // A resolved dependency may unblock dependents (e.g. a chain step); resume.
      void this.resume();
      return true;
    }

    return false;
  }

  /** Re-run the executor to pick up newly-authorized or unblocked nodes. */
  private async resume(): Promise<void> {
    if (!this.client || this.executing) return;
    await this.runExecutor(this.client, this.maxConcurrency);
  }

  /** Buffered history for late joiners. */
  history(): RunEvent[] {
    return this.events;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(partial: Omit<RunEvent, "seq" | "snapshot">): void {
    const event: RunEvent = {
      seq: this.seq++,
      snapshot: this.snapshot(),
      ...partial,
    };
    this.events.push(event);
    for (const l of this.listeners) l(event);
  }

  async execute(client: CalleClient, maxConcurrency: number): Promise<void> {
    this.client = client;
    this.maxConcurrency = maxConcurrency;
    // Emit an initial snapshot so clients see the starting graph.
    this.emit({ type: "snapshot" });
    await this.runExecutor(client, maxConcurrency);
  }

  private async runExecutor(
    client: CalleClient,
    maxConcurrency: number
  ): Promise<void> {
    this.executing = true;
    this.state = "running";
    try {
      await executeGraph(this.graph, {
        client,
        maxConcurrency,
        languageRetry: true,
        onEvent: (e: ExecutorEvent) => {
          switch (e.type) {
            case "node_start":
            case "node_done":
              this.emit({ type: e.type, nodeId: e.node.id });
              break;
            case "node_retry_language":
              this.emit({
                type: e.type,
                nodeId: e.node.id,
                from: e.from,
                to: e.to,
              });
              break;
            case "node_spawned":
              this.emit({
                type: e.type,
                nodeId: e.node.id,
                parentId: e.parentId,
              });
              break;
            case "graph_done":
              break;
          }
        },
      });
      // If nothing is left awaiting a human, the run is done; otherwise it
      // stays "running" so the UI shows it's parked for approval.
      const parked = this.graph.nodes.some(
        (n) => n.status === "awaiting_approval"
      );
      this.executing = false;
      if (parked) {
        // Do NOT signal graph_done while paused — the client keeps the SSE
        // stream open so it receives events when a human approval resumes it.
        this.state = "running";
        this.emit({ type: "run_paused" });
      } else {
        this.state = "done";
        this.finishedAt = Date.now();
        this.emit({ type: "graph_done" });
      }
    } catch (err) {
      this.executing = false;
      this.state = "error";
      this.error = err instanceof Error ? err.message : String(err);
      this.finishedAt = Date.now();
      this.emit({ type: "graph_done" });
    }
  }
}

const runs = new Map<string, Run>();

export function createRun(scenario: string, graph: CallGraph): Run {
  const run = new Run(scenario, graph);
  runs.set(run.id, run);
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export type { Run };
