import type { Express } from "express";
import express from "express";
import { hardenedCalleRouter } from "../calle/router-hardened";
import { parseWebhook } from "../calle/webhook";

export function registerHardenedCalleWebhook(app: Express): void {
  app.post("/api/calle/webhook", express.raw({ type: "application/json" }), (req, res) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
      const event = parseWebhook(body, req.header("x-calle-signature") ?? undefined);
      res.json({ ok: true, callId: event.id, status: event.status });
    } catch (error) {
      res.status(401).json({
        ok: false,
        code: "INVALID_WEBHOOK",
        error: error instanceof Error ? error.message : "Invalid webhook",
      });
    }
  });
}

export function registerHardenedCalleRoutes(app: Express): void {
  // This router is deliberately mounted before any catch-all gateway that can select live transport.
  app.use("/api/calle", hardenedCalleRouter);
}
