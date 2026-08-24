import "dotenv/config";
import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
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

// ---------------------------------------------------------------------------
// Auth: every route that can read patient data or trigger a call requires a
// bearer token. There is no default - refuse to boot rather than silently
// run an API that can read PII and place real phone calls with no auth.
// ---------------------------------------------------------------------------
const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) {
  console.error(
    "FATAL: API_TOKEN is not set. Refusing to start an API that can read " +
      "patient data and place real phone calls without authentication."
  );
  process.exit(1);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !safeEqual(token, API_TOKEN)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Destination allowlist: only E.164-formatted numbers that have been
// explicitly authorized can be dialed. An empty allowlist means nothing is
// authorized yet - that's a deliberate secure default, not a bug.
// ---------------------------------------------------------------------------
const E164_RE = /^\+[1-9]\d{6,14}$/;

const ALLOWED_CALL_NUMBERS = new Set(
  (process.env.ALLOWED_CALL_NUMBERS || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
);

if (ALLOWED_CALL_NUMBERS.size === 0) {
  console.warn(
    "[warn] ALLOWED_CALL_NUMBERS is not set - no destination numbers are " +
      "authorized, so creating an appointment or dispatching a call will " +
      "be rejected until it's configured."
  );
}

function isAuthorizedDestination(phone) {
  return typeof phone === "string" && E164_RE.test(phone) && ALLOWED_CALL_NUMBERS.has(phone);
}

// Mask a phone number for anything that leaves the server: API responses,
// WebSocket broadcasts, and logs. The raw number is only ever used
// internally to actually place the call.
function maskPhone(phone) {
  if (typeof phone !== "string") return phone;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.length < 6) return "•".repeat(digits.length);
  const prefixLen = digits.startsWith("+") ? 5 : 4;
  return `${digits.slice(0, prefixLen)}••••${digits.slice(-4)}`;
}

function toPublicAppointment(appt) {
  if (!appt) return appt;
  return { ...appt, phone: maskPhone(appt.phone) };
}

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

// Statuses that mean a call is actively being dispatched or is already in
// flight - re-triggering a call for an appointment in any of these states
// is refused.
const IN_FLIGHT_STATUSES = new Set(["DISPATCHING", "STARTED", "CALLING"]);

const clients = new Set();

// In-memory lock closing the gap a purely file-backed check can't: two
// requests for the same appointment landing before either has persisted
// anything. Held for the full duration of triggerCall(), not just the
// initial check, so it's the actual source of truth for "is a dispatch for
// this appointment already underway right now".
const dispatchLocks = new Set();

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
    data: toPublicAppointment(appointment),
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
  // Refuse to start a second call while one is already in flight for this
  // appointment - without this, a double-click (or the batch job racing a
  // manual confirm) would dial the patient twice. Checked *and* set
  // synchronously, before any `await`, so two near-simultaneous requests
  // can't both pass the check before either has persisted anything.
  if (dispatchLocks.has(apptId)) {
    return {
      ok: false,
      code: "call_in_progress",
      error: "A call for this appointment is already in progress",
    };
  }

  const idx = appointments.findIndex((a) => a.id === apptId);
  if (idx === -1) return { ok: false, error: "not found" };

  const appt = appointments[idx];

  if (appt.status && IN_FLIGHT_STATUSES.has(appt.status)) {
    return {
      ok: false,
      code: "call_in_progress",
      error: "A call for this appointment is already in progress",
    };
  }

  if (!isAuthorizedDestination(appt.phone)) {
    return {
      ok: false,
      code: "unauthorized_destination",
      error: "This appointment's phone number is not an authorized calling destination",
    };
  }

  dispatchLocks.add(apptId);
  try {
    // Persist an unresolved "dispatching" attempt *before* calling out, so a
    // crash or an ambiguous response from CALL-E can't leave the appointment
    // looking untouched and invite a duplicate dial on the next retry.
    appointments[idx] = { ...appt, status: "DISPATCHING" };
    await saveAppointments(appointments);
    broadcastAppointmentUpdate(appointments[idx]);

    const goal = buildGoal(appt);
    const region = regionFromPhone(appt.phone);

    let result;
    try {
      result = await startCall({ toPhone: appt.phone, goal, region });
    } catch (err) {
      appointments[idx] = { ...appointments[idx], status: "DISPATCH_FAILED", lastError: err.message };
      await saveAppointments(appointments);
      broadcastAppointmentUpdate(appointments[idx]);
      return { ok: false, error: err.message };
    }
    if (!result.ok) {
      const message = result.error?.message ?? "call start failed";
      appointments[idx] = { ...appointments[idx], status: "DISPATCH_FAILED", lastError: message };
      await saveAppointments(appointments);
      broadcastAppointmentUpdate(appointments[idx]);
      return { ok: false, error: message };
    }

    const runId = result.run_id;
    const fields = extractFields(result.status_result?.structuredContent);

    appointments[idx] = {
      ...appointments[idx],
      runId,
      ...fields,
      status: fields.status ?? "STARTED",
    };

    broadcastAppointmentUpdate(appointments[idx]);

    pollCallStatus(appt.id, runId);
    return { ok: true, appointment: appointments[idx] };
  } finally {
    dispatchLocks.delete(apptId);
  }
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

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;

const app = express();
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : {}));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const { searchParams } = new URL(req.url, "http://localhost");
  const token = searchParams.get("token");
  if (!token || !safeEqual(token, API_TOKEN)) {
    ws.close(4401, "unauthorized");
    return;
  }

  clients.add(ws);
  console.log("WebSocket client connected. Total clients:", clients.size);

  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      }
    } catch (err) {
      console.error("Failed to parse WebSocket message:", err.message);
    }
  });

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
    res.json({
      backend: "ok",
      dryRun: DRY_RUN,
      calle: { usable: status?.usable ?? false, expires_at: status?.expires_at ?? null },
    });
  } catch (err) {
    res.status(500).json({ backend: "ok", dryRun: DRY_RUN, calle: null, error: err.message });
  }
});

