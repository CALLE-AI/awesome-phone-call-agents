/**
 * Scene 1 — Reachback (fan-out) with GP escalation.
 *
 * Dial many residents with the same welfare-check goal, collect schema-validated
 * results, then triage/rank by urgency. Every resident call is independent (no
 * deps), so the executor runs them with bounded concurrency.
 *
 * Escalation: if a resident's verified result shows they need help
 * (urgency "high" or safe === false), expand() spawns a follow-up call to a GP
 * / clinic on their behalf. This links the fan-out welfare check to a
 * dependent follow-up call, driven entirely by what the welfare call learned.
 *
 * Phone numbers are configurable via env (REACHBACK_PHONES, GP_PHONE) so real
 * numbers can be used for live demos without editing source. When unset, the
 * built-in placeholders are used (only meaningful against the mock).
 */

import { makeNode, type CallGraph, type CallNode, type ResultSchema } from "../graph/types.js";

const WELFARE_GOAL =
  "This is a welfare check after the recent power outage. Politely confirm the " +
  "person's identity, then ask: (1) are you safe? (2) do you have power? " +
  "(3) do you need water or medication? Keep it brief and reassuring.";

const WELFARE_SCHEMA: ResultSchema = {
  type: "object",
  properties: {
    safe: { type: "boolean" },
    has_power: { type: "boolean" },
    needs: { type: "array", items: { type: "string" } },
    urgency: { type: "string", enum: ["none", "low", "medium", "high"] },
  },
  required: ["safe", "has_power", "needs", "urgency"],
};

const GP_SCHEMA: ResultSchema = {
  type: "object",
  properties: {
    request_logged: { type: "boolean" },
    callback_eta: { type: "string" },
    reference_number: { type: "string" },
    note: { type: "string" },
  },
  required: ["request_logged"],
};

interface Resident {
  id: string;
  name: string;
  phone: string;
  region?: string;
  locale?: string;
}

/** Eight residents to call. Resident 6 is Spanish-speaking (drives lang retry). */
const RESIDENTS: Resident[] = [
  { id: "reachback-1", name: "Ada Ellison", phone: "+14155550101" },
  { id: "reachback-2", name: "Bo Nguyen", phone: "+14155550102" },
  { id: "reachback-3", name: "Carmen Diaz", phone: "+14155550103" },
  { id: "reachback-4", name: "Dev Patel", phone: "+14155550104" },
  { id: "reachback-5", name: "Elena Petrov", phone: "+14155550105" },
  { id: "reachback-6", name: "Rosa Morales", phone: "+14155550106" },
  { id: "reachback-7", name: "Sam Okafor", phone: "+14155550107" },
  { id: "reachback-8", name: "Tia Brooks", phone: "+14155550108" },
];

/** Read comma-separated E.164 numbers from REACHBACK_PHONES, if set. */
function configuredPhones(): string[] {
  return (process.env.REACHBACK_PHONES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Region/locale for configured live numbers (defaults suit US). */
function configuredRegion(): string {
  return (process.env.REACHBACK_REGION ?? "").trim() || "US";
}
function configuredLocale(): string {
  return (process.env.REACHBACK_LOCALE ?? "").trim() || "en-US";
}

/** Node ids that will be placed as real calls (hybrid mode). */
function realNodeIds(): Set<string> {
  return new Set(
    (process.env.REAL_NODE_IDS ?? "reachback-1")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Build the resident list.
 *
 * - live/mock modes: if REACHBACK_PHONES is set, override placeholder numbers
 *   in order and call exactly those N numbers (with REACHBACK_REGION/LOCALE).
 * - hybrid mode (CALL_MODE=hybrid): keep the full 8-resident roster so the
 *   real call runs alongside the staggered mock calls, and patch only the real
 *   node ids with the configured phone/region/locale. This way one genuine
 *   call (your .env number, e.g. India) sits among the simulated ones.
 */
function residentsToCall(): Resident[] {
  const phones = configuredPhones();
  const region = configuredRegion();
  const locale = configuredLocale();
  const hybrid = (process.env.CALL_MODE ?? "").toLowerCase() === "hybrid";

  if (hybrid) {
    const realIds = [...realNodeIds()];
    // Assign configured phones to the real node ids in order.
    return RESIDENTS.map((r) => {
      const idx = realIds.indexOf(r.id);
      if (idx >= 0 && phones[idx]) {
        return { ...r, phone: phones[idx], region, locale };
      }
      return r;
    });
  }

  if (phones.length === 0) return RESIDENTS;
  return phones.map((phone, i) => {
    const base = RESIDENTS[i] ?? {
      id: `reachback-${i + 1}`,
      name: `Resident ${i + 1}`,
      phone,
    };
    return { ...base, phone, region, locale };
  });
}

/** Does a verified welfare result indicate the resident needs help? */
function needsHelp(node: CallNode): boolean {
  if (node.status !== "done") return false;
  const r = node.result ?? {};
  return r["urgency"] === "high" || r["safe"] === false;
}

export function buildReachbackGraph(): CallGraph {
  const residents = residentsToCall();
  const nodes: CallNode[] = residents.map((r) =>
    makeNode({
      id: r.id,
      phone: r.phone,
      region: r.region ?? "US",
      locale: r.locale ?? "en-US",
      goal: `${WELFARE_GOAL}\n(Resident on file: ${r.name}.)`,
      resultSchema: WELFARE_SCHEMA,
      dependsOn: [],
    })
  );

  const gpPhone = (process.env.GP_PHONE ?? "").trim() || "+14155550199";
  const nameById: Record<string, string> = Object.fromEntries(
    residents.map((r) => [r.id, r.name])
  );

  return {
    id: "reachback",
    mode: "fan_out",
    nodes,
    // Escalation: a resident who needs help spawns a single GP follow-up call.
    expand(node, graph) {
      // Only escalate resident welfare nodes, not GP nodes we already spawned.
      if (node.id.startsWith("gp-")) return [];
      if (!needsHelp(node)) return [];

      const gpId = `gp-${node.id}`;
      // Guard against double-spawning if the node is revisited.
      if (graph.nodes.some((n) => n.id === gpId)) return [];

      const name = nameById[node.id] ?? node.id;
      const needs = Array.isArray(node.result?.["needs"])
        ? (node.result!["needs"] as string[]).join(", ")
        : "urgent assistance";

      return [
        makeNode({
          id: gpId,
          phone: gpPhone,
          region: node.region,
          locale: node.locale,
          goal:
            `A welfare check found that ${name} needs help after the outage ` +
            `(reported needs: ${needs || "urgent assistance"}). Call the GP / ` +
            `clinic to request a follow-up: explain the situation, ask them to ` +
            `arrange a check-in or callback, and get a reference number and ETA.`,
          resultSchema: GP_SCHEMA,
          dependsOn: [node.id],
          spawnedBy: node.id,
        }),
      ];
    },
  };
}

/** Name lookup for pretty output. */
export const RESIDENT_NAMES: Record<string, string> = Object.fromEntries(
  RESIDENTS.map((r) => [r.id, r.name])
);
