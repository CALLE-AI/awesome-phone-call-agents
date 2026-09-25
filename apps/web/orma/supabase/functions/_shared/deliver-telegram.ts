/**
 * T3.4 Telegram receipt delivery.
 *
 * Outbound half only. Post-call summaries and pattern reports.
 * Never asks. Never chases.
 *
 * Skip path: when `telegram_receipts` is false or `telegram_chat_id` is null,
 * return `skipped` with no Telegram call and no `deliveries` row.
 * The user gets nothing. Prefer silence over an audit row for a disabled channel.
 *
 * Send path: INSERT `deliveries` with payload before the Telegram attempt.
 * Then UPDATE `sent_at` on success or `error` on failure.
 *
 * Reach PostgREST through `ORMA_API_URL`. Never use a project host.
 * Auth uses the service role key. Do not log the key.
 *
 * Consumers:
 * - T7.4 `receipt.ts` calls `deliverPostCallTelegram` after ingestion.
 * - T7.3 analysis calls `deliverPatternTelegram` for pattern prose.
 *
 * Pin with:
 * `deno test --allow-read supabase/functions/_shared/deliver-telegram.ts supabase/functions/_shared/deliver-telegram_tests.ts`
 */

export const DELIVERY_CHANNEL_TELEGRAM = "telegram" as const;
export const DELIVERY_KIND_POST_CALL = "post_call" as const;
export const DELIVERY_KIND_PATTERN = "pattern" as const;

export type DeliveryKind =
  | typeof DELIVERY_KIND_POST_CALL
  | typeof DELIVERY_KIND_PATTERN;

export type DeliveryRow = {
  id: string;
  userId: string;
  channel: typeof DELIVERY_CHANNEL_TELEGRAM;
  kind: DeliveryKind;
  callRunId: string | null;
  payload: Record<string, unknown>;
  sentAt: string | null;
  error: string | null;
};

export type ReceiptProfile = {
  id: string;
  telegramChatId: number | null;
  telegramReceipts: boolean;
};

export type DeliverTelegramDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  botToken: string;
  fetch: typeof fetch;
  /** Optional clock for tests. Defaults to `new Date().toISOString()`. */
  nowIso?: () => string;
  /** Optional id factory for tests. Defaults to `crypto.randomUUID()`. */
  newId?: () => string;
};

export type DeliverResult =
  | { status: "skipped"; reason: "receipts_disabled" | "no_chat_id" }
  | { status: "sent"; deliveryId: string; text: string }
  | { status: "failed"; deliveryId: string; error: string; text: string };

export type PostCallReceiptInput = {
  userId: string;
  callRunId: string;
  /** Exact capture texts from structured or fixture data. Never invented counts. */
  capturedTexts: string[];
  /** Exact retirement texts the caller resolved from item ids. */
  retiredTexts: string[];
  /** Exact commitment item texts the caller resolved. Named when present. */
  committedTexts?: string[];
};

export type PatternReceiptInput = {
  userId: string;
  /** Pattern report prose already validated by T7.2. */
  prose: string;
};

const CTA_MARKERS = [
  "?",
  "please",
  "reply",
  "tap ",
  "click ",
  "open the app",
  "let me know",
  "tell me",
  "do you",
  "would you",
  "can you",
  "could you",
];

/** True when the text looks like a prompt or chase rather than a receipt. */
export function containsCallToAction(text: string): boolean {
  const lower = text.toLowerCase();
  for (const marker of CTA_MARKERS) {
    if (lower.includes(marker)) return true;
  }
  return false;
}

function formatNamedList(label: string, texts: string[]): string {
  if (texts.length === 0) return `${label}: none`;
  const lines = texts.map((text) => `- ${text}`);
  return `${label}:\n${lines.join("\n")}`;
}

/**
 * Build the post-call receipt body from named capture, retirement and
 * commitment texts. Names what happened. Asks for nothing. The commitment
 * section appears only when the caller resolved at least one commitment.
 */
export function formatPostCallMessage(input: {
  capturedTexts: string[];
  retiredTexts: string[];
  committedTexts?: string[];
}): string {
  const lines = [
    "Call summary",
    formatNamedList("Captured", input.capturedTexts),
    formatNamedList("Retired", input.retiredTexts),
  ];
  const committedTexts = input.committedTexts ?? [];
  if (committedTexts.length > 0) {
    lines.push(formatNamedList("Committed", committedTexts));
  }
  return lines.join("\n");
}

