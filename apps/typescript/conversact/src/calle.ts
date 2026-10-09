import type { CallPlan, CallSnapshot, JsonSchema, PurchaseIntent } from "./types.js";
import { providerIdempotencyKey } from "./safety.js";

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";
export const LOOPBACK_FAKE_API_KEY = "conversact-fake-key";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TRUSTED_HOSTS = new Set(["api.heycall-e.com"]);

export class CalleCallError extends Error {
  readonly ambiguous: boolean;
  constructor(readonly code: string, message: string, readonly status: number | null = null) {
    super(message);
    this.ambiguous = status === null || status === 408 || status === 409 || status === 429 || status >= 500;
  }
}

export interface CallePort {
  createCall(plan: CallPlan): Promise<CallSnapshot>;
  waitForResult(callId: string): Promise<CallSnapshot>;
}

export function assertTrustedBaseUrl(baseUrl: string, apiKey: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CalleCallError("unsafe_base_url", "CALLE_BASE_URL is not a URL. CALLE_API_KEY was not sent.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (LOOPBACK_HOSTS.has(host) && apiKey !== LOOPBACK_FAKE_API_KEY) {
    throw new CalleCallError("unsafe_base_url", "Loopback fake servers require the literal conversact-fake-key; real credentials were not sent.");
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(host)) {
    throw new CalleCallError("unsafe_base_url", "CALLE_API_KEY may use plain HTTP only with a loopback fake server.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CalleCallError("unsafe_base_url", "CALLE_BASE_URL must use HTTPS, or loopback HTTP for a fake server.");
  }
  if (!LOOPBACK_HOSTS.has(host) && !TRUSTED_HOSTS.has(host)) {
    throw new CalleCallError("unsafe_base_url", "CALLE_API_KEY may only be sent to api.heycall-e.com or a loopback fake server.");
  }
  return url;
}

export function buildResultSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "items", "delivery_method", "customer_confirmed"],
    properties: {
      outcome: { type: "string", enum: ["order_requested", "declined", "opted_out", "incomplete", "unknown"] },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["product_id", "quantity"],
          properties: { product_id: { type: "string" }, quantity: { type: "integer" } },
        },
      },
      delivery_method: { type: "string", enum: ["standard", "pickup", "unknown"] },
      delivery_detail: { type: "string" },
      customer_confirmed: { type: "string", enum: ["yes", "no", "unknown"] },
    },
  };
}

export function buildTask(catalog: Array<{ id: string; name: string }>): string {
  const products = catalog.map((product) => `${product.id}\nName: ${product.name}`).join("\n\n");
  return `You are handling one authorized conversational shopping call.

Your job is to help the recipient express purchase intent from the supplied catalog.

Rules:
- Introduce yourself as a calling assistant and explain this call was explicitly authorized.
- Only discuss products included in the supplied catalog.
- Never invent products.
- Never invent prices.
- Never promise stock availability.
- Never claim payment has happened or that an order is complete.
- Ask for clarification for ambiguous products and ask for quantity.
- Read the intended order back before recording confirmation.
- If the recipient declines, opts out, is uncertain, or does not clearly confirm, report that honestly.
- Do not coerce the recipient and do not give medical, legal, financial, emergency, or personal-safety advice.
- Return only the requested structured result.

AVAILABLE PRODUCTS

${products}`;
}

export function buildCallPlan(options: {
  sessionId: string;
  recipientPhone: string;
  catalog: Array<{ id: string; name: string }>;
}): CallPlan {
  return {
    task: buildTask(options.catalog),
    recipients: [{ phones: [options.recipientPhone] }],
    resultSchema: buildResultSchema(),
    metadata: { workflow: "conversact", workflow_version: "1", session_id: options.sessionId },
    idempotencyKey: providerIdempotencyKey(options.sessionId),
  };
}

/** The official SDK remains lazy so preview and fixture runs require no credentials or install. */
export async function createSdkPort(apiKey: string, baseUrl = DEFAULT_BASE_URL): Promise<CallePort> {
  assertTrustedBaseUrl(baseUrl, apiKey);
  const sdk = (await import("@call-e/calle")) as unknown as {
    CalleClient: new (options: { apiKey: string; baseUrl: string }) => {
      calls: {
        create: (input: Record<string, unknown>, options: { idempotencyKey: string }) => Promise<unknown>;
        waitForResult: (callId: string, options: { timeoutMs: number; intervalMs: number }) => Promise<unknown>;
      };
    };
  };
  const client = new sdk.CalleClient({ apiKey, baseUrl });
  const asSnapshot = (value: unknown): CallSnapshot => {
    const raw = value as Record<string, unknown>;
    return {
      id: String(raw.id),
      status: String(raw.status),
      metadata: typeof raw.metadata === "object" && raw.metadata !== null ? raw.metadata as Record<string, unknown> : undefined,
      recipientPhone: Array.isArray(raw.recipients) && raw.recipients[0] && typeof raw.recipients[0] === "object"
        ? String(((raw.recipients[0] as Record<string, unknown>).phones as unknown[] | undefined)?.[0] ?? "")
        : undefined,
      structuredResult: (raw.structuredResult ?? raw.structured_result ?? null) as Record<string, unknown> | null,
    };
  };
  return {
    async createCall(plan) {
      try {
        return asSnapshot(await client.calls.create({ task: plan.task, recipients: plan.recipients, resultSchema: plan.resultSchema, metadata: plan.metadata }, { idempotencyKey: plan.idempotencyKey }));
      } catch (error) {
        const value = error as { code?: string; message?: string; status?: number };
        throw new CalleCallError(value.code ?? "sdk_error", value.message ?? String(error), typeof value.status === "number" ? value.status : null);
      }
    },
    async waitForResult(callId) {
      try {
        return asSnapshot(await client.calls.waitForResult(callId, { timeoutMs: 300_000, intervalMs: 2_000 }));
      } catch (error) {
        const value = error as { code?: string; message?: string; status?: number };
        throw new CalleCallError(value.code ?? "sdk_error", value.message ?? String(error), typeof value.status === "number" ? value.status : null);
      }
    },
  };
}

export function callFromFixture(sessionId: string, recipientPhone: string, result: PurchaseIntent | null, status = "completed"): CallSnapshot {
  return { id: `call_fixture_${sessionId}`, status, metadata: { workflow: "conversact", workflow_version: "1", session_id: sessionId }, recipientPhone, structuredResult: result as unknown as Record<string, unknown> | null };
}
