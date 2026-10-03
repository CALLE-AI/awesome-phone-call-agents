/**
 * Finding call-shaped payloads in an arbitrary JSON document, and putting the
 * REST API's snake_case and the SDK's camelCase into one spelling.
 *
 * This lives apart from the checker because two tools need it and the checker
 * is a script: importing it to borrow a function would run the whole report.
 */

import type { CallPayload } from "./quirks.ts";

const RENAMES: Record<string, string> = {
  transcript_turns: "transcriptTurns",
  failure_code: "failureCode",
  failure_message: "failureMessage",
  structured_result: "structuredResult",
  started_at: "startedAt",
  created_at: "createdAt",
  completed_at: "completedAt",
  provider_call_id: "providerCallId",
  task_completed: "taskCompleted",
  completion_confidence: "completionConfidence",
};

export function normalise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalise);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[RENAMES[k] ?? k] = normalise(v);
  }
  return out;
}

/**
 * Every call-shaped node in a document, as it actually arrived.
 *
 * The checker only needs the fields its predicates read, but the drift report
 * needs the whole node: a field nobody has written a predicate for is exactly
 * the kind of field whose disappearance nothing else would notice.
 */
export function callNodesIn(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) { node.forEach((n) => callNodesIn(n, found)); return found; }
  if (node === null || typeof node !== "object") return found;
  const o = node as Record<string, unknown>;
  const rs = o.recipients;
  if (Array.isArray(rs) && rs.some((r) => r !== null && typeof r === "object" && Array.isArray((r as Record<string, unknown>).attempts))) {
    found.push(o);
  }
  Object.values(o).forEach((v) => callNodesIn(v, found));
  return found;
}

/** The fields the quirk predicates read, lifted out of a call-shaped node. */
export function asCall(o: Record<string, unknown>): CallPayload {
  return {
    id: String(o.id ?? "unknown"),
    object: String(o.object ?? ""),
    status: String(o.status ?? ""),
    createdAt: String(o.createdAt ?? ""),
    completedAt: (o.completedAt as string) ?? null,
    taskCompleted: Boolean(o.taskCompleted),
    failureCode: (o.failureCode as string) ?? null,
    structuredResult: o.structuredResult ?? null,
    recipients: (o.recipients ?? []) as CallPayload["recipients"],
  };
}

/** A payload is call-shaped if it has recipients carrying attempts. */
export function callsIn(node: unknown): CallPayload[] {
  return callNodesIn(node).map(asCall);
}
