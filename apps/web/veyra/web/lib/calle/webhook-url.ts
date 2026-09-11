import { timingSafeEqual } from "node:crypto";

import { CallConfigurationError } from "./client-error";

const MIN_WEBHOOK_TOKEN_LENGTH = 32;

export function publicCalleWebhookUrl(): string {
  const configured = process.env.APP_URL?.trim() || "http://localhost:3000";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new CallConfigurationError("APP_URL must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CallConfigurationError("APP_URL must be an absolute http(s) URL");
  }
  url.pathname = "/api/calle/webhook";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function liveCalleWebhookUrl(): string {
  const url = new URL(publicCalleWebhookUrl());
  if (url.protocol !== "https:") {
    throw new CallConfigurationError("APP_URL must use HTTPS before live calling is enabled");
  }

  const token = process.env.CALLE_WEBHOOK_TOKEN ?? "";
  if (token.length < MIN_WEBHOOK_TOKEN_LENGTH) {
    throw new CallConfigurationError(
      `CALLE_WEBHOOK_TOKEN must contain at least ${MIN_WEBHOOK_TOKEN_LENGTH} characters`,
    );
  }
  url.searchParams.set("token", token);
  return url.toString();
}

export function hasValidWebhookToken(requestUrl: string): boolean {
  const expected = process.env.CALLE_WEBHOOK_TOKEN ?? "";
  const provided = new URL(requestUrl).searchParams.get("token") ?? "";
  if (expected.length < MIN_WEBHOOK_TOKEN_LENGTH) return false;

  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}
