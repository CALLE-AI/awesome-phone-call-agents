import { NextResponse } from "next/server";

import { CalleApiError, CalleClient } from "asheard/calle";
import { normalizeCallsApi } from "asheard/disposition";
import {
  buildEvidence,
  withFlags,
  classify,
  phrase,
  destinationById,
  isAllowedDestination,
  publicCallView,
  type EventPage,
} from "asheard/reconciler";

import { spendOne } from "@/lib/budget";
import { RedisIntents, haltReason, validIntentKey } from "@/lib/intents";
import { deepMask } from "@/lib/mask";
import { OPERATOR_HEADER, operatorSecret, verify } from "@/lib/operator";
import { issueReadToken, readTokenValid } from "@/lib/readtoken";
import { pipeline } from "@/lib/redis";

/**
 * The one route in this app that can ring a phone.
 *
 * Gates, in order, before anything is dialled:
 *
 *   1. the destination has to be one of ours, checked on the resolved number
 *      rather than the id, so a real id with a swapped number is refused
 *   2. the request has to carry an operator token minted for that exact
 *      number. Only the server secret can produce one, so a browser cannot
 *      make its own, and a token for one number cannot dial another
 *   3. the intent is written down before the request leaves, keyed on the
 *      press rather than the clock, and nothing outside `reserved` is ever
 *      dialled again
 *   4. the daily and per-visitor budget has to have room, failing closed
 *
 * The CALL-E key comes from the server environment and is never accepted from
 * the browser.
 *
 * GET will only read a call whose read token it issued, and answers with an
 * allowlisted projection rather than the payload. Every response from this
 * route, both ways, is masked all the way down on the way out.
 */

export const dynamic = "force-dynamic";

function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(deepMask(body), init);
}

/**
 * The question, in CALL-E's own words.
 *
 * Copied from the calls guide, which says the API returns no built-in AMD
 * disposition and no answered-by field, and that you define the classification
 * yourself. Sending this is the only difference between the two calls the demo
 * places.
 */
const ANSWERED_BY_SCHEMA = {
  type: "object",
  required: ["answered_by"],
  properties: {
    answered_by: {
      type: "string",
      enum: ["human", "ivr", "voicemail", "unknown"],
      description:
        "Classify the final endpoint. If an IVR transfers the call to a person, use human.",
    },
  },
  additionalProperties: false,
} as const;

interface CreateBody {
  destinationId?: unknown;
  /**
   * One press of the button, named by the browser.
   *
   * This is for idempotency only. It lets a retry after a lost response find
   * the call that already exists. It authorizes nothing: that is the operator
   * token's job, checked before this is even looked at.
   */
  intentKey?: unknown;
  /** Whether to send the per-recipient schema that asks who picked up. */
  askWhoAnswered?: unknown;
}

/** Coarse, never stored, for the per-visitor budget only. */
function visitorId(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() ?? "";
  return ip !== "" ? ip : "unknown";
}