app.post("/api/appointments", requireAuth, async (req, res) => {
  const { patientName, phone, service, scheduledAt } = req.body;

  if (!patientName || !phone || !service || !scheduledAt) {
    return res.status(400).json({
      error: "patientName, phone, service, and scheduledAt are required",
    });
  }

  if (!E164_RE.test(phone)) {
    return res.status(400).json({ error: "phone must be in E.164 format, e.g. +12025550142" });
  }

  if (!ALLOWED_CALL_NUMBERS.has(phone)) {
    return res.status(403).json({
      error: "This phone number is not an authorized calling destination",
      code: "unauthorized_destination",
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

  res.status(201).json(toPublicAppointment(newAppt));
});

app.get("/api/appointments", requireAuth, async (req, res) => {
  const appointments = await loadAppointments();
  res.json(appointments.map(toPublicAppointment));
});

app.post("/api/appointments/:id/confirm", requireAuth, async (req, res) => {
  const appointments = await loadAppointments();
  const outcome = await triggerCall(appointments, req.params.id);
  if (!outcome.ok) {
    const statusCode =
      outcome.code === "call_in_progress" ? 409 :
      outcome.code === "unauthorized_destination" ? 403 :
      502;
    return res.status(statusCode).json({ error: outcome.error, code: outcome.code });
  }

  await saveAppointments(appointments);
  res.json(toPublicAppointment(outcome.appointment));
});

app.post("/api/confirm-tomorrow", requireAuth, async (req, res) => {
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

// Nightly cron: fires once a day. By default it only *reports* how many
// appointments would be confirmed tomorrow - it does NOT place unattended
// calls. Set LIVE_UNATTENDED_BATCH=true to let it actually dial on its own.
// An operator clicking "Run tomorrow's confirmation calls" in the dashboard
// (POST /api/confirm-tomorrow, behind requireAuth) always works regardless
// of this flag, since that's explicit human intent for that one run.
// Set CRON_ENABLED=false to turn the recurring job off entirely without
// touching code - the one-off /api/confirm-tomorrow and /confirm endpoints
// keep working either way.
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 18 * * *"; // 6pm daily
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
const CRON_ENABLED = process.env.CRON_ENABLED !== "false";
const LIVE_UNATTENDED_BATCH = process.env.LIVE_UNATTENDED_BATCH === "true";

if (CRON_ENABLED) {
  cron.schedule(
    CRON_SCHEDULE,
    async () => {
      if (!LIVE_UNATTENDED_BATCH) {
        const appointments = await loadAppointments();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const targetDate = tomorrow.toISOString().slice(0, 10);
        const pending = appointments.filter(
          (a) => a.scheduledAt.slice(0, 10) === targetDate && a.status === "PENDING"
        ).length;
        console.log(
          `[cron] LIVE_UNATTENDED_BATCH is not enabled - skipping automatic dispatch. ` +
            `${pending} appointment(s) are ready for tomorrow; an operator needs to click ` +
            `"Run tomorrow's confirmation calls" to actually place them.`
        );
        return;
      }

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
  console.log(
    `[cron] nightly confirmation batch scheduled: "${CRON_SCHEDULE}" (${CRON_TIMEZONE}), ` +
      `unattended dispatch ${LIVE_UNATTENDED_BATCH ? "ENABLED" : "disabled (report-only)"}`
  );
} else {
  console.log("[cron] nightly confirmation batch disabled (CRON_ENABLED=false)");
}

if (DRY_RUN) {
  console.log("[dry-run] DRY_RUN is on - no real CALL-E calls will be placed. Set DRY_RUN=false to go live.");
}
