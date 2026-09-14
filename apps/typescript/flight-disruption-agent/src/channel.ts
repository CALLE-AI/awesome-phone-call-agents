import { findFlight, type Catalog } from "./data.ts";
import { idr, localTime } from "./format.ts";
import { OTA_NAME } from "./task.ts";
import type { Booking, RequestChannel, RequestEntry, RequestKind } from "./types.ts";

export const CHANNEL_SIGNATURE_HEADER = "x-channel-signature";

/** Used only in dry run when CHANNEL_WEBHOOK_SECRET is not set. Never valid in live mode. */
export const DRY_RUN_CHANNEL_SECRET = "dry-run-channel-secret";

/**
 * Messages from the passenger-facing channels: a chat bot, the web form backend, or the
 * phone line's IVR or contact center. The channel takes the request; CALL-E then calls the
 * passenger to agree the change, so there is no typed confirmation message.
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
    };

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
    const kind = str("kind") || "change";
    if (kind !== "reschedule" && kind !== "refund" && kind !== "change") {
      throw new ChannelMessageError('"kind" must be "reschedule", "refund", or "change".');
    }
    const target = str("target_flight_id");
    return { id, type: b.type, channel, conversationId, pnr, lastName, kind, targetFlightId: target || null };
  }
  throw new ChannelMessageError('"type" must be "request.submitted". The passenger agrees the change on the CALL-E call.');
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

/** The change the passenger agreed on the call, in their words. */
function agreedChange(catalog: Catalog, entry: RequestEntry): string {
  if (entry.action?.kind === "refund") return `your refund of ${idr(entry.amount ?? 0)}`;
  const optionId = entry.action?.kind === "move" ? entry.action.optionId : null;
  const move = entry.quote.moves.find((m) => m.id === optionId);
  if (!move) return "your change";
  const flight = findFlight(catalog, move.flightId);
  return `your move to ${flight.code} at ${localTime(flight.departure)} (${idr(entry.amount ?? 0)})`;
}

/**
 * What the channel tells the passenger at each step. Written for the passenger: no internal
 * ids, no other parties' contract details beyond the line items they pay.
 */
export function replyFor(catalog: Catalog, entry: RequestEntry): string {
  const pnr = entry.request.pnr;
  switch (entry.status) {
    case "ineligible":
      return `We can't change booking ${pnr} online right now. A ${OTA_NAME} agent will contact you about your options.`;
    case "awaiting_call":
    case "passenger_call_in_progress":
      return `Thanks. ${OTA_NAME}'s AI assistant will call you shortly to go through the options for booking ${pnr} and their exact costs. Nothing changes until you agree on that call.`;
    case "declined":
      return `OK, nothing changed. Booking ${pnr} stays as it was.`;
    case "completed":
    case "resolved_by_human":
      return entry.applied?.startsWith("Closed without") ? `A ${OTA_NAME} agent reviewed booking ${pnr}. Nothing was changed.` : `Done. ${entry.applied ?? ""}`.trim();
    case "confirmed_on_call":
    case "airline_call_in_progress":
      return `Thanks for confirming on the call. We are now arranging ${agreedChange(catalog, entry)} with the airline and will update you here.`;
    case "needs_review":
      return `We need a ${OTA_NAME} agent to finish this request for booking ${pnr}. They will contact you; nothing has been charged yet.`;
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
