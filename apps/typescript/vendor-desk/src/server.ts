import express, { Request, Response } from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { config, assertCalleConfigured } from "./config";
import { store } from "./db/store";
import { dispatchVendorCall } from "./calle/client";
import { CallJob, CallJobStatus, CalleWebhookEvent, DispatchRequestBody, ExtractedQuote, VendorTask } from "./types";

const app = express();
app.use(cors());
app.use(express.json());

// --- Server-Sent Events, so the dashboard updates live as calls complete ---
const sseClients = new Set<Response>();

function broadcastJobUpdate(job: CallJob): void {
  const payload = `data: ${JSON.stringify(job)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

app.get("/api/jobs/stream", (req: Request, res: Response) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// --- Dispatch a new sourcing run: one call per vendor, in parallel ---
app.post("/api/calls/dispatch", async (req: Request, res: Response) => {
  try {
    assertCalleConfigured();
    const body = req.body as DispatchRequestBody;

    if (!body?.item || !body?.targetQuantity || !Array.isArray(body?.vendors) || body.vendors.length === 0) {
      return res.status(400).json({
        error: "Request must include item, targetQuantity, and a non-empty vendors array.",
      });
    }

    const createdJobs: CallJob[] = [];

    for (const vendor of body.vendors) {
      const task: VendorTask = {
        id: nanoid(8),
        vendorName: vendor.vendorName,
        phoneNumber: vendor.phoneNumber,
        region: vendor.region ?? config.defaults.region,
        locale: vendor.locale ?? config.defaults.locale,
        item: body.item,
        targetQuantity: body.targetQuantity,
      };

      const job: CallJob = {
        id: nanoid(10),
        calleCallId: null,
        task,
        status: "pending",
        quote: null,
        transcript: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.createJob(job);
      createdJobs.push(job);

      dispatchVendorCall(job.id, task)
        .then((call) => {
          if (call.status === "simulated") {
            // Dry-run: no real call was placed, so no webhook will ever
            // arrive. Resolve the job immediately instead of leaving it
            // stuck on "in-progress" forever.
            const updated = store.updateJob(job.id, {
              calleCallId: call.id,
              status: "completed",
              error: null,
              transcript: null,
              quote: null,
            });
            if (updated) broadcastJobUpdate(updated);
            return;
          }
          const updated = store.updateJob(job.id, {
            calleCallId: call.id,
            status: "in-progress",
          });
          if (updated) broadcastJobUpdate(updated);
        })
        .catch((err) => {
          console.error(`Dispatch failed for job ${job.id}:`, err);
          const updated = store.updateJob(job.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
          if (updated) broadcastJobUpdate(updated);
        });
    }

    res.status(202).json({ jobs: createdJobs });
  } catch (err) {
    console.error("Dispatch error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// --- CALL-E webhook: terminal call result lands here ---
//
// CALL-E sends an *event envelope* ({ id, type, data }), not a flat payload.
// Rule of thumb: ACK with 2xx as soon as the envelope is structurally
// parseable, regardless of the business outcome inside it. Only return
// non-2xx if the request body itself can't be understood — otherwise CALL-E
// will retry a handful of times, give up, and the job is stuck forever.
app.post("/api/calle-webhook", (req: Request, res: Response) => {
  const event = req.body as CalleWebhookEvent;

  // NOTE: the call id field is `data.id`, not `data.call_id`.
  if (!event?.data?.id || !event?.type) {
    console.warn("Malformed CALL-E webhook envelope:", JSON.stringify(req.body));
    return res.status(400).json({ error: "Missing type or data.id in webhook envelope." });
  }

  const job = store.getJobByCalleCallId(event.data.id);
  if (!job) {
    console.warn(`Webhook received for unknown call_id: ${event.data.id}`);
    return res.status(200).json({ ok: true, note: "No matching local job for this call_id." });
  }

  // Transcript is nested, not a flat string: data.recipients[0].attempts[0].transcript_turns
  const turns = event.data.recipients?.[0]?.attempts?.[0]?.transcript_turns ?? [];
  const transcript =
    turns.length > 0
      ? turns.map((t) => `[${t.speaker ?? "?"}] ${t.text ?? ""}`).join("\n")
      : null;

  let status: CallJobStatus;
  let quote: ExtractedQuote | null = null;
  let errorMessage: string | null = null;

  switch (event.type) {
    case "call.completed": {
      status = "completed";
      const result = event.data.structured_result ?? {};
      quote = {
        inStock: Boolean(result.in_stock),
        unitPrice: typeof result.unit_price === "number" ? result.unit_price : null,
        alternativeOffered: typeof result.alternative_offered === "string" ? result.alternative_offered : null,
        deliveryAvailable: typeof result.delivery_available === "boolean" ? result.delivery_available : null,
        representativeName: typeof result.representative_name === "string" ? result.representative_name : null,
        notes: typeof result.notes === "string" ? result.notes : null,
      };
      break;
    }
    case "call.result_validation_failed": {
      // The call connected and completed, but the reply didn't match our
      // result_schema (e.g. a test line with no real pricing to give).
      status = "failed";
      errorMessage = event.data.summary ?? "CALL-E could not extract structured result data from this call.";
      break;
    }
    default: {
      status = "failed";
      errorMessage = event.data.failure_message ?? event.data.summary ?? `Call ended with event type: ${event.type}`;
      break;
    }
  }

  const updated = store.updateJob(job.id, {
    status,
    quote,
    transcript,
    error: errorMessage,
  });

  if (updated) broadcastJobUpdate(updated);
  res.status(200).json({ ok: true });
});

// --- List all jobs (used for initial dashboard load) ---
app.get("/api/jobs", (_req: Request, res: Response) => {
  res.json({ jobs: store.listJobs() });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`VendorDesk server listening on http://localhost:${config.port}`);
  console.log(`CALL-E webhook target: ${config.webhook.url}`);
});
