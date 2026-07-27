import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ProductionStore } from "./production-store.js";
import { extname, join, normalize, relative } from "node:path";

const port = Number(process.env.PORT || 3000);
const publicDir = join(process.cwd(), "public");
const dataDir = process.env.MEDROUTE_DATA_DIR || join(process.cwd(), "data");
const historyFile = join(dataDir, "medroute-history.json");
const transcriptPdfScript = join(process.cwd(), "scripts", "generate-transcript-pdf.py");
const accessToken = process.env.MEDROUTE_ACCESS_TOKEN;
const idempotentRuns = new Map();
const requestWindows = new Map();
let saveQueue = Promise.resolve();
const maxChecksPerMinute = Number(process.env.MEDROUTE_MAX_CHECKS_PER_MINUTE || 30);
const liveCooldownMs = Number(process.env.MEDROUTE_LIVE_COOLDOWN_SECONDS || 900) * 1_000;
const maxTranscriptTurns = Number(process.env.MEDROUTE_MAX_TRANSCRIPT_TURNS || 200);
const productionMode = process.env.MEDROUTE_ENV === "production";
if (productionMode && (!process.env.DATABASE_URL || !process.env.MEDROUTE_OIDC_ISSUER || !process.env.MEDROUTE_OIDC_AUDIENCE || !process.env.MEDROUTE_OIDC_JWKS_URL)) throw new Error("Production mode requires DATABASE_URL and MEDROUTE_OIDC_ISSUER, MEDROUTE_OIDC_AUDIENCE, and MEDROUTE_OIDC_JWKS_URL.");
const productionStore = productionMode ? new ProductionStore(process.env.DATABASE_URL) : null;
if (productionStore) await productionStore.init();
const oidcJwks = productionMode ? createRemoteJWKSet(new URL(process.env.MEDROUTE_OIDC_JWKS_URL)) : null;