/**
 * Build the pattern receipt from report prose.
 * Carries the prose as written. Adds no prompt.
 */
export function formatPatternMessage(prose: string): string {
  const trimmed = prose.trim();
  return `Pattern report\n${trimmed}`;
}

function assertNoCta(text: string): void {
  if (containsCallToAction(text)) {
    throw new Error("receipt text must not ask or chase");
  }
}

type RestProfileRow = {
  id: string;
  telegram_chat_id: number | null;
  telegram_receipts: boolean;
};

type RestDeliveryRow = {
  id: string;
  user_id: string;
  channel: string;
  kind: string;
  call_run_id: string | null;
  payload: Record<string, unknown>;
  sent_at: string | null;
  error: string | null;
};

function restHeaders(serviceRoleKey: string, prefer?: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

function apiBase(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "");
}

async function loadReceiptProfile(
  deps: DeliverTelegramDeps,
  userId: string,
): Promise<ReceiptProfile> {
  const base = apiBase(deps.apiUrl);
  const url =
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}` +
    `&select=id,telegram_chat_id,telegram_receipts`;
  if (url.includes("supabase.co")) {
    throw new Error("must not use the project host");
  }
  const response = await deps.fetch(url, {
    headers: restHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("profiles receipt read failed");
  const rows = (await response.json()) as RestProfileRow[];
  if (rows.length !== 1) throw new Error("profiles receipt read must return one row");
  const row = rows[0];
  return {
    id: row.id,
    telegramChatId: row.telegram_chat_id,
    telegramReceipts: row.telegram_receipts,
  };
}

async function insertDelivery(
  deps: DeliverTelegramDeps,
  input: {
    userId: string;
    kind: DeliveryKind;
    callRunId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<DeliveryRow> {
  const base = apiBase(deps.apiUrl);
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const body = {
    id,
    user_id: input.userId,
    channel: DELIVERY_CHANNEL_TELEGRAM,
    kind: input.kind,
    call_run_id: input.callRunId,
    payload: input.payload,
  };
  const response = await deps.fetch(`${base}/rest/v1/deliveries`, {
    method: "POST",
    headers: restHeaders(deps.serviceRoleKey, "return=representation"),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("deliveries insert failed");
  const rows = (await response.json()) as RestDeliveryRow[];
  if (rows.length !== 1) throw new Error("deliveries insert must return one row");
  return fromRestDelivery(rows[0]);
}

async function markDeliverySent(
  deps: DeliverTelegramDeps,
  deliveryId: string,
  sentAt: string,
): Promise<void> {
  const base = apiBase(deps.apiUrl);
  const response = await deps.fetch(
    `${base}/rest/v1/deliveries?id=eq.${encodeURIComponent(deliveryId)}`,
    {
      method: "PATCH",
      headers: restHeaders(deps.serviceRoleKey, "return=minimal"),
      body: JSON.stringify({ sent_at: sentAt, error: null }),
    },
  );
  if (!response.ok) throw new Error("deliveries sent_at update failed");
}

async function markDeliveryError(
  deps: DeliverTelegramDeps,
  deliveryId: string,
  error: string,
): Promise<void> {
  const base = apiBase(deps.apiUrl);
  const response = await deps.fetch(
    `${base}/rest/v1/deliveries?id=eq.${encodeURIComponent(deliveryId)}`,
    {
      method: "PATCH",
      headers: restHeaders(deps.serviceRoleKey, "return=minimal"),
      body: JSON.stringify({ error }),
    },
  );
  if (!response.ok) throw new Error("deliveries error update failed");
}

function fromRestDelivery(row: RestDeliveryRow): DeliveryRow {
  if (row.channel !== DELIVERY_CHANNEL_TELEGRAM) {
    throw new Error("deliveries row channel must be telegram");
  }
  if (
    row.kind !== DELIVERY_KIND_POST_CALL &&
    row.kind !== DELIVERY_KIND_PATTERN
  ) {
    throw new Error("deliveries row kind must be post_call or pattern");
  }
  return {
    id: row.id,
    userId: row.user_id,
    channel: DELIVERY_CHANNEL_TELEGRAM,
    kind: row.kind,
    callRunId: row.call_run_id,
    payload: row.payload,
    sentAt: row.sent_at,
    error: row.error,
  };
}

async function sendTelegramMessage(
  deps: DeliverTelegramDeps,
  chatId: number,
  text: string,
): Promise<void> {
  const response = await deps.fetch(
    `https://api.telegram.org/bot${deps.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  if (!response.ok) throw new Error("telegram sendMessage failed");
  const parsed = (await response.json()) as { ok?: boolean };
  if (parsed.ok !== true) throw new Error("telegram sendMessage failed");
}

