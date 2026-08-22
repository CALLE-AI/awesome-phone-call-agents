import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import http from "http";
import cors from "cors";
import cron from "node-cron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authStatus, startCall, callStatus, DRY_RUN } from "./calle.js";
import { regionFromPhone } from "./phone-region.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data", "appointments.json");


const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
  "VOICEMAIL",
  "BUSY",
  "EXPIRED",
]);

const clients=new Set();

async function loadAppointments() {
  const raw = await readFile(DATA_PATH, "utf-8");
  return JSON.parse(raw);
}

async function saveAppointments(appointments) {
  await writeFile(DATA_PATH, JSON.stringify(appointments, null, 2));
}

function broadcastAppointmentUpdate(appointment) {
  const message = JSON.stringify({
    type: "appointment_update",
    data: appointment
  });
  
  clients.forEach((client) => {
    if (client.readyState === WebSocketServer.OPEN) {
      client.send(message);
    }
  });
}

// Build a goal string for the calle call based on the appointment details

function buildGoal(appt) {
  const when = new Date(appt.scheduledAt).toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    `Confirm ${appt.patientName}'s ${appt.service} appointment on ${when}. ` +
    `If they can't make it, ask if they'd like to reschedule and note their preferred new time. ` +
    `Be brief and friendly.`
  );
}

function extractFields(structuredContent) {
  if (!structuredContent) return {};
  const result = structuredContent.result ?? {};
  return {
    status: structuredContent.status ?? null,
    activity: structuredContent.activity ?? [],
    summary: result.post_summary ?? result.summary ?? null,
    transcript: result.transcript ?? null,
  };
}

async function pollCallStatus(appointmentId, runId) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));

    let result;
    try {
      result = await callStatus({ runId });
    } catch (err) {
      console.error(`Status poll failed for ${runId}:`, err.message);
      return;
    }
    if (!result.ok) {
      console.error(`Status poll error for ${runId}:`, result.error);
      return;
    }

    const fields = extractFields(result.result?.structuredContent);
    const appointments = await loadAppointments();
    const idx = appointments.findIndex((a) => a.id === appointmentId);
    if (idx === -1) return;

    appointments[idx] = { ...appointments[idx], ...fields };
    await saveAppointments(appointments);

    broadcastAppointmentUpdate(appointments[idx]);

    if (fields.status && TERMINAL_STATUSES.has(fields.status)) return;
  }
}

async function triggerCall(appointments, apptId) {
  const idx = appointments.findIndex((a) => a.id === apptId);
  if (idx === -1) return { ok: false, error: "not found" };

  const appt = appointments[idx];

  // Refuse to start a second call while one is already in flight for this
  // appointment - without this, a double-click (or the batch job racing a
  // manual confirm) would dial the patient twice.
  if (appt.runId && !TERMINAL_STATUSES.has(appt.status)) {
    return {
      ok: false,
      code: "call_in_progress",
      error: "A call for this appointment is already in progress",
    };
  }

  const goal = buildGoal(appt);
  const region = regionFromPhone(appt.phone);

  let result;
  try {
    result = await startCall({ toPhone: appt.phone, goal, region });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!result.ok) {
    return { ok: false, error: result.error?.message ?? "call start failed" };
  }

  const runId = result.run_id;
  const fields = extractFields(result.status_result?.structuredContent);

  appointments[idx] = {
    ...appt,
    runId,
    ...fields,
    status: fields.status ?? "STARTED",
  };

  broadcastAppointmentUpdate(appointments[idx]);

  pollCallStatus(appt.id, runId);
  return { ok: true, appointment: appointments[idx] };
}

async function runNightlyBatch() {
  const appointments = await loadAppointments();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = tomorrow.toISOString().slice(0, 10);

  const targetIds = appointments
    .filter((a) => a.scheduledAt.slice(0, 10) === targetDate && a.status === "PENDING")
    .map((a) => a.id);

  const triggered = [];
  for (const id of targetIds) {
    const outcome = await triggerCall(appointments, id);
    if (outcome.ok) triggered.push(id);
  }

  await saveAppointments(appointments);

  // Note: triggerCall() already broadcasts each appointment's update as it
  // fires, so there's nothing left to broadcast here.
  return triggered;
}