const resultSchema = {
  type: "object",
  required: ["stock_status", "price_range", "pickup_readiness", "hours", "confidence"],
  properties: {
    stock_status: { type: "string", enum: ["in_stock", "limited", "out_of_stock", "unknown"] },
    price_range: { type: "string" },
    pickup_readiness: { type: "string", enum: ["can_hold", "cannot_hold", "unknown"] },
    hours: { type: "string" },
    substitution_available: { type: "string" },
    notes: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] }
  }
};

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  res.end(JSON.stringify(value));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", chunk => { if (!tooLarge) { body += chunk; tooLarge = body.length > 100_000; } });
    req.on("end", () => { if (tooLarge) return reject(new Error("Request body is too large.")); try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

function safeText(value, max = 120) {
  return typeof value === "string" ? value.replace(/[\r\n<>]/g, " ").trim().slice(0, max) : "";
}

function maskPhone(phone) {
  const value = safeText(phone, 24);
  return value.length > 6 ? `${value.slice(0, 4)}${"•".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}` : "Hidden";
}

function redactPhoneNumbers(value) {
  return safeText(value, 2_000).replace(/\+\d[\d -]{7,}\d/g, match => maskPhone(match.replace(/[ -]/g, "")));
}

function phoneKey(phone) { return createHmac("sha256", process.env.MEDROUTE_RECIPIENT_HASH_KEY || accessToken || "local-development-key").update(phone).digest("hex"); }

function requestFingerprint({ medicine, strength, pharmacies }) {
  return createHash("sha256").update(JSON.stringify({ medicine, strength, pharmacies: pharmacies.map(p => ({ name: p.name, phone: phoneKey(p.phone), distanceKm: p.distanceKm })) })).digest("hex");
}

function sanitizeResult(result) {
  const source = result && typeof result === "object" ? result : {};
  return {
    stock_status: ["in_stock", "limited", "out_of_stock", "unknown"].includes(source.stock_status) ? source.stock_status : "unknown",
    price_range: redactPhoneNumbers(source.price_range),
    pickup_readiness: ["can_hold", "cannot_hold", "unknown"].includes(source.pickup_readiness) ? source.pickup_readiness : "unknown",
    hours: redactPhoneNumbers(source.hours),
    substitution_available: redactPhoneNumbers(source.substitution_available),
    notes: redactPhoneNumbers(source.notes),
    confidence: ["high", "medium", "low"].includes(source.confidence) ? source.confidence : "low"
  };
}

async function authenticate(req) {
  const supplied = req.headers.authorization;
  if (productionMode) {
    if (typeof supplied !== "string" || !supplied.startsWith("Bearer ")) return null;
    try {
      const verified = await jwtVerify(supplied.slice(7), oidcJwks, { issuer: process.env.MEDROUTE_OIDC_ISSUER, audience: process.env.MEDROUTE_OIDC_AUDIENCE });
      return { subject: verified.payload.sub || "unknown" };
    } catch { return null; }
  }
  const expected = `Bearer ${accessToken || ""}`;
  return Boolean(accessToken) && typeof supplied === "string" && supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? { subject: "local-operator" } : null;
}

function withinRateLimit(req, actor) {
  const key = `${req.socket.remoteAddress || "unknown"}:${actor.subject}`;
  const now = Date.now();
  const window = requestWindows.get(key)?.filter(time => now - time < 60_000) || [];
  if (window.length >= maxChecksPerMinute) return false;
  window.push(now); requestWindows.set(key, window);
  return true;
}

function demoResult(pharmacy, medicine) {
  const seeds = ["in_stock", "limited", "out_of_stock"];
  const status = seeds[Number(pharmacy.phone.at(-1)) % seeds.length];
  return {
    pharmacy: pharmacy.name,
    phone: maskPhone(pharmacy.phone),
    distanceKm: pharmacy.distanceKm,
    result: {
      stock_status: status,
      price_range: status === "out_of_stock" ? "Not available" : "KES 850–1,150",
      pickup_readiness: status === "in_stock" ? "can_hold" : "cannot_hold",
      hours: "Open until 8:00 PM",
      substitution_available: status === "out_of_stock" ? "Ask pharmacist" : "Not needed",
      notes: `Demo response for ${medicine}. Verify with a live authorized call.`,
      confidence: "medium"
    },
    mode: "demo"
  };
}

function score(item) {
  const r = item.result || {};
  return (r.stock_status === "in_stock" ? 100 : r.stock_status === "limited" ? 55 : 0)
    + (r.pickup_readiness === "can_hold" ? 20 : 0) - Number(item.distanceKm || 0) * 2;
}

async function readHistory() {
  if (productionStore) return productionStore.readHistory();
  try { return JSON.parse(await readFile(historyFile, "utf8")); }
  catch { return []; }
}

async function saveHistory(record) {
  if (productionStore) return productionStore.saveRun(record);
  const save = async () => {
    const history = await readHistory();
    history.unshift(record);
    await mkdir(dataDir, { recursive: true });
    const temporaryFile = `${historyFile}.${process.pid}.tmp`;
    await writeFile(temporaryFile, JSON.stringify(history.slice(0, 100), null, 2), "utf8");
    await rename(temporaryFile, historyFile);
  };
  const pending = saveQueue.then(save, save);
  saveQueue = pending.catch(() => {});
  return pending;
}

function publicRecord(record) {
  const { idempotencyKey, requestFingerprint, results = [], ...rest } = record;
  return { ...rest, results: results.map(({ recipientKey, ...result }) => result) };
}

function analytics(history) {
  const medicineCounts = new Map();
  let calls = 0, inStock = 0, liveRuns = 0;
  for (const run of history) {
    medicineCounts.set(run.medicine, (medicineCounts.get(run.medicine) || 0) + 1);
    calls += run.results.length;
    inStock += run.results.filter(item => item.result?.stock_status === "in_stock").length;
    if (run.mode === "live") liveRuns += 1;
  }
  return {
    totalRuns: history.length, totalCalls: calls, liveRuns,
    inStockRate: calls ? Math.round((inStock / calls) * 100) : 0,
    topMedicines: [...medicineCounts.entries()].map(([medicine, count]) => ({ medicine, count })).sort((a, b) => b.count - a.count),
    recent: history.map(publicRecord)
  };
}

function normalizeTranscriptText(value) {
  return safeText(value, 2_000).replace(/^\s*\d+\.\s+/, "").replace(/\s+/g, " ").trim();
}

function sentenceComplete(value) {
  return /[.!?]["')\]]?\s*$/.test(value);
}

function mergeTranscriptTurns(turns) {
  return turns.reduce((merged, turn) => {
    const previous = merged.at(-1);
    if (previous && previous.speaker === turn.speaker && !sentenceComplete(previous.text)) {
      previous.text = `${previous.text} ${turn.text}`.replace(/\s+/g, " ").trim();
      return merged;
    }
    merged.push({ ...turn });
    return merged;
  }, []);
}

function cleanTranscript(call) {
  const attempts = call.recipients[0]?.attempts || [];
  const turns = attempts.flatMap(attempt => attempt.transcriptTurns || []).slice(0, maxTranscriptTurns).map(turn => ({
    speaker: ["bot", "user"].includes(turn.speaker) ? turn.speaker : "unknown",
    text: redactPhoneNumbers(normalizeTranscriptText(turn.text)),
    offsetSeconds: Number.isFinite(turn.offsetSeconds) ? turn.offsetSeconds : null
  })).filter(turn => turn.text);
  return mergeTranscriptTurns(turns);
}

function createTranscriptPdf(payload) {
  return new Promise((resolve, reject) => {
    const python = process.env.MEDROUTE_PYTHON || "python";
    const child = spawn(python, [transcriptPdfScript], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const output = [], errors = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.once("error", error => reject(new Error(`Could not create transcript PDF: ${error.message}`)));
    child.once("close", code => {
      if (code !== 0) return reject(new Error(`Could not create transcript PDF: ${Buffer.concat(errors).toString("utf8").trim() || "PDF generator failed."}`));
      const pdf = Buffer.concat(output);
      if (!pdf.length) return reject(new Error("Could not create transcript PDF: generator returned an empty file."));
      resolve(pdf);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function runLiveCall(pharmacy, medicine, strength) {
  const { CalleClient } = await import(process.env.MEDROUTE_CALLE_CLIENT_MODULE || "@call-e/calle");
  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });
  const medicineRequest = `${medicine}${strength ? `, ${strength}` : ""}`;
  const task = `You are an automated MedRoute medicine-availability representative calling ${pharmacy.name}.

CRITICAL OPENING: Your first spoken words must be exactly: "Hello, this is an AI representative from Med Route. Is this ${pharmacy.name}?" Speak the full pharmacy name exactly as written. Stop immediately after this question and wait for the response. Do not ask about medicine before the pharmacy is confirmed.

IDENTITY CHECK:
- If they clearly confirm this is ${pharmacy.name}, continue.
- If the answer is unclear, ask exactly once: "May I confirm, is this ${pharmacy.name}?" Then wait.
- If they do not confirm after that, say "Thank you. I may have reached the wrong number. Goodbye." and end the call. Do not ask any availability questions.

AFTER CONFIRMATION: Say exactly: "On behalf of our customer, we're requesting an availability check for medicine." Then ask: "Is ${medicineRequest} available today?"

QUESTION RULES:
1. Listen completely to each answer before speaking again.
2. Never ask the same question twice. If an answer is unclear, refused, or unknown, record that item as unknown and move on; do not rephrase it.
3. Extract every fact volunteered in an answer. Do not ask for a fact that the pharmacy has already supplied.
4. Only when still missing, ask each of these once and in this order: approximate price range; whether it is available for pickup today (do not ask the pharmacy to reserve or hold it); today's closing time.
5. Once those four items are answered or marked unknown, say "Thank you for your help. Goodbye." and end the call. Do not restart the conversation or repeat the medicine name.

SAFETY: Identify yourself as an automated assistant. Do not share patient information, request prescriptions, make a purchase, place an order, reserve medicine, give medical advice, or infer facts the pharmacy did not state. Return only facts stated by ${pharmacy.name}.`;
  const call = await client.calls.createAndWait({
    task,
    recipient: { phone: pharmacy.phone, locale: "en-KE", region: "KE" },
    resultSchema,
    recipientResultSchema: resultSchema,
    metadata: { workflow: "medroute-pharmacy-availability" }
  });
  const recipient = call.recipients[0];
  const result = recipient?.structuredResult ?? call.structuredResult;
  if (!result) throw new Error("CALL-E completed without a structured pharmacy result.");
  return { pharmacy: pharmacy.name, phone: maskPhone(pharmacy.phone), recipientKey: phoneKey(pharmacy.phone), distanceKm: pharmacy.distanceKm, result: sanitizeResult(result), callId: safeText(call.id, 120), summary: redactPhoneNumbers(recipient?.summary ?? call.summary ?? ""), transcript: cleanTranscript(call), mode: "live" };
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".mp4": "video/mp4", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  const actor = (req.url || "").startsWith("/api/") ? await authenticate(req) : null;
  if ((req.url || "").startsWith("/api/") && !actor) return json(res, 401, { error: "Operator authentication is required." });
  if (req.method === "GET" && req.url === "/api/history") return json(res, 200, { history: (await readHistory()).map(publicRecord) });
  if (req.method === "GET" && req.url === "/api/analytics") return json(res, 200, analytics(await readHistory()));
  const transcriptRequest = (req.url || "").split("?")[0].match(/^\/api\/transcripts\/(run_\d+)\/(\d+)\.pdf$/);
  if (req.method === "GET" && transcriptRequest) {
    try {
      const history = await readHistory();
      const record = history.find(item => item.id === transcriptRequest[1]);
      const item = record?.results?.[Number(transcriptRequest[2])];
      if (!record || !item || !Array.isArray(item.transcript) || item.transcript.length === 0) return json(res, 404, { error: "No transcript is available for this call." });
      const pdf = await createTranscriptPdf({
        runId: record.id,
        createdAt: record.createdAt,
        medicine: record.medicine,
        strength: record.strength,
        pharmacy: item.pharmacy,
        phone: maskPhone(item.phone),
        callId: item.callId,
        summary: item.summary,
        transcript: item.transcript
      });
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=medroute-call-transcript.pdf",
        "Content-Length": pdf.length,
        "Cache-Control": "private, no-store"
      });
      res.end(pdf);
    } catch (error) { json(res, 500, { error: error.message || "Could not create transcript PDF." }); }
    return;
  }
  if (req.method === "POST" && req.url === "/api/check") {
    try {
      if (!withinRateLimit(req, actor)) return json(res, 429, { error: "Too many requests. Please wait before trying again." });
      const body = await parseBody(req);
      const medicine = safeText(body.medicine);
      const strength = safeText(body.strength, 60);
      const pharmacies = Array.isArray(body.pharmacies) ? body.pharmacies.slice(0, 5) : [];
      if (!medicine || pharmacies.length === 0) return json(res, 400, { error: "Medicine and at least one pharmacy are required." });
      const clean = pharmacies.map(p => ({ name: safeText(p.name), phone: safeText(p.phone, 24), distanceKm: Number(p.distanceKm) || 0 }))
        .filter(p => p.name && /^\+254\d{9}$/.test(p.phone));
      if (!clean.length) return json(res, 400, { error: "Use authorized Kenyan pharmacy phone numbers in +254XXXXXXXXX format." });
      if (body.consentAcknowledged !== true) return json(res, 400, { error: "Confirm authorization to contact every pharmacy before running a check." });
      const liveRequested = body.confirmLive === true;
      if (liveRequested && body.liveCallAcknowledged !== true) return json(res, 400, { error: "Explicit live-call authorization is required." });
      const live = Boolean(process.env.CALLE_API_KEY && liveRequested);
      const idempotencyKey = safeText(req.headers["idempotency-key"], 120);
      if (live && !/^[A-Za-z0-9_-]{16,120}$/.test(idempotencyKey)) return json(res, 400, { error: "A stable Idempotency-Key header is required for live calls." });
      const fingerprint = requestFingerprint({ medicine, strength, pharmacies: clean });
      if (live) {
        const existing = idempotentRuns.get(idempotencyKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) return json(res, 409, { error: "This Idempotency-Key belongs to a different request." });
          return json(res, 200, publicRecord(await existing.promise));
        }
      }
      const execute = async () => {
        const calls = live
          ? await Promise.allSettled(clean.map(p => runLiveCall(p, medicine, strength)))
          : clean.map(p => ({ status: "fulfilled", value: demoResult(p, medicine) }));
        const results = calls.map((item, index) => item.status === "fulfilled" ? item.value : ({ pharmacy: clean[index].name, phone: maskPhone(clean[index].phone), recipientKey: phoneKey(clean[index].phone), distanceKm: clean[index].distanceKm, error: "Call could not be completed.", mode: "live" }))
          .sort((a, b) => score(b) - score(a));
        const record = { id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), mode: live ? "live" : "demo", medicine, strength, results, ...(live ? { idempotencyKey, requestFingerprint: fingerprint } : {}) };
        await saveHistory(record);
        if (productionStore) await productionStore.audit(actor.subject, live ? "live_check_completed" : "demo_check_completed", { runId: record.id, pharmacyCount: clean.length });
        return record;
      };
      if (!live) return json(res, 200, await execute());
      const pending = Promise.resolve().then(async () => {
        if (productionStore) {
          const reservation = await productionStore.reserveIdempotency(idempotencyKey, fingerprint);
          if (!reservation.created) {
            if (reservation.fingerprint !== fingerprint) throw Object.assign(new Error("This Idempotency-Key belongs to a different request."), { status: 409 });
            if (reservation.record) return reservation.record;
            throw Object.assign(new Error("This live request is already in progress. Retry with the same key shortly."), { status: 409 });
          }
        } else {
          const history = await readHistory();
          const previous = history.find(run => run.idempotencyKey === idempotencyKey);
          if (previous) {
            if (previous.requestFingerprint !== fingerprint) throw Object.assign(new Error("This Idempotency-Key belongs to a different request."), { status: 409 });
            return previous;
          }
        }
        const cutoff = Date.now() - liveCooldownMs;
        const recentlyCalled = productionStore ? await productionStore.recentlyCalled(clean.map(pharmacy => phoneKey(pharmacy.phone)), cutoff) : new Set((await readHistory()).filter(run => run.mode === "live" && Date.parse(run.createdAt) >= cutoff).flatMap(run => run.results || []).map(item => item.recipientKey).filter(Boolean));
        if (clean.some(pharmacy => recentlyCalled.has(phoneKey(pharmacy.phone)))) throw Object.assign(new Error("A selected pharmacy was contacted recently. Wait for the live-call cooldown before trying again."), { status: 429 });
        return execute();
      });
      idempotentRuns.set(idempotencyKey, { fingerprint, promise: pending });
      try { json(res, 200, publicRecord(await pending)); }
      catch (error) { idempotentRuns.delete(idempotencyKey); if (productionStore) await productionStore.releaseIdempotency(idempotencyKey); await productionStore?.audit(actor.subject, "live_check_failed", { status: error.status || 500 }); return json(res, error.status || 500, { error: error.message || "Unexpected server error" }); }
    } catch (error) { json(res, 500, { error: error.message || "Unexpected server error" }); }
    return;
  }
  const requested = req.url === "/" ? "index.html" : req.url.split("?")[0].replace(/^\//, "");
  const path = normalize(join(publicDir, requested));
  const relativePath = relative(publicDir, path);
  if (relativePath.startsWith("..") || normalize(relativePath) === "") return json(res, 403, { error: "Forbidden" });
  try { const content = await readFile(path); res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" }); res.end(content); }
  catch { json(res, 404, { error: "Not found" }); }
});

server.listen(port, () => console.log(`MedRoute running at http://localhost:${port}`));
