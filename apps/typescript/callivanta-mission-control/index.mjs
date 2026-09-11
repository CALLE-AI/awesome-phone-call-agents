import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://api.heycall-e.com";
const LIVE_CONFIRMATION = "YES_I_APPROVE_ONE_TEST_CALL_TO_APPROVED_PHONE";
const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled"]);
const RESERVED_SAMPLE_PHONE = "+12025550100";
const DEFAULT_ITEM = "oxtail";
const SENSITIVE_KEY = /(phone|email|transcript|recording|audio|token|secret|authorization|api.?key)/i;

export const resultSchema = {
  type: "object",
  required: ["availability", "quantity", "ready_time"],
  properties: {
    availability: {
      type: "string",
      enum: ["confirmed", "unavailable", "unknown"],
    },
    quantity: { type: "string" },
    ready_time: { type: "string" },
  },
};

export function maskPhone(phone = "") {
  if (!phone.startsWith("+") || phone.length < 7) return "[invalid]";
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
}

export function validateE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

export function validateItem(item) {
  return typeof item === "string" && /^[A-Za-z0-9 .'-]{1,80}$/.test(item.trim());
}

export function sanitizeString(value) {
  return String(value)
    .replace(/iams_live_[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\+[1-9]\d{6,14}/g, "[REDACTED_PHONE]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 500);
}

export function sanitizeForOutput(value, depth = 0) {
  if (depth > 8) return "[REDACTED_DEPTH]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeForOutput(entry, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value).slice(0, 100)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeForOutput(nested, depth + 1);
    }
    return output;
  }
  return sanitizeString(value);
}

export function buildTask(item = DEFAULT_ITEM) {
  if (!validateItem(item)) throw new Error("Item must be a short plain-text product name.");
  const normalized = item.trim();
  return [
    `Call the restaurant supplier for a bounded information-only mission about ${normalized}.`,
    "Ask only these questions:",
    `1. Is ${normalized} currently available?`,
    `2. What quantity of ${normalized} is available?`,
    `3. What is the earliest pickup or delivery time for the available ${normalized}?`,
    "Do not place an order, authorize payment, accept or negotiate contract terms, commit to pickup or delivery, or make health/allergy/legal/insurance/account-access decisions.",
    "If a commitment is requested, say an authorized owner must decide separately and capture the request only as information.",
  ].join("\n");
}

export function idempotencyKey(phone, item = DEFAULT_ITEM) {
  const digest = createHash("sha256")
    .update(`callivanta-mission-control|supplier-demo|${item.trim().toLowerCase()}|${phone}`)
    .digest("hex")
    .slice(0, 20);
  return `callivanta_supplier_${digest}`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function requestJson(fetchImpl, url, options, label) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    // Intentionally do not echo provider bodies to terminal output. They may contain
    // phone numbers, transcripts, provider diagnostics, or other sensitive payloads.
    throw new Error(`CALL-E ${label} failed (${response.status}). Provider error body withheld.`);
  }
  return response.json();
}

export async function runLive({
  phone,
  approvedPhone,
  item = DEFAULT_ITEM,
  apiKey,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = 5000,
  maxPolls = 36,
}) {
  if (!validateE164(phone)) throw new Error("Live mode requires a valid E.164 phone number.");
  if (!validateE164(approvedPhone)) throw new Error("CALLIVANTA_APPROVED_PHONE must be a valid E.164 phone number.");
  if (phone !== approvedPhone) throw new Error("Runtime destination does not match the exact approved phone number.");
  if (!validateItem(item)) throw new Error("Item must be a short plain-text product name.");
  if (!apiKey) throw new Error("CALLE_API_KEY is required for live mode.");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable.");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const created = await requestJson(
    fetchImpl,
    `${BASE_URL}/v1/calls`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Idempotency-Key": idempotencyKey(phone, item),
      },
      body: JSON.stringify({
        task: buildTask(item),
        recipients: [
          {
            phones: [phone],
            region: "US",
            locale: "en-US",
          },
        ],
        result_schema: resultSchema,
        recipient_result_schema: resultSchema,
        metadata: {
          demo: "callivanta-mission-control",
          purpose: "supplier_availability_confirmation",
          item: item.trim().toLowerCase(),
        },
      }),
    },
    "create",
  );

  const callId = created.id ?? created.call_id;
  if (!callId) throw new Error("CALL-E create response did not contain a call id.");
  if (TERMINAL.has(created.status)) return created;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    if (pollIntervalMs > 0) await sleep(pollIntervalMs);
    const current = await requestJson(
      fetchImpl,
      `${BASE_URL}/v1/calls/${encodeURIComponent(callId)}`,
      {
        method: "GET",
        headers: { Authorization: headers.Authorization },
      },
      "status",
    );
    if (TERMINAL.has(current.status)) return current;
  }

  throw new Error(
    `CALL-E call ${sanitizeString(callId)} is still non-terminal. Resume status polling for this call id; do not create another call.`,
  );
}

export function dryRunPreview(phone = RESERVED_SAMPLE_PHONE, item = DEFAULT_ITEM) {
  return {
    mode: "dry-run-no-call",
    recipient: maskPhone(phone),
    item,
    sideEffect: "none",
    task: buildTask(item),
    resultSchema,
    note: "No credential is read and no network request is made in dry-run mode.",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const live = args[0] === "--live";

  if (!live) {
    console.log(JSON.stringify(sanitizeForOutput(dryRunPreview()), null, 2));
    return;
  }

  const phone = args[1];
  const item = args[2] || DEFAULT_ITEM;
  if (process.env.CALLIVANTA_LIVE !== LIVE_CONFIRMATION) {
    throw new Error(
      `Live mode is locked. Set CALLIVANTA_LIVE=${LIVE_CONFIRMATION} only after explicit approval for one exact destination.`,
    );
  }

  const approvedPhone = process.env.CALLIVANTA_APPROVED_PHONE;
  if (phone !== approvedPhone) {
    throw new Error("Runtime destination does not match CALLIVANTA_APPROVED_PHONE; no call was created.");
  }

  console.log(`LIVE SIDE EFFECT: placing one CALL-E call to ${maskPhone(phone)} about ${sanitizeString(item)}`);
  const result = await runLive({
    phone,
    approvedPhone,
    item,
    apiKey: process.env.CALLE_API_KEY,
  });

  const safeOutput = sanitizeForOutput({
    status: result.status ?? "unknown",
    taskCompleted: result.task_completed ?? false,
    completionConfidence: result.completion_confidence ?? null,
    structuredResult: result.structured_result ?? null,
    evidence: result.evidence ?? [],
  });
  console.log(JSON.stringify(safeOutput, null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(sanitizeString(error.message));
    process.exitCode = 1;
  });
}
