import { Router, type Request, type Response } from "express";
import { CallService } from "./service";
import { createBatch } from "./batch";
import { summarize, outcomeCounts } from "./analytics";
import { ingestEvent } from "./webhook";
import { health } from "./health";
import { reconcileOpenCalls } from "./reconcile";
import type { CallRepository } from "./repository";
import type { Provider } from "./types";
import type { CalleV4Config } from "./config";
import { redactObject, sanitizeText } from "../calle/utilities";

function userIdFrom(req: Request): string {
  const header = req.headers["x-user-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return "demo-user";
}

export function createCalleRouter(opts: {
  service: CallService;
  repo: CallRepository;
  provider: Provider;
  config: CalleV4Config;
}): Router {
  const { service, repo, provider, config } = opts;
  const router = Router();

  // Preserve private call objects internally while sanitizing every V4 operator
  // response immediately before it leaves Express.
  router.use((_req, res, next) => {
    const sendJson = res.json.bind(res);
    res.json = ((body: unknown) => sendJson(redactObject(body))) as typeof res.json;
    next();
  });

  router.get("/health", async (_req, res) => {
    try {
      res.json(await health(provider, config));
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Health check failed";
      res.status(503).json({ ok: false, error: message });
    }
  });

  router.post("/calls", async (req: Request, res: Response) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ error: "Request body is required" });
        return;
      }
      const userId = userIdFrom(req);
      const phones: string[] = Array.isArray(req.body?.phones)
        ? req.body.phones
        : req.body?.recipients
          ? req.body.recipients.flatMap((recipient: { phones?: string[] }) => recipient.phones ?? [])
          : [];
      if (!phones.length && !Array.isArray(req.body.recipients)) {
        res.status(400).json({ error: "At least one recipient phone is required" });
        return;
      }
      const call = await service.create(userId, {
        task: req.body.task,
        recipients: phones.length ? [{ phones }] : req.body.recipients,
        resultSchema: req.body.resultSchema,
        recipientResultSchema: req.body.recipientResultSchema,
        webhookUrl: req.body.webhookUrl,
        metadata: {
          ...(req.body.metadata ?? {}),
          client_request_id: req.body.clientRequestId ?? req.body.metadata?.client_request_id,
          consent: req.body.consent === true || req.body.metadata?.consent === "true" ? "true" : req.body.metadata?.consent,
          region: req.body.region ?? req.body.metadata?.region,
        },
      });
      res.status(201).json(call);
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "CALL-E request failed";
      res.status(400).json({ error: message });
    }
  });

  router.get("/calls/:id", async (req: Request, res: Response) => {
    try {
      if (!req.params.id?.trim()) {
        res.status(400).json({ error: "Call id is required" });
        return;
      }
      res.json(await service.refresh(req.params.id));
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Provider refresh failed";
      res.status(502).json({ error: message });
    }
  });

  router.get("/calls/:id/events", async (req: Request, res: Response) => {
    try {
      const local = await service.events(req.params.id);
      if (local.length > 0) {
        res.json({ events: local });
        return;
      }
      res.json(await provider.getEvents(req.params.id, req.query.cursor as string | undefined));
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Events lookup failed";
      res.status(502).json({ error: message });
    }
  });

  router.post("/calls/:id/reconcile", async (req: Request, res: Response) => {
    try {
      res.json(await service.reconcile(req.params.id));
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Reconcile failed";
      res.status(502).json({ error: message });
    }
  });

  router.post("/batch", async (req: Request, res: Response) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const calls = await createBatch(service, userIdFrom(req), items);
      res.status(201).json({ calls });
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Batch failed";
      res.status(400).json({ error: message });
    }
  });

  router.get("/analytics", async (req: Request, res: Response) => {
    try {
      const calls = await service.list(userIdFrom(req));
      res.json({
        summary: summarize(calls),
        reached: outcomeCounts(calls, "reached"),
      });
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Analytics failed";
      res.status(500).json({ error: message });
    }
  });

  router.post("/reconcile", async (req: Request, res: Response) => {
    try {
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
      res.json({ results: await reconcileOpenCalls(provider, repo, ids) });
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Bulk reconcile failed";
      res.status(502).json({ error: message });
    }
  });

  return router;
}

export function webhookHandler(repo: CallRepository, secret?: string) {
  return async (req: Request, res: Response) => {
    try {
      const rawBody = (req as Request & { rawBody?: string | Buffer }).rawBody;
      const raw =
        typeof rawBody === "string"
          ? rawBody
          : Buffer.isBuffer(rawBody)
            ? rawBody.toString("utf8")
            : typeof req.body === "string"
              ? req.body
              : Buffer.isBuffer(req.body)
                ? req.body.toString("utf8")
                : JSON.stringify(req.body ?? {});
      const signature =
        (req.headers["x-calle-signature"] as string | undefined) ??
        (req.headers["x-webhook-signature"] as string | undefined);
      const result = await ingestEvent(raw, repo, secret, signature);
      res.status(result.deduplicated ? 200 : 202).json(redactObject(result));
    } catch (error) {
      const message = error instanceof Error ? sanitizeText(error.message) : "Webhook rejected";
      const status = message.includes("signature") ? 401 : 400;
      res.status(status).json({ error: message });
    }
  };
}
