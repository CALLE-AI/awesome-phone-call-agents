import { findFlight, type Catalog } from "./data.ts";
import { idr, localTime } from "./format.ts";
import { OTA_NAME } from "./task.ts";
import type { Booking, RequestChannel, RequestEntry, RequestKind } from "./types.ts";

export const CHANNEL_SIGNATURE_HEADER = "x-channel-signature";

/** Used only in dry run when CHANNEL_WEBHOOK_SECRET is not set. Never valid in live mode. */
export const DRY_RUN_CHANNEL_SECRET = "dry-run-channel-secret";

/**
 * Messages from the passenger-facing channels: a chat bot, the web form backend, or the
 * phone line's IVR or contact center. The channel talks to the passenger; the desk decides.
 */
export type ChannelMessage =
  | {
      id: string;
      type: "request.submitted";
      channel: RequestChannel;
      conversationId: string;
      pnr: string;
      lastName: string;
      kind: RequestKind;
      targetFlightId: string | null;
    }
  | { id: string; type: "request.confirmed"; channel: RequestChannel; conversationId: string; requestId: string; confirmedAmount: number }
  | { id: string; type: "request.declined"; channel: RequestChannel; conversationId: string; requestId: string };

export class ChannelMessageError extends Error {}

const ID = /^[A-Za-z0-9_.:-]{1,100}$/;

export function parseChannelMessage(body: unknown): ChannelMessage {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ChannelMessageError("Body must be a JSON object.");
  const b = body as Record<string, unknown>;
  const str = (key: string) => (typeof b[key] === "string" ? (b[key] as string).trim() : "");
  const id = str("id");
  if (!ID.test(id)) throw new ChannelMessageError('"id" must be 1-100 letters, digits, or _ . : -');
  const channel = str("channel");
  if (channel !== "chat" && channel !== "web_form" && channel !== "phone") {
    throw new ChannelMessageError('"channel" must be "chat", "web_form", or "phone".');
  }
  const conversationId = str("conversation_id");
  if (!ID.test(conversationId)) throw new ChannelMessageError('"conversation_id" must be 1-100 letters, digits, or _ . : -');

  if (b.type === "request.submitted") {
    const pnr = str("pnr").toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(pnr)) throw new ChannelMessageError('"pnr" must be a 6-character booking code.');
    const lastName = str("last_name");
    if (!lastName || lastName.length > 100) throw new ChannelMessageError('"last_name" is required.');
    const kind = str("kind");
    if (kind !== "reschedule" && kind !== "refund") throw new ChannelMessageError('"kind" must be "reschedule" or "refund".');
    const target = str("target_flight_id");
    return { id, type: b.type, channel, conversationId, pnr, lastName, kind, targetFlightId: target || null };
  }
  if (b.type === "request.confirmed" || b.type === "request.declined") {
    const requestId = str("request_id");
    if (!ID.test(requestId)) throw new ChannelMessageError('"request_id" is required.');
    if (b.type === "request.declined") return { id, type: b.type, channel, conversationId, requestId };
    const amount = typeof b.confirmed_amount === "number" ? b.confirmed_amount : Number(String(b.confirmed_amount ?? "").replace(/[^\d]/g, "") || NaN);
    if (!Number.isInteger(amount) || amount < 0) throw new ChannelMessageError('"confirmed_amount" must be the whole rupiah amount the passenger agreed to.');
    return { id, type: b.type, channel, conversationId, requestId, confirmedAmount: amount };
  }
  throw new ChannelMessageError('"type" must be "request.submitted", "request.confirmed", or "request.declined".');
}

function normalizeName(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
}

/** Booking code plus last name, the check airlines use for manage-booking pages. */
export function passengerMatches(booking: Booking, lastName: string): boolean {
  const last = booking.passenger.trim().split(/\s+/).pop() ?? "";
  const given = normalizeName(lastName);
  return given.length > 0 && given === normalizeName(last);
}

/** Same words whether the booking does not exist or the name is wrong, so the channel cannot probe booking codes. */
export const NOT_FOUND_REPLY = `We could not find a booking with that code and last name. Check both and try again, or contact ${OTA_NAME}.`;

/**
 * What the channel tells the passenger at each step. Written for the passenger: no internal
 * ids, no other parties' contract details beyond the line items they pay.
 */
export function replyFor(catalog: Catalog, entry: RequestEntry): string {
  const pnr = entry.request.pnr;
  switch (entry.status) {
    case "ineligible":
      return `We can't change booking ${pnr} online right now. A ${OTA_NAME} agent will contact you about your options.`;
    case "quoted": {
      const lines: string[] = [];
      if (entry.request.kind === "refund") {
        lines.push(`Cancelling booking ${pnr} refunds ${idr(entry.amount ?? 0)} of the ${idr(entry.quote.refund.gross)} you paid.`);
        for (const l of entry.quote.refund.lines.filter((x) => x.amount !== 0)) lines.push(`- ${l.party}: ${l.label} ${idr(-l.amount)}`);
      } else {
        const move = entry.quote.moves.find((m) => m.flightId === entry.request.targetFlightId);
        const flight = move ? findFlight(catalog, move.flightId) : null;
        lines.push(`Moving booking ${pnr} to ${flight ? `${flight.code} at ${localTime(flight.departure)}` : move?.label ?? "the new flight"} costs ${idr(entry.amount ?? 0)}.`);
        for (const l of move?.lines.filter((x) => x.amount !== 0) ?? []) lines.push(`- ${l.party}: ${l.label} ${idr(l.amount)}`);
      }
      if (entry.request.kind === "refund" && entry.amount === 0) lines.push("This fare is non-refundable, so the refund is IDR 0.");
      lines.push(`To go ahead, reply YES ${entry.amount ?? 0}. To keep your booking as it is, reply NO.`);
      return lines.join("\n");
    }
    case "declined":
      return `OK, nothing changed. Booking ${pnr} stays as it was.`;
    case "completed":
    case "resolved_by_human":
      return entry.applied?.startsWith("Closed without") ? `A ${OTA_NAME} agent reviewed booking ${pnr}. Nothing was changed.` : `Done. ${entry.applied ?? ""}`.trim();
    case "portal_rejected":
    case "airline_call_in_progress":
      return `The airline has to approve this ${entry.request.kind} by hand. We are contacting the airline and will update you here.`;
    case "needs_review":
      return `We need a ${OTA_NAME} agent to finish this ${entry.request.kind}. They will contact you; nothing has been charged yet.`;
    default:
      return `Your request for booking ${pnr} is being handled.`;
  }
}

/** Status update pushed back to the channel after the first reply, e.g. once the airline desk answers. */
export interface ChannelUpdatePayload {
  type: "request.updated";
  request_id: string;
  channel: RequestChannel;
  conversation_id: string;
  status: RequestEntry["status"];
  reply: string;
}

export type ChannelNotifier = (payload: ChannelUpdatePayload) => Promise<void>;

/**
 * Posts updates to CHANNEL_NOTIFY_URL, signed with the channel secret so the channel can
 * trust them. The body names the passenger's booking, so it only travels over HTTPS or to this machine.
 */
export function httpChannelNotifier(url: string, secret: string, sign: (secret: string, body: string, t: number) => string): ChannelNotifier {
  return async (payload) => {
    const body = JSON.stringify(payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", [CHANNEL_SIGNATURE_HEADER]: sign(secret, body, Math.floor(Date.now() / 1000)) },
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Channel returned HTTP ${res.status}.`);
    } finally {
      clearTimeout(timeout);
    }
  };
}
