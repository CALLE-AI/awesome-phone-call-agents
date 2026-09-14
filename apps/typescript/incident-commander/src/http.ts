import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { AppConfig } from "./config.js";
import type { Engine } from "./engine.js";
import { listIncidents, getIncident } from "./store.js";
import { parseCalleWebhook, webhookCallId } from "./calle/webhook.js";
import { scenarioCatalog } from "./scenarios.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export async function buildServer(config: AppConfig, engine: Engine) {
  const app = Fastify({ logger: true });
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(null, body);
    }
  });
  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, { root: publicDir, prefix: "/" });

  app.get("/", (_request, reply) => {
    return reply.type("text/html").send(createReadStream(join(publicDir, "index.html")));
  });

  app.get("/api/health", async () => engine.health());
  app.get("/api/scenarios", async () => scenarioCatalog());
  app.get("/api/incidents", async () => listIncidents());
  app.get("/api/incidents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const incident = await getIncident(id);
    if (!incident) return reply.code(404).send({ error: "not_found" });
    return incident;
  });
  app.post("/api/incidents/:id/sync", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const incident = await engine.syncIncident(id);
      if (!incident) return reply.code(404).send({ error: "not_found" });
      return incident;
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    reply.raw.write("\n");
    const send = (incident: { id: string }) => {
      reply.raw.write(`event: incident\ndata: ${JSON.stringify({ id: incident.id })}\n\n`);
    };
    const off = engine.onIncident(send);
    const ping = setInterval(() => reply.raw.write("event: ping\ndata: {}\n\n"), 15000);
    request.raw.on("close", () => {
      clearInterval(ping);
      off();
    });
  });

  app.post("/api/incidents", async (request, reply) => {
    const body = (request.body ?? {}) as {
      reason?: string;
      alarmName?: string;
      source?: string;
      scenarioId?: string;
    };
    try {
      const incident = await engine.openIncident({
        source: body.source ?? "console",
        triggerReason: body.reason ?? "Failure case page",
        alarmName: body.alarmName,
        scenarioId: body.scenarioId
      });
      return reply.code(202).send(incident);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/calle/webhook", async (request, reply) => {
    const parsed = await parseCalleWebhook(request);
    if ("error" in parsed) return reply.code(parsed.status).send({ error: parsed.error });
    if (parsed.duplicate) return { received: true, duplicate: true };
    const callId = webhookCallId(parsed.event);
    if (callId && parsed.event.data) {
      await engine.handleCalleCompletion(callId, parsed.event.data);
    }
    return { received: true };
  });

  app.post("/hooks/sns", async (request, reply) => {
    const body = request.body as Record<string, unknown> | string;
    const envelope = typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : body;
    const type = String(envelope.Type ?? envelope.type ?? "");
    if (type === "SubscriptionConfirmation" && typeof envelope.SubscribeURL === "string") {
      await fetch(envelope.SubscribeURL);
      return { subscribed: true };
    }
    const messageRaw = envelope.Message ?? envelope.message ?? envelope;
    const message =
      typeof messageRaw === "string" ? (JSON.parse(messageRaw) as Record<string, unknown>) : (messageRaw as Record<string, unknown>);
    const alarmName = String(message.AlarmName ?? message.alarmName ?? config.CW_ALARM_NAME ?? "");
    const state = String(message.NewStateValue ?? message.newStateValue ?? "");
    const reason = String(message.NewStateReason ?? message.newStateReason ?? "CloudWatch SNS notification");
    if (state && state !== "ALARM") {
      return { ignored: true, state };
    }
    const incident = await engine.openIncident({
      source: "sns.cloudwatch",
      triggerReason: reason,
      alarmName: alarmName || undefined
    });
    return reply.code(202).send({ incidentId: incident.id });
  });

  app.post("/hooks/alert", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const alarmName = typeof body.alarmName === "string" ? body.alarmName : undefined;
    const reason =
      typeof body.reason === "string"
        ? body.reason
        : typeof body.alarmDescription === "string"
          ? body.alarmDescription
          : JSON.stringify(body).slice(0, 500);
    const incident = await engine.openIncident({
      source: typeof body.source === "string" ? body.source : "webhook.alert",
      triggerReason: reason,
      alarmName
    });
    return reply.code(202).send(incident);
  });

  return app;
}
