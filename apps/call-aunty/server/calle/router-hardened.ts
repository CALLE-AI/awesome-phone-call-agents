import express from "express";
import { CalleService } from "./api-service";
import { HardenedCalleGateway } from "./client-hardened";
import { loadHardenedCalleConfig } from "./config-hardening";
import { CalleError } from "./errors";
import { buildDirectGatewayContext } from "./live-gate";
import { getOperatorPrincipal, requireOperator } from "./operator-auth";
import { authorizeDirectRecipientSet } from "./recipient-authority";
import { CreateCallRequestSchema } from "./types";
import { publicError, redactObject } from "./utilities";
import { scenarios } from "./scenarios";
import { parseWebhook } from "./webhook";
import { isManualReviewError } from "./uncertain-state";

export const hardenedCalleRouter = express.Router();

function sendError(res: express.Response, error: unknown): void {
  const err = error as CalleError & { status?: number };
  const manualReview = isManualReviewError(error);
  const safe = publicError(error);
  res.status(manualReview ? 409 : (typeof err?.status === "number" ? err.status : 500)).json(redactObject({
    ok: false,
    state: manualReview ? "unknown" : "error",
    manualReviewRequired: manualReview || undefined,
    code: safe.code,
    error: safe.message,
    details: safe.details,
    requestId: safe.requestId,
  }));
}

function serviceFor(req: express.Request, res: express.Response, recipientAuthorized: boolean): CalleService {
  const principal = getOperatorPrincipal(res);
  return new CalleService(new HardenedCalleGateway(buildDirectGatewayContext(req, {
    operatorAuthorized: principal.authenticated,
    recipientAuthorized,
  })));
}

hardenedCalleRouter.get("/health", (_req, res) => {
  const config = loadHardenedCalleConfig();
  res.json({
    ok: true,
    provider: "CALL-E",
    mode: config.mode,
    liveCallsEnabled: config.liveCallsEnabled,
    killSwitch: config.killSwitch,
    liveIntentRequired: config.liveIntentRequired,
    liveLoopbackOnly: config.liveLoopbackOnly,
    timestamp: new Date().toISOString(),
  });
});

// Direct provider operations are server-operator tools. The Expo application uses tRPC workflows.
hardenedCalleRouter.get("/scenarios", requireOperator, (_req, res) => {
  res.json(redactObject({ ok: true, data: scenarios }));
});

hardenedCalleRouter.post("/calls", requireOperator, async (req, res) => {
  const parsed = CreateCallRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(redactObject({ ok: false, code: "INVALID_REQUEST", issues: parsed.error.issues }));
    return;
  }

  const config = loadHardenedCalleConfig();
  const operatorPrincipal = getOperatorPrincipal(res);
  const recipient = authorizeDirectRecipientSet(parsed.data, {
    loopbackScope: config.liveLoopbackOnly,
    operatorAuthorized: operatorPrincipal.authenticated,
  });
  if (!recipient.valid) {
    res.status(400).json(redactObject({ ok: false, code: "INVALID_RECIPIENT", error: recipient.reason }));
    return;
  }

  const requestedLive = req.header("x-calle-live-intent") === "confirm-live-v1";
  if (requestedLive && !recipient.authorized) {
    res.status(403).json(redactObject({ ok: false, code: "RECIPIENT_AUTH_REQUIRED", error: recipient.reason }));
    return;
  }

  try {
    const data = await serviceFor(req, res, requestedLive ? recipient.authorized : true).createCall(parsed.data);
    res.status(201).json(redactObject({ ok: true, state: "known", data }));
  } catch (error) {
    sendError(res, error);
  }
});

hardenedCalleRouter.get("/calls/:callId", requireOperator, async (req, res) => {
  try {
    const data = await serviceFor(req, res, true).getCall(req.params.callId);
    res.json(redactObject({ ok: true, state: "known", data }));
  } catch (error) {
    sendError(res, error);
  }
});

hardenedCalleRouter.get("/calls/:callId/events", requireOperator, async (req, res) => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const data = await serviceFor(req, res, true).getEvents(req.params.callId, cursor);
    res.json(redactObject({ ok: true, state: "known", data }));
  } catch (error) {
    sendError(res, error);
  }
});

// Webhooks use their own HMAC protection and deliberately do not rely on operator auth.
hardenedCalleRouter.post("/webhook", (req, res) => {
  try {
    const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
    const body = Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body ?? {});
    const event = parseWebhook(body, req.header("x-calle-signature") ?? undefined);
    res.json(redactObject({ ok: true, callId: event.id, status: event.status }));
  } catch (error) {
    const safe = publicError(error);
    res.status(401).json(redactObject({ ok: false, code: "INVALID_WEBHOOK", error: safe.message }));
  }
});