async function deliverTelegramReceipt(args: {
  deps: DeliverTelegramDeps;
  userId: string;
  kind: DeliveryKind;
  callRunId: string | null;
  text: string;
  payload: Record<string, unknown>;
  enforceNoCta: boolean;
}): Promise<DeliverResult> {
  if (args.enforceNoCta) assertNoCta(args.text);
  const profile = await loadReceiptProfile(args.deps, args.userId);
  if (profile.id !== args.userId) {
    throw new Error("loaded profile id must match userId");
  }
  if (!profile.telegramReceipts) {
    return { status: "skipped", reason: "receipts_disabled" };
  }
  if (profile.telegramChatId === null) {
    return { status: "skipped", reason: "no_chat_id" };
  }

  const delivery = await insertDelivery(args.deps, {
    userId: args.userId,
    kind: args.kind,
    callRunId: args.callRunId,
    payload: args.payload,
  });

  try {
    await sendTelegramMessage(args.deps, profile.telegramChatId, args.text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "telegram send failed";
    try {
      await markDeliveryError(args.deps, delivery.id, message);
    } catch {
      // Row exists without error text. Still report failed to the caller.
    }
    return {
      status: "failed",
      deliveryId: delivery.id,
      error: message,
      text: args.text,
    };
  }

  // Telegram already delivered. A bookkeeping failure must not report send failure.
  const sentAt = (args.deps.nowIso ?? (() => new Date().toISOString()))();
  try {
    await markDeliverySent(args.deps, delivery.id, sentAt);
  } catch {
    // Row stays without sent_at. Caller still sees sent.
  }
  return { status: "sent", deliveryId: delivery.id, text: args.text };
}

/** Deliver a post-call receipt over Telegram. */
export async function deliverPostCallTelegram(
  input: PostCallReceiptInput,
  deps: DeliverTelegramDeps,
): Promise<DeliverResult> {
  const text = formatPostCallMessage({
    capturedTexts: input.capturedTexts,
    retiredTexts: input.retiredTexts,
    committedTexts: input.committedTexts,
  });
  return deliverTelegramReceipt({
    deps,
    userId: input.userId,
    kind: DELIVERY_KIND_POST_CALL,
    callRunId: input.callRunId,
    text,
    payload: {
      text,
      captured_texts: input.capturedTexts,
      retired_texts: input.retiredTexts,
      committed_texts: input.committedTexts ?? [],
    },
    enforceNoCta: true,
  });
}

/** Deliver a pattern report over Telegram. */
export async function deliverPatternTelegram(
  input: PatternReceiptInput,
  deps: DeliverTelegramDeps,
): Promise<DeliverResult> {
  const text = formatPatternMessage(input.prose);
  // Pattern prose is owned by T7.2. This seam does not rewrite or reject it for CTA.
  return deliverTelegramReceipt({
    deps,
    userId: input.userId,
    kind: DELIVERY_KIND_PATTERN,
    callRunId: null,
    text,
    payload: {
      text,
      prose: input.prose,
    },
    enforceNoCta: false,
  });
}

/** Extract capture texts from a CALL-E structured_result shaped object. */
export function capturedTextsFromStructured(structured: unknown): string[] {
  if (
    structured === null ||
    typeof structured !== "object" ||
    Array.isArray(structured)
  ) {
    return [];
  }
  const captured = (structured as { captured_items?: unknown }).captured_items;
  if (!Array.isArray(captured)) return [];
  const texts: string[] = [];
  for (const item of captured) {
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      texts.push((item as { text: string }).text);
    }
  }
  return texts;
}

/** Extract retirement item ids from structured_result for the caller to resolve. */
export function retiredItemIdsFromStructured(structured: unknown): string[] {
  if (
    structured === null ||
    typeof structured !== "object" ||
    Array.isArray(structured)
  ) {
    return [];
  }
  const retired = (structured as { retired_items?: unknown }).retired_items;
  if (!Array.isArray(retired)) return [];
  const ids: string[] = [];
  for (const item of retired) {
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { item_id?: unknown }).item_id === "string"
    ) {
      ids.push((item as { item_id: string }).item_id);
    }
  }
  return ids;
}
