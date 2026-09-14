import express from "express";

import { CalleService } from "./api-service";
import { CalleError } from "./errors";
import { scenarios } from "./scenarios";
import { CreateCallRequestSchema } from "./types";
import { redactObject } from "./utilities";
import { parseWebhook } from "./webhook";

const service = new CalleService();

export const calleRouter = express.Router();

function sendError(res: express.Response, error: unknown) {
  const err = error as CalleError;
  const status = typeof err?.status === "number" ? err.status : 500;
  const code = typeof err?.code === "string" ? err.code : "UNKNOWN";
  res.status(status).json({
    ok: false,
    code,
    error: err?.message ?? "Unknown error",
    details: redactObject(err?.details),
  });
}

calleRouter.get("/health", (_req, res) => {
  res.json({ ok: true, provider: "CALL-E", timestamp: new Date().toISOString() });
});

calleRouter.get("/scenarios", (_req, res) => {
  res.json({ ok: true, data: scenarios });
});

calleRouter.post("/calls", async (req, res) => {
  const parsed = CreateCallRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "INVALID_REQUEST", issues: parsed.error.issues });
    return;
  }
  try {
    const data = await service.createCall(parsed.data);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

calleRouter.get("/calls/:callId", async (req, res) => {
  try {
    res.json({ ok: true, data: await service.getCall(req.params.callId) });
  } catch (error) {
    sendError(res, error);
  }
});

calleRouter.get("/calls/:callId/events", async (req, res) => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    res.json({ ok: true, data: await service.getEvents(req.params.callId, cursor) });
  } catch (error) {
    sendError(res, error);
  }
});

calleRouter.post("/webhook", (req, res) => {
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
    res.json({ ok: true, callId: event.id, status: event.status });
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid webhook",
    });
  }
});
