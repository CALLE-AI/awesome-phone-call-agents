/**
 * The executor drives a CallGraph to completion using a CalleClient (mock or
 * real). It supports both topologies with one loop:
 *
 *   fan_out: every node is independent -> run all with bounded concurrency.
 *   chain:   run nodes whose dependsOn are all "done"; after each completes,
 *            call graph.expand() to derive the next node from its result, then
 *            keep going until no runnable nodes remain.
 *
 * Value-add layers wired in here:
 *   - verification (verify): decides done / needs_review / needs_user / failed
 *   - language auto-retry: on a suspected language barrier, re-run the node in
 *     the next allowed locale for its region before giving up.
 *
 * An optional onEvent callback emits progress so a server/UI can stream updates.
 */

import type { CalleClient } from "../calle/client.js";
import { buildPolicyText } from "../verify/policy.js";
import { looksLikeLanguageBarrier, verify } from "../verify/verifier.js";
import { nextLocale } from "../lang/locales.js";
import type {
  CallGraph,
  CallNode,
  CalleCallOutcome,
} from "./types.js";

export interface ExecutorOptions {
  client: CalleClient;
  maxConcurrency?: number;
  confidenceThreshold?: number;
  /** Enable language auto-retry on suspected language barriers. */
  languageRetry?: boolean;
  onEvent?: (event: ExecutorEvent) => void;
}

export type ExecutorEvent =
  | { type: "node_start"; node: CallNode }
  | { type: "node_retry_language"; node: CallNode; from: string; to: string }
  | { type: "node_done"; node: CallNode }
  | { type: "node_spawned"; node: CallNode; parentId: string }
  | { type: "graph_done"; graph: CallGraph };

/** Compose the final task string handed to CALL-E for a node. */
function buildTask(node: CallNode): string {
  return `${node.goal}${buildPolicyText(node.policy)}`;
}

/**
 * Are all of a node's dependencies satisfied? A dependency is satisfied once it
 * has settled (reached a terminal status), not only when it's "done". A
 * follow-up call may be spawned precisely because its parent could NOT be
 * completed — e.g. an emergency-contact call depends on an unreachable welfare
 * call, which settles as needs_review. Only pending/blocked/running parents
 * hold a dependent back.
 */
function depsSatisfied(node: CallNode, graph: CallGraph): boolean {
  if (node.dependsOn.length === 0) return true;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const settled = new Set(["done", "needs_review", "needs_user", "failed"]);
  return node.dependsOn.every((id) => {
    const dep = byId.get(id);
    return dep !== undefined && settled.has(dep.status);
  });
}

/** Is this node still awaiting human authorization before it may dial? */
function awaitingApproval(n: CallNode): boolean {
  return n.requiresApproval === true && n.approved !== true;
}

/** Nodes eligible to run right now. */
function runnableNodes(graph: CallGraph): CallNode[] {
  return graph.nodes.filter(
    (n) =>
      (n.status === "pending" ||
        n.status === "blocked" ||
        // An approved node that had been parked at the gate becomes runnable.
        (n.status === "awaiting_approval" && n.approved === true)) &&
      !awaitingApproval(n) &&
      depsSatisfied(n, graph)
  );
}

/**
 * Reflect gating in node status for UI clarity:
 *   - a consequential call still needing authorization -> awaiting_approval
 *   - a node whose deps aren't yet satisfied -> blocked
 */
function markBlocked(graph: CallGraph): void {
  for (const n of graph.nodes) {
    if (n.status === "pending" && depsSatisfied(n, graph) && awaitingApproval(n)) {
      n.status = "awaiting_approval";
    } else if (n.status === "pending" && !depsSatisfied(n, graph)) {
      n.status = "blocked";
    }
  }
}

/** Apply an outcome to a node, running verification and filling fields. */
function applyOutcome(
  node: CallNode,
  outcome: CalleCallOutcome,
  confidenceThreshold?: number
): void {
  node.outcome = outcome;
  node.result = outcome.structuredResult;
  node.confidence = outcome.completionConfidence?.score;
  node.evidence = outcome.evidence;
  node.transcript = outcome.transcript;
  node.verification = verify(node, outcome, { confidenceThreshold });
  node.status = node.verification.status;
}

