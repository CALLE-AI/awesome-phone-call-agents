import { createHmac, timingSafeEqual } from "node:crypto";
import { parseRuntimeMode, type ServerEnvironment } from "../config/runtime";
import { assertStrictE164 } from "../safety/phone";
import type { SmsAdapter, SmsRequest, SmsResult } from "./contracts";
import { PreviewSmsAdapter } from "./preview-sms";

export interface TwilioSmsReceipt {
  status: "queued" | "sending" | "sent" | "delivered" | "undelivered" | "failed";
  errorCode?: string;
}

export interface TwilioSmsConfig {
  readonly accountId: string;
  readonly authToken: string;
  readonly from: string;
  readonly statusUrl: string;
  readonly recipients: readonly string[];
}

export function readTwilioSmsConfig(env: ServerEnvironment): TwilioSmsConfig {
  const accountId = env.SMS_ACCOUNT_ID?.trim() ?? "";
  const authToken = env.SMS_AUTH_TOKEN?.trim() ?? "";
  const from = env.SMS_FROM_NUMBER?.trim() ?? "";
  const statusUrl = env.SMS_STATUS_CALLBACK_URL?.trim() ?? "";
  const recipients = (env.SMS_TEST_RECIPIENTS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!/^AC[0-9a-f]{32}$/i.test(accountId) || !/^[0-9a-f]{32}$/i.test(authToken)) {
    throw new Error("Valid server-only Twilio credentials are required");
  }
  assertStrictE164(from);
  if (statusUrl) {
    const url = new URL(statusUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search
    || url.pathname !== "/api/twilio/sms/status") throw new Error("Invalid SMS callback URL");
  }
  if (!recipients.length || recipients.some((number) => !/^\+614[0-9]{8}$/.test(number))) {
    throw new Error("Explicit Australian mobile test recipients are required");
  }
  return { accountId, authToken, from, statusUrl, recipients };
}

/** Use through SmsService or the consent-checked CALL-E workflow; persist a send claim before network dispatch. */
export class TwilioSmsAdapter implements SmsAdapter {
  constructor(private readonly config: TwilioSmsConfig, private readonly fetcher: typeof fetch = fetch) {}

  /** Read an existing message only. A failed lookup must never trigger another send. */
  async readStatus(sid: string): Promise<TwilioSmsReceipt | undefined> {
    if (!/^SM[0-9a-f]{32}$/i.test(sid)) return;
    try {
      const response = await this.fetcher(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountId}/Messages/${sid}.json`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.accountId}:${this.config.authToken}`).toString("base64")}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data || data.sid !== sid || data.account_sid !== this.config.accountId
        || !["queued", "sending", "sent", "delivered", "undelivered", "failed"].includes(data.status)) return;
      return { status: data.status, errorCode: /^\d{4,6}$/.test(String(data.error_code)) ? String(data.error_code) : undefined };
    } catch { return; }
  }

  async send(request: SmsRequest): Promise<SmsResult> {
    assertStrictE164(request.destinationE164);
    if (!this.config.recipients.includes(request.destinationE164)) throw new Error("SMS recipient is not enabled for testing");
    if (!request.message.trim() || request.message.length > 480) throw new Error("Invalid SMS content");
    try {
      const response = await this.fetcher(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountId}/Messages.json`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.accountId}:${this.config.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: request.destinationE164, From: this.config.from, Body: request.message,
          ...(this.config.statusUrl ? { StatusCallback: this.config.statusUrl } : {}) }),
      });
      // A timeout or server failure can happen after acceptance. Never retry here.
      if (response.status >= 400 && response.status < 500 && response.status !== 408) return { status: "failed" };
      if (response.status !== 201) return { status: "unknown" };
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("sid" in data)
        || typeof data.sid !== "string" || !/^SM[0-9a-f]{32}$/i.test(data.sid)) return { status: "unknown" };
      // Acceptance is not delivery. Authenticated lookups or signed callbacks confirm it.
      return { status: "queued", providerMessageId: data.sid };
    } catch {
      return { status: "unknown" };
    }
  }
}

export function createSmsAdapter(env: ServerEnvironment, fetcher: typeof fetch = fetch): SmsAdapter {
  if (parseRuntimeMode(env) !== "live" || env.SMS_ENABLED !== "true") return new PreviewSmsAdapter();
  return new TwilioSmsAdapter(readTwilioSmsConfig(env), fetcher);
}

/** Form webhook signature: configured public URL plus every sorted parameter. */
export function verifyTwilioForm(rawBody: string, signature: string, config: TwilioSmsConfig): URLSearchParams {
  if (!config.statusUrl) throw new Error("Callbacks are disabled");
  const params = new URLSearchParams(rawBody);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate webhook parameters");
  const payload = config.statusUrl + keys.sort().map((key) => key + params.get(key)).join("");
  const expected = createHmac("sha1", config.authToken).update(payload).digest("base64");
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) throw new Error("Invalid webhook signature");
  if (params.get("AccountSid") !== config.accountId) throw new Error("Unexpected webhook account");
  return params;
}
