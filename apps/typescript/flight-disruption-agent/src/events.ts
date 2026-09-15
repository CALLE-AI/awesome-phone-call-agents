import { createHmac, timingSafeEqual } from "node:crypto";
import type { Catalog } from "./data.ts";
import type { DisruptionCause, DisruptionKind } from "./types.ts";

/** Signed requests older or newer than this are refused, so a captured request cannot be replayed later. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const SIGNATURE_HEADER = "x-ops-signature";

/** Used only in dry run when AIRLINE_WEBHOOK_SECRET is not set. Never valid in live mode. */
export const DRY_RUN_WEBHOOK_SECRET = "dry-run-webhook-secret";

/**
 * Signature format: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
 * Signing the timestamp with the body stops an attacker from reusing an old signature.
 */
export function signPayload(secret: string, rawBody: string, timestampSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySignature(
  secret: string,
  rawBody: string,
  header: string | undefined,
  nowMs: number,
  headerName = SIGNATURE_HEADER,
): SignatureCheck {
  if (!header) return { ok: false, reason: `Missing ${headerName} header.` };
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return { ok: false, reason: "Malformed signature header." };
  if (Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "Signature timestamp is outside the allowed window." };
  }
  const expected = Buffer.from(signPayload(secret, rawBody, t).split("v1=")[1] ?? "", "hex");
  const given = Buffer.from(/^[0-9a-f]+$/i.test(parts.v1) ? parts.v1 : "", "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "Signature does not match." };
  }
  return { ok: true };
}

/** A disruption pushed by the airline or OTA operations system. */
export interface OpsEvent {
  eventId: string;
  type: "flight.delayed" | "flight.cancelled";
  occurredAt: string;
  flightId: string;
  kind: DisruptionKind;
  cause: DisruptionCause;
  delayMinutes: number;
  reason: string;
}

export class OpsEventError extends Error {}

/**
 * Validates the webhook body and resolves the flight, either by our flight id or by
 * the airline's flight code plus scheduled departure, which is what ops systems usually send.
 */
export function parseOpsEvent(catalog: Catalog, body: unknown): OpsEvent {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OpsEventError("Body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const eventId = typeof b.id === "string" ? b.id.trim() : "";
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(eventId)) throw new OpsEventError('"id" must be 1-100 letters, digits, or _ . : -');
  if (b.type !== "flight.delayed" && b.type !== "flight.cancelled") {
    throw new OpsEventError('"type" must be "flight.delayed" or "flight.cancelled".');
  }
  const occurredAt = typeof b.occurred_at === "string" && !Number.isNaN(Date.parse(b.occurred_at)) ? b.occurred_at : null;
  if (!occurredAt) throw new OpsEventError('"occurred_at" must be an ISO timestamp.');

  const flightRef = (b.flight ?? {}) as Record<string, unknown>;
  let flightId: string | undefined;
  if (typeof flightRef.id === "string") {
    flightId = catalog.flights.find((f) => f.id === flightRef.id)?.id;
  } else if (typeof flightRef.code === "string" && typeof flightRef.scheduled_departure === "string") {
    const code = flightRef.code.replace(/\s+/g, "").toUpperCase();
    const at = Date.parse(flightRef.scheduled_departure);
    flightId = catalog.flights.find((f) => f.code.replace(/\s+/g, "").toUpperCase() === code && Date.parse(f.departure) === at)?.id;
  } else {
    throw new OpsEventError('"flight" needs either "id", or "code" and "scheduled_departure".');
  }
  if (!flightId) throw new OpsEventError("The flight in this event is not in the schedule.");

  const cause = b.cause ?? "operational";
  if (cause !== "operational" && cause !== "force_majeure") throw new OpsEventError('"cause" must be "operational" or "force_majeure".');
  const kind: DisruptionKind = b.type === "flight.cancelled" ? "cancellation" : "delay";
  const delayMinutes = kind === "delay" ? Number(b.delay_minutes) : 0;
  if (kind === "delay" && !Number.isInteger(delayMinutes)) throw new OpsEventError('"delay_minutes" must be a whole number for flight.delayed.');
  const reason = typeof b.reason === "string" ? b.reason.slice(0, 200) : "";

  return { eventId, type: b.type, occurredAt, flightId, kind, cause, delayMinutes, reason };
}