function client(): CalleClient | null {
  const apiKey = process.env.CALLE_API_KEY?.trim() ?? "";
  return apiKey === "" ? null : new CalleClient({ apiKey });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return json({ error: "That was not JSON." }, { status: 400 });
  }

  const id = typeof body.destinationId === "string" ? body.destinationId : "";
  const destination = destinationById(id);
  if (destination === null) {
    return json({ error: "That is not one of the numbers this demo can call." }, { status: 400 });
  }

  // The id resolved, but the guard runs on the number itself.
  if (!isAllowedDestination(destination.e164)) {
    return json({ error: "Refused." }, { status: 400 });
  }

  const secret = operatorSecret();
  if (secret === null) {
    return json(
      { error: "Dialling is off on this deployment. There is no operator secret configured." },
      { status: 503 },
    );
  }
  // Bound to the resolved number, not the id or anything the body says.
  if (!verify("dial", destination.e164, request.headers.get(OPERATOR_HEADER), secret)) {
    return json(
      { error: "Dialling needs an operator token for this exact number. Nothing was dialled." },
      { status: 401 },
    );
  }

  const ask = body.askWhoAnswered === true;

  if (!validIntentKey(body.intentKey)) {
    return json(
      { error: "That request carried no usable intent key, so nothing was dialled." },
      { status: 400 },
    );
  }
  const intentKey = body.intentKey;

  const calle = client();
  if (calle === null) {
    return json({ error: "The demo has no key configured, so it cannot place a call." }, { status: 503 });
  }

  /**
   * What was approved, in the package's own shape.
   *
   * The two lanes differ only by `purpose`, so one press produces two intents
   * and two keys. Nothing here is the clock: the same press retried is the same
   * intent, forever.
   */
  const authorization = {
    workflowId: `live_${intentKey}`,
    purpose: ask ? "who-answered-probe" : "baseline-probe",
    destination: destination.e164,
    contractVersion: "live-v2",
  };

  const intents = new RedisIntents(pipeline);

  let reservation;
  try {
    reservation = await intents.reserve(authorization, "calls-api");
  } catch {
    // If the intent cannot be written down, nothing stops a retry ringing the
    // phone twice, so do not dial.
    return json(
      { error: "The demo could not record what it was about to do, so it did not place a call." },
      { status: 503 },
    );
  }

  let intent = reservation.intent;

  if (intent.boundId !== null) {
    return json({
      callId: intent.boundId,
      readToken: issueReadToken(intent.boundId),
      requestedAt: intent.createdAt,
      destination: publicDestination(destination),
      askedWhoAnswered: ask,
      replayed: true,
    });
  }

  if (intent.state !== "reserved") {
    return json({ error: haltReason(intent), intentState: intent.state }, { status: 409 });
  }

  const budget = await spendOne(visitorId(request));
  if (!budget.allowed) {
    return json({ error: budget.reason }, { status: 429 });
  }

  const requestedAt = new Date().toISOString();

  // Written down as sent before it is sent. A crash between these lines leaves
  // a record that says "this may have gone out", which is the truth.
  try {
    intent = await intents.advance(intent, "submission_unknown");
  } catch {
    return json(
      { error: "The demo could not record what it was about to do, so it did not place a call." },
      { status: 503 },
    );
  }

  try {
    const call = await calle.createCall(
      {
        task: destination.task,
        recipients: [{ phones: [destination.e164], region: "US", locale: "en-US" }],
        result_schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["answer", "evidence"],
        },
        ...(ask ? { recipient_result_schema: ANSWERED_BY_SCHEMA } : {}),
      },
      intent.idempotencyKey,
    );

    await intents.advance(intent, "accepted", { boundId: call.id });

    return json({
      callId: call.id,
      readToken: issueReadToken(call.id),
      requestedAt,
      destination: publicDestination(destination),
      askedWhoAnswered: ask,
      remainingToday: budget.remainingToday,
    });
  } catch (error) {
    if (error instanceof CalleApiError && refusedOutright(error.status)) {
      await intents
        .advance(intent, "needs_human", { reasons: [`CALL-E refused the request: ${error.message}`] })
        .catch(() => undefined);
      return json({ error: `CALL-E refused the call: ${error.message}` }, { status: 502 });
    }

    // Anything else is ambiguous. The intent stays at submission_unknown, which
    // has no way back, so this press will never be dialled again.
    return json(
      {
        error:
          "The request went out and CALL-E did not say whether it landed. Nothing will be sent again under this press, because that is how a person gets rung twice.",
        intentState: "submission_unknown",
      },
      { status: 409 },
    );
  }
}

/** Only 400, 401, 403, 404 and 422 mean nothing was created. Everything else is ambiguous. */
function refusedOutright(status: number): boolean {
  return [400, 401, 403, 404, 422].includes(status);
}

/** The fields of a destination that are safe to hand back. The number never is. */
function publicDestination(destination: { id: string; label: string; expectation: string; why: string }) {
  return {
    id: destination.id,
    label: destination.label,
    expectation: destination.expectation,
    why: destination.why,
  };
}

/**
 * Read the call back, both ways: the allowlisted projection of what the
 * platform returned, and what this library makes of it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const callId = url.searchParams.get("callId")?.trim() ?? "";
  const requestedAt = url.searchParams.get("requestedAt")?.trim() ?? "";
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (callId === "") {
    return json({ error: "No call id." }, { status: 400 });
  }

  // A call id is not a capability. The read token is only issued to a POST
  // that got past the operator check.
  if (!readTokenValid(callId, token)) {
    return json(
      { error: "This call was not placed by this demo, or the read token is missing." },
      { status: 403 },
    );
  }

  const calle = client();
  if (calle === null) {
    return json({ error: "No key configured." }, { status: 503 });
  }

  try {
    const call = await calle.getCall(callId);

    let events: EventPage[] = [];
    try {
      events = [(await calle.listEvents(callId)) as EventPage];
    } catch {
      events = [];
    }

    const read = normalizeCallsApi(call as never);
    const evidence = withFlags(
      buildEvidence({ payload: call, events, read }),
      requestedAt !== "" ? { requestedAt } : {},
    );
    const ranked = classify(evidence);

    return json({
      platform: publicCallView(call),
      evidence,
      band: ranked.band,
      because: ranked.because,
      spoken: phrase(ranked),
    });
  } catch (error) {
    if (error instanceof CalleApiError) {
      return json({ error: error.message }, { status: error.status });
    }
    return json({ error: "Could not read that call." }, { status: 502 });
  }
}
