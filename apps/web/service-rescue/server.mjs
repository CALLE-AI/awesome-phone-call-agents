import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createServiceInquiry, getServiceInquiry } from "./calle-client.mjs";
import { addAudit, attachCallToWorkflow, recordCall, recentAudit, recordWebhookEvent, reserveWorkflow, updateCallStatus } from "./store.mjs";

const port = Number(process.env.PORT || 3000);
const publicDir = join(process.cwd(), "public");
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml" };
const activeRuns = new Map();
const auditFile = join(process.cwd(), "data", "audit.jsonl");
const rateLimits = new Map();

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "content-type": `${type}; charset=utf-8`, "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  });
  res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) throw new Error("Request is too large.");
  }
  return JSON.parse(body || "{}");
}

function validPhone(value) {
  // Matches the CALL-E Developer API E.164 constraint exactly.
  return /^\+[1-9]\d{6,14}$/.test(String(value || ""));
}

function validateRequest(input) {
  const fields = ["serviceType", "location", "timeWindow", "providerPhone"];
  const missing = fields.filter((field) => !String(input[field] || "").trim());
  if (missing.length) return `Missing required fields: ${missing.join(", ")}.`;
  if (!validPhone(input.providerPhone)) return "Use an E.164 provider phone number, for example +14155550123.";
  if (String(input.serviceType).length > 160 || String(input.location).length > 160 || String(input.timeWindow).length > 160) return "Please shorten each request field to 160 characters or fewer.";
  return null;
}

function clientKey(req) { return req.socket.remoteAddress || "local"; }
function allowRequest(req, limit = 12) {
  const key = clientKey(req); const now = Date.now(); const prior = rateLimits.get(key) || [];
  const recent = prior.filter((time) => now - time < 60_000);
  if (recent.length >= limit) return false;
  recent.push(now); rateLimits.set(key, recent); return true;
}
function maskedPhone(phone) { return `${phone.slice(0, 4)}••••${phone.slice(-3)}`; }
async function audit(event, details = {}) {
  addAudit(event, { callId: details.runId || null, status: details.status || null, detail: details.service || null });
  await mkdir(join(process.cwd(), "data"), { recursive: true });
  await appendFile(auditFile, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, "utf8");
}

function callGoal(input) {
  return [
    "You are calling a service provider on behalf of a customer who has asked you to check availability.",
    `Service needed: ${input.serviceType}.`,
    `Service location: ${input.location}.`,
    `Preferred time: ${input.timeWindow}.`,
    input.budget ? `Budget guidance: ${input.budget}.` : "No budget was provided.",
    "State that this is an AI-assisted availability inquiry. Ask for the earliest available appointment, estimated price or call-out fee, expected arrival window, and booking method.",
    "Do not make a binding booking, share payment details, or agree to charges. Return the information to the customer for their review."
  ].join(" ");
}

function sdkRun(payload) {
  const call = payload.call || payload;
  const activity = (payload.events || []).map((event) => ({ ts: event.created_at || event.createdAt || null, message: event.message || event.type || "CALL-E status updated." }));
  const status = String(call.status || "PREPARING").toUpperCase();
  const unresolved = status === "FAILED" ? "The call failed. The business outcome is unresolved; review the call record before deciding whether to retry." : null;
  return { runId: call.id, status, message: unresolved || call.summary || call.failureMessage || null, activity, summary: call.summary, transcript: call.recipients?.[0]?.attempts?.flatMap((a) => a.transcriptTurns || []).map((t) => `${t.speaker}: ${t.text}`).join("\n") || null, extracted: call.structuredResult || call.recipients?.[0]?.structuredResult || {} };
}

function apiError(error) {
  const code = error?.code || "internal_error";
  const messages = {
    unauthorized: "CALL-E authentication failed. Check the server-side API key.",
    forbidden: "This CALL-E project is not permitted to perform this operation.",
    rate_limit_exceeded: "CALL-E rate limit reached. Wait before retrying this same workflow.",
    insufficient_balance: "CALL-E balance is insufficient to start another call.",
    unsupported_region: "CALL-E does not support this calling region for the configured project.",
    unsupported_language: "CALL-E does not support the requested language for this call.",
    invalid_phone: "The provider phone number is not a valid E.164 number.",
    recipient_blocked: "The provider number is blocked by CALL-E policy.",
    idempotency_conflict: "This approval key belongs to a different request. Create a new plan and approval.",
    result_schema_invalid: "The server call-result schema needs correction before a call can start.",
    provider_unavailable: "CALL-E could not accept this call request. Retry only with the same approval key.",
  };
  return { code, message: messages[code] || "CALL-E could not process this request. Review the operator audit record before retrying." };
}

