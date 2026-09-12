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

/** A UI-facing, JSON-safe view of a node (drops functions, trims heavy fields). */
export interface NodeSnapshot {
  id: string;
  phone: string;
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
  type: ExecutorEvent["type"] | "snapshot" | "node_approved";
  nodeId?: string;
  from?: string;
  to?: string;
  parentId?: string;
  /** Always included so clients can re-render without tracking deltas. */
  snapshot: RunSnapshot;
}

type Listener = (event: RunEvent) => void;

function snapshotNode(n: CallNode): NodeSnapshot {
  return {
    id: n.id,
    phone: n.phone,
    region: n.region,
    locale: n.locale,
    goal: n.goal,
    dependsOn: n.dependsOn,
    spawnedBy: n.spawnedBy,
    status: n.status,
    confidence: n.confidence,
    result: n.result as Record<string, unknown> | undefined,
    evidence: n.evidence,
    transcript: n.transcript?.map((t) => ({
      speaker: t.speaker,
      text: t.text,
      at: t.at,
    })),
    verification: n.verification
      ? {
          trusted: n.verification.trusted,
          status: n.verification.status,
          notes: n.verification.notes,
          policyFlags: n.verification.policyFlags,
        }
      : undefined,
    attemptedLocales: n.attemptedLocales,
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
      error: this.error,
    };
  }

  /**
   * Human review: approve a flagged node, marking it done.
   *
   * Only nodes currently awaiting review (needs_review / needs_user) can be
   * approved. We record the human decision in the verification report so the
   * audit trail is preserved, then flip the status and emit a live event.
   * Returns false if the node doesn't exist or isn't in a reviewable state.
   */
  approveNode(nodeId: string, note?: string): boolean {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    if (node.status !== "needs_review" && node.status !== "needs_user") {
      return false;
    }

    node.status = "done";
    const stamp = note?.trim()
      ? `Approved by reviewer: ${note.trim()}`
      : "Approved by reviewer.";
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
    return true;
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
    // Emit an initial snapshot so clients see the starting graph.
    this.emit({ type: "snapshot" });
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
              // handled below after execution resolves
              break;
          }
        },
      });
      this.state = "done";
    } catch (err) {
      this.state = "error";
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
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
