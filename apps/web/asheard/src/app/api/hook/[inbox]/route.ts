import { NextResponse } from "next/server";

import { CalleApiError, CalleClient } from "asheard/calle";
import { normalizeCallsApi, say } from "asheard/disposition";
import { publicCallView } from "asheard/reconciler";

import { callIdFrom, eventIdFrom } from "@/lib/delivery";
import { isWired, push, read, type Arrival } from "@/lib/inbox";
import { deepMask } from "@/lib/mask";
import { OPERATOR_HEADER, operatorSecret, parseInbox, verify } from "@/lib/operator";

/**
 * The webhook inbox.
 *
 * CALL-E deliveries carry no signature, so this route cannot know who sent one.
 * It does not try to. A delivery is treated as a hint about which call to look
 * at and nothing more: the server fetches that call from CALL-E with its own
 * key, and the fetched call is the only thing stored or shown. The posted body
 * is read once for a call id and then dropped.
 *
 * Two separate operator tokens guard it. The post token is part of the URL you
 * give a sender, and only the server secret can produce one, so a made-up inbox
 * is refused. Reading the inbox back needs a different token in a header, so
 * holding the URL is not enough to see anything.
 */

export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(deepMask(body), init);
}

function client(): CalleClient | null {
  const apiKey = process.env.CALLE_API_KEY?.trim() ?? "";
  return apiKey === "" ? null : new CalleClient({ apiKey });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ inbox: string }> },
): Promise<NextResponse> {
  const inbox = parseInbox((await params).inbox);
  const secret = operatorSecret();

  // A wrong signature and a missing inbox look the same from outside.
  if (inbox === null || !verify("inbox-post", inbox.id, inbox.sig, secret)) {
    return json({ error: "Not an inbox." }, { status: 404 });
  }

  const calle = client();
  if (!isWired() || calle === null) {
    return json({ error: "This deployment cannot check deliveries, so it keeps none." }, { status: 503 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const arrival: Arrival = {
    at: new Date().toISOString(),
    eventId: eventIdFrom(request.headers.get("call-e-event-id"), body),
    callId: callIdFrom(body),
    call: null,
    reading: null,
    problem: null,
  };
  // Nothing below reads `body` again.
  body = null;

  if (arrival.callId === null) {
    arrival.problem = "The delivery named no call id, so there was nothing to check. Its contents were not kept.";
  } else {
    try {
      const call = await calle.getCall(arrival.callId);
      const disposition = normalizeCallsApi(call as never);
      arrival.call = publicCallView(call);
      arrival.reading = { disposition, spoken: say(disposition) };
    } catch (error) {
      arrival.callId = null;
      arrival.problem =
        error instanceof CalleApiError && error.status === 404
          ? "CALL-E has no call with that id on this account, so the delivery was not believed. Its contents were not kept."
          : "CALL-E could not be reached to check this delivery. Nothing from it was kept.";
    }
  }

  await push(inbox.id, deepMask(arrival) as Arrival);
  return json({ accepted: true, at: arrival.at }, { status: 202 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ inbox: string }> },
): Promise<NextResponse> {
  const segment = (await params).inbox;
  // Reads accept the bare id or the full address, and always need the read token.
  const id = parseInbox(segment)?.id ?? (/^[0-9a-f]{32}$/.test(segment) ? segment : null);

  if (id === null || !verify("inbox-read", id, request.headers.get(OPERATOR_HEADER), operatorSecret())) {
    return json({ error: "Reading this inbox needs its read token." }, { status: 401 });
  }
  if (!isWired()) {
    return json({ wired: false, arrivals: [] });
  }
  return json({ wired: true, arrivals: await read(id) });
}
