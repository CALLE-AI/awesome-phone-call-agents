/**
 * T7.3 email receipt delivery through Resend over HTTP.
 *
 * Outbound half only. Pattern reports. Never asks. Never chases.
 *
 * Skip path: when `email_receipts` is false, return `skipped` before any
 * auth read. When the toggle is on, the account email is read from Supabase
 * Auth through the admin API with the service role key. A missing or blank
 * auth email returns `skipped` with no Resend call and no `deliveries` row.
 * The user gets nothing. Prefer silence over an audit row for a disabled
 * channel.
 *
 * Send path: INSERT `deliveries` with the payload before the Resend attempt.
 * Then UPDATE `sent_at` on success or `error` on failure. The Resend response
 * id joins the payload when the send produced one.
 *
 * Reach PostgREST and the Auth admin API through `ORMA_API_URL`. Never use
 * a project host. Auth uses the service role key. Never log or store a key.
 *
 * Consumer: T7.3 analysis calls `deliverPatternEmail` for pattern prose.
 *
 * Pin with:
 * `deno test --allow-read supabase/functions/_shared/deliver-email.ts supabase/functions/_shared/deliver-email_tests.ts`
 */

import { DELIVERY_KIND_PATTERN, type DeliveryKind } from "./deliver-telegram.ts";

export const DELIVERY_CHANNEL_EMAIL = "email" as const;
export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const PATTERN_EMAIL_SUBJECT = "Your weekly pattern report";

export type EmailDeliveryRow = {
  id: string;
  userId: string;
  channel: typeof DELIVERY_CHANNEL_EMAIL;
  kind: DeliveryKind;
  callRunId: string | null;
  payload: Record<string, unknown>;
  sentAt: string | null;
  error: string | null;
};

export type EmailReceiptProfile = {
  id: string;
  emailReceipts: boolean;
};

export type DeliverEmailDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  resendApiKey: string;
  resendFrom: string;
  fetch: typeof fetch;
  /** Optional clock for tests. Defaults to `new Date().toISOString()`. */
  nowIso?: () => string;
  /** Optional id factory for tests. Defaults to `crypto.randomUUID()`. */
  newId?: () => string;
};

export type DeliverEmailResult =
  | { status: "skipped"; reason: "receipts_disabled" | "no_email" }
  | { status: "sent"; deliveryId: string; text: string }
  | { status: "failed"; deliveryId: string; error: string; text: string };

export type PatternEmailInput = {
  userId: string;
  /** Pattern report prose already validated by T7.2. */
  prose: string;
};

type RestProfileRow = {
  id: string;
  email_receipts: boolean;
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

async function loadEmailProfile(
  deps: DeliverEmailDeps,
  userId: string,
): Promise<EmailReceiptProfile> {
  const base = apiBase(deps.apiUrl);
  const url =
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}` +
    `&select=id,email_receipts`;
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
    emailReceipts: row.email_receipts,
  };
}

/**
 * Reads the account email through the Auth admin API. A failed read throws.
 * A missing address comes back as null so the caller can skip.
 */
async function loadAuthEmail(
  deps: DeliverEmailDeps,
  userId: string,
): Promise<string | null> {
  const base = apiBase(deps.apiUrl);
  const url = `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  if (url.includes("supabase.co")) {
    throw new Error("must not use the project host");
  }
  const response = await deps.fetch(url, {
    headers: restHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("auth admin user read failed");
  const user = (await response.json()) as { email?: unknown };
  return typeof user.email === "string" ? user.email : null;
}

async function insertDelivery(
  deps: DeliverEmailDeps,
  input: { userId: string; payload: Record<string, unknown> },
): Promise<EmailDeliveryRow> {
  const base = apiBase(deps.apiUrl);
  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const body = {
    id,
    user_id: input.userId,
    channel: DELIVERY_CHANNEL_EMAIL,
    kind: DELIVERY_KIND_PATTERN,
    call_run_id: null,
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
  deps: DeliverEmailDeps,
  deliveryId: string,
  sentAt: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const base = apiBase(deps.apiUrl);
  const response = await deps.fetch(
    `${base}/rest/v1/deliveries?id=eq.${encodeURIComponent(deliveryId)}`,
    {
      method: "PATCH",
      headers: restHeaders(deps.serviceRoleKey, "return=minimal"),
      body: JSON.stringify({ sent_at: sentAt, error: null, payload }),
    },
  );
  if (!response.ok) throw new Error("deliveries sent_at update failed");
}

async function markDeliveryError(
  deps: DeliverEmailDeps,
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

function fromRestDelivery(row: RestDeliveryRow): EmailDeliveryRow {
  if (row.channel !== DELIVERY_CHANNEL_EMAIL) {
    throw new Error("deliveries insert must return the email channel");
  }
  return {
    id: row.id,
    userId: row.user_id,
    channel: DELIVERY_CHANNEL_EMAIL,
    kind: row.kind as DeliveryKind,
    callRunId: row.call_run_id,
    payload: row.payload,
    sentAt: row.sent_at,
    error: row.error,
  };
}

/** Sends the prose as plain text and returns the Resend id, empty when absent. */
async function sendResendEmail(
  deps: DeliverEmailDeps,
  to: string,
  text: string,
): Promise<string> {
  if (deps.resendApiKey === "") throw new Error("resend send failed");
  const response = await deps.fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deps.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: deps.resendFrom,
      to: [to],
      subject: PATTERN_EMAIL_SUBJECT,
      text,
    }),
  });
  if (!response.ok) throw new Error("resend send failed");
  const parsed = (await response.json()) as { id?: unknown };
  return typeof parsed.id === "string" ? parsed.id : "";
}

/** Deliver a pattern report over email through Resend. */
export async function deliverPatternEmail(
  input: PatternEmailInput,
  deps: DeliverEmailDeps,
): Promise<DeliverEmailResult> {
  const prose = input.prose;
  const profile = await loadEmailProfile(deps, input.userId);
  if (profile.id !== input.userId) {
    throw new Error("loaded profile id must match userId");
  }
  if (!profile.emailReceipts) {
    return { status: "skipped", reason: "receipts_disabled" };
  }
  const email = await loadAuthEmail(deps, input.userId);
  if (email === null || email.trim() === "") {
    return { status: "skipped", reason: "no_email" };
  }

  // The prose is carried as written. This seam does not rewrite or reject it.
  // The recipient is pinned to the Resend request only, never the row.
  const payload = {
    text: prose,
    prose,
    subject: PATTERN_EMAIL_SUBJECT,
  };
  const delivery = await insertDelivery(deps, { userId: input.userId, payload });

  let resendId = "";
  try {
    resendId = await sendResendEmail(deps, email, prose);
  } catch (err) {
    const message = err instanceof Error ? err.message : "resend send failed";
    try {
      await markDeliveryError(deps, delivery.id, message);
    } catch {
      // Row exists without error text. Still report failed to the caller.
    }
    return {
      status: "failed",
      deliveryId: delivery.id,
      error: message,
      text: prose,
    };
  }

  // Resend already accepted the mail. A bookkeeping failure must not report
  // the send as a failure. The response id joins the payload when present.
  const sentAt = (deps.nowIso ?? (() => new Date().toISOString()))();
  const sentPayload = resendId === "" ? payload : { ...payload, resend_id: resendId };
  try {
    await markDeliverySent(deps, delivery.id, sentAt, sentPayload);
  } catch {
    // Row stays without sent_at. Caller still sees sent.
  }
  return { status: "sent", deliveryId: delivery.id, text: prose };
}