/**
 * Run a single node, including one language auto-retry if enabled and the first
 * attempt looks like a language barrier.
 */
async function runNode(
  node: CallNode,
  opts: ExecutorOptions
): Promise<void> {
  node.status = "running";
  node.attemptedLocales = node.attemptedLocales ?? [];
  opts.onEvent?.({ type: "node_start", node });

  node.attemptedLocales.push(node.locale);
  let outcome = await opts.client.createAndWait({
    task: buildTask(node),
    phone: node.phone,
    region: node.region,
    locale: node.locale,
    resultSchema: node.resultSchema,
    nodeId: node.id,
    // Distinct per attempt: node + locale + attempt index. A retry in another
    // locale must not reuse the first attempt's idempotency key.
    idempotencyKey: `${node.id}:${node.locale}:1`,
  });

  // Language auto-retry: if the first attempt suggests a barrier, try the next
  // allowed locale for this region before accepting the result.
  if (opts.languageRetry && looksLikeLanguageBarrier(outcome)) {
    const to = nextLocale(node.region, node.attemptedLocales);
    if (to) {
      opts.onEvent?.({
        type: "node_retry_language",
        node,
        from: node.locale,
        to,
      });
      node.locale = to;
      node.attemptedLocales.push(to);
      outcome = await opts.client.createAndWait({
        task: buildTask(node),
        phone: node.phone,
        region: node.region,
        locale: to,
        resultSchema: node.resultSchema,
        nodeId: node.id,
        // New locale -> distinct key so this is a genuinely new call.
        idempotencyKey: `${node.id}:${to}:2`,
      });
    }
  }

  applyOutcome(node, outcome, opts.confidenceThreshold);
  opts.onEvent?.({ type: "node_done", node });
}

/** Run an array of async tasks with a bounded concurrency limit. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const runners: Promise<void>[] = [];
  const n = Math.max(1, Math.min(limit, queue.length || 1));
  for (let i = 0; i < n; i++) {
    runners.push(
      (async () => {
        while (queue.length) {
          const item = queue.shift();
          if (item === undefined) break;
          await worker(item);
        }
      })()
    );
  }
  await Promise.all(runners);
}

/**
 * Execute a graph to completion. Works for both fan_out and chain: we loop,
 * running all currently-runnable nodes (with concurrency), then for chains we
 * expand newly-completed nodes into new nodes, and repeat until nothing else
 * can run.
 */
export async function executeGraph(
  graph: CallGraph,
  opts: ExecutorOptions
): Promise<CallGraph> {
  const limit = opts.maxConcurrency ?? 4;
  // Nodes we've already run expand() on, so we never expand the same node twice
  // across loop iterations.
  const expandedIds = new Set<string>();

  while (true) {
    markBlocked(graph);
    const batch = runnableNodes(graph);
    if (batch.length === 0) break;

    await runPool(batch, limit, (node) => runNode(node, opts));

    // Expansion: derive follow-up nodes from freshly-settled nodes.
    // Runs whenever the graph defines expand() — used by chains (each call
    // reveals the next) and by fan-out graphs that escalate. We expand any node
    // that has finished executing (reached a terminal status), not only "done"
    // ones, so an unreachable resident (needs_review from no answer/voicemail)
    // can still spawn a follow-up (e.g. a call to their emergency contact).
    // The scenario's expand() decides what, if anything, each status warrants.
    if (graph.expand) {
      const settled = graph.nodes.filter(
        (n) =>
          !expandedIds.has(n.id) &&
          n.expanded !== true &&
          (n.status === "done" ||
            n.status === "needs_review" ||
            n.status === "needs_user" ||
            n.status === "failed")
      );
      for (const node of settled) {
        expandedIds.add(node.id);
        // Persist on the node too, so a later executeGraph pass (e.g. after a
        // human approval resumes the run) never re-expands the same node.
        node.expanded = true;
        const spawned = graph.expand(node, graph);
        for (const child of spawned) {
          // Guard: never add a child id that already exists in the graph.
          if (graph.nodes.some((n) => n.id === child.id)) continue;
          child.spawnedBy = node.id;
          graph.nodes.push(child);
          opts.onEvent?.({ type: "node_spawned", node: child, parentId: node.id });
        }
      }
    }
  }

  opts.onEvent?.({ type: "graph_done", graph });
  return graph;
}