async function handleApi(req, res) {
  try {
    if (req.method === "POST" && req.url === "/calle/webhook") {
      const event = await readJson(req);
      const eventId = req.headers["call-e-event-id"];
      const terminalTypes = new Set(["call.completed", "call.failed", "call.result_validation_failed"]);
      if (!eventId || eventId !== event?.id || !terminalTypes.has(event?.type) || typeof event?.data?.id !== "string") return send(res, 400, { error: "Invalid CALL-E webhook event." });
      if (!recordWebhookEvent({ eventId, eventType: event.type, callId: event.data.id })) return send(res, 200, { ok: true, duplicate: true });
      const verified = await getServiceInquiry(event.data.id);
      const run = sdkRun(verified);
      if (run.runId !== event.data.id || !["COMPLETED", "FAILED", "CANCELED"].includes(run.status)) return send(res, 409, { error: "Webhook terminal snapshot could not be verified." });
      updateCallStatus(run.runId, run.status);
      await audit("webhook_terminal", { runId: run.runId, status: run.status });
      return send(res, 200, { ok: true });
    }
    if (!allowRequest(req)) return send(res, 429, { error: "Too many requests. Please wait a minute and try again." });
    if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { status: "ready", service: "Service Rescue" });
    if (req.method === "POST" && req.url === "/api/login") {
      const input = await readJson(req);
      if (input.username === "tester" && input.password === "tester123") return send(res, 200, { authenticated: true, username: "tester" });
      return send(res, 401, { error: "Invalid test username or password." });
    }
    if (req.method === "GET" && req.url === "/api/audit") {
      return send(res, 200, { events: recentAudit() });
    }
    if (req.method === "POST" && req.url === "/api/plan") {
      const input = await readJson(req);
      const error = validateRequest(input);
      if (error) return send(res, 400, { error });
      await audit("plan_prepared", { service: input.serviceType, provider: maskedPhone(input.providerPhone) });
      // A preview is local state. The production Developer API is invoked only
      // after the user types CALL and supplies the required confirmations.
      return send(res, 200, {
        ready: true,
        summary: "Review the bounded availability inquiry, then explicitly authorize this one call.",
        displayGoal: callGoal(input)
      });
    }
    if (req.method === "POST" && req.url === "/api/start") {
      const input = await readJson(req);
      const error = validateRequest(input);
      if (error) return send(res, 400, { error });
      if (input.authority !== true || input.notEmergency !== true) return send(res, 409, { error: "Confirm you are authorized to contact this provider and that this is not an emergency." });
      if (input.confirmation !== "CALL") return send(res, 409, { error: "Type CALL to explicitly authorize this outbound call." });
      const idempotencyKey = /^[a-zA-Z0-9:_-]{12,128}$/.test(input.idempotencyKey || "") ? input.idempotencyKey : crypto.randomUUID();
      const workflow = reserveWorkflow({ idempotencyKey, serviceType: input.serviceType, maskedProvider: maskedPhone(input.providerPhone) });
      if (workflow.callId) return send(res, 200, sdkRun(await getServiceInquiry(workflow.callId)));
      const resultSchema = { type: "object", required: ["availability", "estimate", "arrival_window", "booking_method", "evidence_summary"], properties: { availability: { type: "string", enum: ["available", "unavailable", "unknown"], description: "Use unknown when no reliable availability was obtained." }, estimate: { type: "string", description: "Quote, call-out fee, or unknown." }, arrival_window: { type: "string", description: "Earliest arrival window or unknown." }, booking_method: { type: "string", description: "How the customer can book, or unknown." }, evidence_summary: { type: "string", description: "Concise evidence from the call supporting this result." } }, additionalProperties: false };
      const baseUrl = process.env.AUTH_REDIRECT_BASE_URL || "";
      // CALL-E accepts HTTPS webhook endpoints only. In local development the
      // app polls its status route; deploy a public HTTPS URL to enable pushes.
      const webhookUrl = baseUrl.startsWith("https://") ? `${baseUrl.replace(/\/$/, "")}/calle/webhook` : undefined;
      const result = await createServiceInquiry({ task: callGoal(input), recipient: { phones: [input.providerPhone], region: input.region || "US", locale: "en-US" }, resultSchema, metadata: { workflow_id: idempotencyKey }, webhookUrl }, { idempotencyKey });
      const run = sdkRun(result);
      if (run.runId) activeRuns.set(run.runId, input);
      attachCallToWorkflow(idempotencyKey, run.runId);
      recordCall({ callId: run.runId, idempotencyKey, serviceType: input.serviceType, maskedProvider: maskedPhone(input.providerPhone), status: run.status });
      await audit("call_started", { runId: run.runId, service: input.serviceType, provider: maskedPhone(input.providerPhone) });
      return send(res, 200, run);
    }
    if (req.method === "GET" && req.url?.startsWith("/api/status/")) {
      const runId = decodeURIComponent(req.url.slice("/api/status/".length));
      const run = sdkRun(await getServiceInquiry(runId));
      if (["COMPLETED", "FAILED", "NO_ANSWER", "DECLINED", "CANCELED", "CANCELLED", "VOICEMAIL", "BUSY", "EXPIRED"].includes(run.status)) await audit("call_finished", { runId, status: run.status });
      updateCallStatus(runId, run.status);
      return send(res, 200, run);
    }
    return send(res, 404, { error: "Not found." });
  } catch (error) {
    const clean = (value) => {
      let text = String(value ?? "");
      for (const [name, secret] of Object.entries(process.env)) {
        if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && secret?.length >= 6) {
          text = text.split(secret).join("[REDACTED]");
        }
      }
      return text
        .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]")
        .replace(/\+[1-9]\d{6,14}/g, "[PHONE]")
        .slice(0, 2000);
    };
    console.error("CALL-E request failed:", {
      name: clean(error?.name),
      code: clean(error?.code),
      status: clean(error?.status ?? error?.statusCode),
      message: clean(error?.message),
      cause: clean(error?.cause?.message)
    });
    const mapped = apiError(error);
    return send(res, mapped.code === "rate_limit_exceeded" ? 429 : 502, { error: mapped.message, code: mapped.code });
  }
}

createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) return handleApi(req, res);
  const requested = req.url === "/" ? "index.html" : req.url?.slice(1);
  const safePath = normalize(join(publicDir, requested || "index.html"));
  if (!safePath.startsWith(publicDir)) return send(res, 403, "Forbidden", "text/plain");
  try {
    const file = await readFile(safePath);
    return send(res, 200, file, contentTypes[extname(safePath)] || "application/octet-stream");
  } catch {
    return send(res, 404, "Not found", "text/plain");
  }
}).listen(port, () => console.log(`Service Rescue is running at http://localhost:${port}`));
