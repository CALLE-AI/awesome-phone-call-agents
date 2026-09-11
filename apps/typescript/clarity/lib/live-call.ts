import type { Call } from "@call-e/calle";
import { buildResultSchema, buildTask, calleClient } from "./calle";
import { normalizeCall } from "./call-record";
import { destination } from "./phone";
import { primaryClarification } from "./result";
import { getSession, releaseDestination, reserveDestination, SessionConflict, updateSession, withSessionLock } from "./session";
import type { Session } from "./types";

export class CallProblem extends Error {
  constructor(message: string, public status: number, public ambiguous = false) { super(message); }
}

export const AMBIGUOUS_MESSAGE = "Call acceptance is unknown. Calling is halted. Reconcile the existing call with its CALL-E call ID; do not start another call.";

export async function ownedSession(id: string, owner: string): Promise<Session> {
  const session = await getSession(id);
  if (!session || session.ownerId !== owner) throw new CallProblem("Unknown session.", 404);
  return session;
}

export async function authorizeDestination(id: string, owner: string, phone: string): Promise<Session> {
  const recipient = destination(phone);
  return withSessionLock(id, async () => {
    const session = await ownedSession(id, owner);
    if (session.replay || session.callId || session.createState) {
      throw new CallProblem("This session cannot accept new destination consent.", 409);
    }
    const now = Date.now();
    return (await updateSession(id, { authorization: {
      ...recipient, ownerId: owner, consentAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
    } }))!;
  });
}

/** Verify the provider read belongs to precisely the call intent we stored. */
export function verifyCall(call: Call, session: Session, expectedId?: string): void {
  const consent = session.authorization;
  const recipient = call.recipients?.[0];
  if (!consent || typeof call.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
      !["queued", "in_progress", "completed", "failed", "canceled"].includes(call.status) ||
      !Number.isFinite(Date.parse(call.createdAt)) || (expectedId && call.id !== expectedId) ||
      call.metadata?.app !== "clarity" || call.metadata?.session_id !== session.id ||
      call.recipients?.length !== 1 || recipient?.phones.length !== 1 ||
      recipient.phones[0] !== consent.phone || recipient.region !== consent.region ||
      recipient.attempts.some((attempt) => attempt.phone !== consent.phone)) {
    throw new CallProblem("Provider call does not match the authorized session and destination.", 409);
  }
}

export async function startLiveCall(id: string, owner: string) {
  return withSessionLock(id, async () => {
    const session = await ownedSession(id, owner);
    if (session.callId) return { callId: session.callId, alreadyPlaced: true };
    if (session.createState) throw new CallProblem(AMBIGUOUS_MESSAGE, 409, true);
    const consent = session.authorization;
    if (!consent || consent.ownerId !== owner || (!Number.isFinite(Date.parse(consent.expiresAt)) || Date.parse(consent.expiresAt) <= Date.now())) {
      throw new CallProblem("Confirm consent for the exact destination before calling (consent expires after 10 minutes).", 403);
    }
    const recipient = destination(consent.phone);
    if (recipient.region !== consent.region || recipient.locale !== consent.locale) {
      throw new CallProblem("Destination routing changed; confirm consent again.", 403);
    }
    const clarification = primaryClarification(session);
    if (!clarification) throw new CallProblem("This session has nothing to clarify.", 400);
    const client = calleClient(); // Validate credentials and origin before reserving or creating.
    await reserveDestination(session);
    await updateSession(id, { createState: "creating" }); // Failure here must prevent the network call.
    try {
      const call = await client.calls.create({
        task: buildTask(clarification, {
          candidateName: session.application.candidateName, roleTitle: session.application.roleTitle,
        }),
        recipients: [{ phones: [consent.phone], region: consent.region, locale: consent.locale }],
        resultSchema: buildResultSchema(clarification),
        metadata: { app: "clarity", session_id: id },
      }, { idempotencyKey: `clarity:${id}` });
      verifyCall(call, session);
      const record = normalizeCall(call);
      await updateSession(id, { callId: record.callId, call: record, createState: "accepted" });
      await releaseDestination(session);
      return { callId: record.callId, status: record.status };
    } catch {
      // Do not repeat POST, even with idempotency: a timeout or invalid response may have dialed.
      await updateSession(id, { createState: "ambiguous" }).catch(() => undefined);
      throw new CallProblem(AMBIGUOUS_MESSAGE, 409, true);
    }
  });
}

export async function reconcileCall(id: string, owner: string, callId: string) {
  return withSessionLock(id, async () => {
    const session = await ownedSession(id, owner);
    if (session.replay || !session.createState || (session.callId && session.callId !== callId)) {
      throw new CallProblem("No matching live call to reconcile.", 409);
    }
    const call = await calleClient().calls.get(callId); // Read only; never creates.
    verifyCall(call, session, callId);
    const record = normalizeCall(call);
    await updateSession(id, { callId, call: record, createState: "accepted" });
    await releaseDestination(session);
    return { callId, status: record.status };
  });
}

export function callError(error: unknown) {
  if (error instanceof CallProblem) return { error: error.message, status: error.status, ambiguous: error.ambiguous };
  if (error instanceof SessionConflict) return { error: error.message, status: 409, ambiguous: true };
  // Provider exceptions can contain credentials, request bodies, or phone numbers.
  return { error: "Call operation failed. Check server configuration and reconcile any interrupted call.", status: 502, ambiguous: false };
}