const app = express();
app.use(cors());
app.use(express.json());

const server=http.createServer(app);
const wss= new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("WebSocket client connected. Total clients:", clients.size);

  ws.on("message",(data)=>{
    try{
      const parsed=JSON.parse(data);
      if(parsed.type==="ping"){
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    }catch(err){
      console.error("Failed to parse WebSocket message:", err.message);
    }
  })

  ws.on("close", () => {
    clients.delete(ws);
    console.log("WebSocket client disconnected. Total clients:", clients.size);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    clients.delete(ws);
  });
});
app.get("/api/health", async (req, res) => {
  try {
    const status = await authStatus();
    res.json({ backend: "ok", dryRun: DRY_RUN, calle: status });
  } catch (err) {
    res.status(500).json({ backend: "ok", dryRun: DRY_RUN, calle: null, error: err.message });
  }
});
app.post("/api/appointments", async (req, res) => {
  const { patientName, phone, service, scheduledAt } = req.body;

  if (!patientName || !phone || !service || !scheduledAt) {
    return res.status(400).json({
      error: "patientName, phone, service, and scheduledAt are required",
    });
  }

  const appointments = await loadAppointments();

  const newAppt = {
    id: `appt_${randomUUID()}`,
    patientName,
    phone,
    service,
    scheduledAt,
    status: "PENDING",
    runId: null,
    activity: [],
  };

  appointments.push(newAppt);
  await saveAppointments(appointments);

  res.status(201).json(newAppt);
});

app.get("/api/appointments", async (req, res) => {
  res.json(await loadAppointments());
});

app.post("/api/appointments/:id/confirm", async (req, res) => {
  const appointments = await loadAppointments();
  const outcome = await triggerCall(appointments, req.params.id);
  if (!outcome.ok) {
    const statusCode = outcome.code === "call_in_progress" ? 409 : 502;
    return res.status(statusCode).json({ error: outcome.error, code: outcome.code });
  }

  await saveAppointments(appointments);
  res.json(outcome.appointment);
});

app.post("/api/confirm-tomorrow", async (req, res) => {
  const triggered = await runNightlyBatch();
  res.json({ triggered });
});

app.get("/", (req, res) => {
  try{
      res.send("This is the No-Show Killer backend. Use the frontend to interact with it.");
  }catch(err){
    console.error("Error serving index.html:", err.message);
    res.status(500).send("Internal Server Error");
  }
});


const PORT = process.env.PORT || 5200;
server.listen(PORT, () => {
  console.log(`No-Show Killer backend running on http://localhost:${PORT}`);
});

// Nightly cron: fires once a day and confirms every PENDING appointment
// scheduled for tomorrow. Override timing via env vars, e.g.:
//   CRON_SCHEDULE="0 9 * * *" CRON_TIMEZONE="America/Los_Angeles" npm start
// Set CRON_ENABLED=false to turn the recurring job off entirely without
// touching code - the one-off /api/confirm-tomorrow and /confirm endpoints
// keep working either way.
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 18 * * *"; // 6pm daily
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
const CRON_ENABLED = process.env.CRON_ENABLED !== "false";

if (CRON_ENABLED) {
  cron.schedule(
    CRON_SCHEDULE,
    async () => {
      console.log(`[cron] running nightly confirmation batch at ${new Date().toISOString()}`);
      try {
        const triggered = await runNightlyBatch();
        console.log(`[cron] triggered ${triggered.length} confirmation call(s):`, triggered);
      } catch (err) {
        console.error("[cron] nightly batch failed:", err.message);
      }
    },
    { timezone: CRON_TIMEZONE }
  );
  console.log(`[cron] nightly confirmation batch scheduled: "${CRON_SCHEDULE}" (${CRON_TIMEZONE})`);
} else {
  console.log("[cron] nightly confirmation batch disabled (CRON_ENABLED=false)");
}

if (DRY_RUN) {
  console.log("[dry-run] DRY_RUN is on - no real CALL-E calls will be placed. Set DRY_RUN=false to go live.");
}
