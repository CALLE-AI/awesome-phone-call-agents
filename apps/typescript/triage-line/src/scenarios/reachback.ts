/**
 * Scene 1 — Reachback (fan-out) with two-way escalation.
 *
 * Dial many residents with the same welfare-check goal, collect schema-validated
 * results, then triage/rank by urgency. Every resident call is independent (no
 * deps), so the executor runs them with bounded concurrency.
 *
 * Escalation is driven entirely by what each welfare call learned:
 *
 *   1. Needs help (urgency "high" or safe === false) -> spawn a follow-up call
 *      to a GP / clinic to arrange a check-in.
 *   2. Silence is the signal. If a resident is unreachable (no answer or
 *      voicemail), we don't just log it — expand() spawns a call to their
 *      emergency contact to ask someone to check on them in person. An
 *      unanswered welfare call after a disaster is exactly the case that must
 *      not be dropped.
 *
 * Phone numbers are configurable via env (REACHBACK_PHONES, GP_PHONE,
 * EMERGENCY_CONTACT_PHONE) so real numbers can be used for live demos without
 * editing source. When unset, the built-in placeholders are used (only
 * meaningful against the mock).
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

const EMERGENCY_CONTACT_SCHEMA: ResultSchema = {
  type: "object",
  properties: {
    contact_reached: { type: "boolean" },
    will_check_in: { type: "boolean" },
    eta: { type: "string" },
    note: { type: "string" },
  },
  required: ["contact_reached"],
};

interface Resident {
  id: string;
  name: string;
  phone: string;
  region?: string;
  locale?: string;
}

/**
 * Sample roster for the MOCK/no-call demo only. These are fictional
 * standards-reserved (555) numbers and are never dialed for real: they exist so
 * the simulated fan-out has recipients. Live and hybrid modes ignore these as
 * real recipients — real legs come only from explicitly authorized config
 * (REACHBACK_PHONES). Resident 6 is Spanish-speaking (drives language retry).
 */
const SAMPLE_RESIDENTS: Resident[] = [
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
  const mode = (process.env.CALL_MODE ?? "").toLowerCase();

  // MOCK: the sample roster is used purely to simulate a fan-out; these 555
  // numbers are never dialed for real.
  if (mode !== "live" && mode !== "hybrid") {
    return SAMPLE_RESIDENTS;
  }

  // HYBRID: real legs (REAL_NODE_IDS) must have an explicitly authorized number
  // from config; the rest of the roster are simulated stand-ins routed to the
  // mock. A real node id with no configured number is dropped (fail closed) so
  // no fixture is ever dialed for real.
  if (mode === "hybrid") {
    const realIds = [...realNodeIds()];
    return SAMPLE_RESIDENTS.flatMap((r) => {
      const idx = realIds.indexOf(r.id);
      if (idx >= 0) {
        if (!phones[idx]) return []; // authorized number required for a real leg
        return [{ ...r, phone: phones[idx], region, locale }];
      }
      return [r]; // simulated stand-in (routed to mock)
    });
  }

  // LIVE: call ONLY explicitly authorized recipients. No fixture fallback.
  return phones.map((phone, i) => ({
    id: `reachback-${i + 1}`,
    name: `Resident ${i + 1}`,
    phone,
    region,
    locale,
  }));
}

/** Does a verified welfare result indicate the resident needs help? */
function needsHelp(node: CallNode): boolean {
  if (node.status !== "done") return false;
  const r = node.result ?? {};
  return r["urgency"] === "high" || r["safe"] === false;
}

/**
 * Was the resident unreachable? Silence is the signal: a welfare call that
 * didn't connect (no answer or voicemail) is exactly what we must escalate.
 */
function isUnreachable(node: CallNode): boolean {
  const s = node.outcome?.status;
  return s === "no_answer" || s === "voicemail";
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

  // Escalation targets come from configuration only. There is NO synthetic
  // default: if unset, the value is empty and the E.164 guard will refuse to
  // dial it, so an unconfigured escalation is surfaced for a human rather than
  // dialing a made-up number.
  const gpPhone = (process.env.GP_PHONE ?? "").trim();
  const emergencyContactPhone = (process.env.EMERGENCY_CONTACT_PHONE ?? "").trim();
  const nameById: Record<string, string> = Object.fromEntries(
    residents.map((r) => [r.id, r.name])
  );

  return {
    id: "reachback",
    mode: "fan_out",
    nodes,
    // Two-way escalation, driven by what each welfare call learned.
    expand(node, graph) {
      // Only escalate resident welfare nodes, not follow-ups we already spawned.
      if (node.id.startsWith("gp-") || node.id.startsWith("ec-")) return [];

      const name = nameById[node.id] ?? node.id;

      // 1. Needs help -> call the GP / clinic.
      if (needsHelp(node)) {
        const gpId = `gp-${node.id}`;
        if (graph.nodes.some((n) => n.id === gpId)) return [];
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
            // Consequential medical/referral call: a human must authorize it
            // before it dials. The triggering welfare result is a signal, not
            // an authorization.
            requiresApproval: true,
            proposedReason:
              `${name} reported needing help (${needs || "urgent assistance"}); ` +
              `propose a GP follow-up call.`,
          }),
        ];
      }

      // 2. Silence is the signal -> call the resident's emergency contact.
      if (isUnreachable(node)) {
        const ecId = `ec-${node.id}`;
        if (graph.nodes.some((n) => n.id === ecId)) return [];
        const why =
          node.outcome?.status === "voicemail"
            ? "the call went to voicemail"
            : "there was no answer";
        return [
          makeNode({
            id: ecId,
            phone: emergencyContactPhone,
            region: node.region,
            locale: node.locale,
            goal:
              `We tried to reach ${name} for a welfare check after the outage ` +
              `but ${why}. Call their emergency contact: explain we could not ` +
              `reach ${name}, ask them to check on ${name} in person, and get a ` +
              `commitment and an ETA for when they can do so.`,
            resultSchema: EMERGENCY_CONTACT_SCHEMA,
            dependsOn: [node.id],
            spawnedBy: node.id,
            // Consequential call to a third party: a human must authorize it.
            requiresApproval: true,
            proposedReason:
              `${name} was unreachable (${why}); propose calling their ` +
              `emergency contact.`,
          }),
        ];
      }

      return [];
    },
  };
}

/** Name lookup for pretty output. */
export const RESIDENT_NAMES: Record<string, string> = Object.fromEntries(
  SAMPLE_RESIDENTS.map((r) => [r.id, r.name])
);
