import type { Express } from "express";
import express from "express";
import { hardenedCalleRouter } from "../calle/router-hardened";
import { acceptCalleWebhook } from "../calle/webhook";
import { publicError, redactObject } from "../calle/utilities";

export function registerHardenedCalleWebhook(app: Express): void {
  app.post("/api/calle/webhook", express.raw({ type: "application/json" }), (req, res) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
      const receipt = acceptCalleWebhook(body, req.header("x-calle-signature") ?? undefined);
      res.status(receipt.duplicate ? 200 : 202).json(redactObject({
        ok: true,
        duplicate: receipt.duplicate,
        receiptId: receipt.receiptId,
        callId: receipt.event.id,
        status: receipt.event.status,
      }));
    } catch (error) {
      const safe = publicError(error);
      res.status(401).json({
        ok: false,
        code: "INVALID_WEBHOOK",
        error: safe.message,
      });
    }
  });
}

export function registerHardenedCalleRoutes(app: Express): void {
  // This router is deliberately mounted before any catch-all gateway that can select live transport.
  app.use("/api/calle", hardenedCalleRouter);
}
