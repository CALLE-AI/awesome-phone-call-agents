// Server-only safety configuration. Live dialing stays off until every control below is present.
import { timingSafeEqual } from "node:crypto";
import { aiProvider } from "./ai";
import { accessSecretConfigured } from "./call-access";
import { isE164, maskPhone, regionFromE164 } from "./phone";
import type { AppConfig, Routing } from "./types";

export function allowedNumbers(): string[] {
  return (process.env.PHARMABRIDGE_ALLOWED_NUMBERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isE164);
}

/** Live calls need the explicit flag, a CALL-E key, an operator code, and a signing secret. */
export function liveEnabled(): boolean {
  return (
    process.env.PHARMABRIDGE_LIVE_CALLS === "true" &&
    Boolean(process.env.CALLE_API_KEY) &&
    Boolean(process.env.PHARMABRIDGE_OPERATOR_CODE?.trim()) &&
    accessSecretConfigured()
  );
}

/** Direct calls reach real listed numbers; set PHARMABRIDGE_DIRECT_CALLS=false to allow test lines only. */
export function directCallsEnabled(): boolean {
  return liveEnabled() && process.env.PHARMABRIDGE_DIRECT_CALLS !== "false";
}

export function dailyCap(): number {
  const cap = Number(process.env.PHARMABRIDGE_MAX_LIVE_CALLS_PER_DAY ?? 20);
  return Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 20;
}

const counter = globalThis as unknown as { __pharmabridgeLiveCount?: { day: string; count: number } };

function today() {
  const day = new Date().toISOString().slice(0, 10);
  if (counter.__pharmabridgeLiveCount?.day !== day) counter.__pharmabridgeLiveCount = { day, count: 0 };
  return counter.__pharmabridgeLiveCount;
}

export function liveCallsToday(): number {
  return today().count;
}

/** Reserves one live call against the daily cap. Returns false once the cap is reached. */
export function reserveLiveCall(): boolean {
  const current = today();
  if (current.count >= dailyCap()) return false;
  current.count++;
  return true;
}

export function releaseLiveCall(): void {
  const current = today();
  current.count = Math.max(0, current.count - 1);
}

export function webhookUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  return base?.startsWith("https://") ? `${base.replace(/\/$/, "")}/api/webhook` : undefined;
}

export function googlePlacesEnabled(): boolean {
  return Boolean((process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY)?.trim());
}

export function recordsEnabled(): boolean {
  return process.env.PHARMABRIDGE_RECORDS !== "off";
}

/**
 * Records can hold live transcripts, so they need the operator code in every environment; NODE_ENV
 * plays no part. Without PHARMABRIDGE_OPERATOR_CODE configured, records can't be opened at all.
 */
export function recordsAccessAllowed(operatorCode: string | null): boolean {
  return recordsEnabled() && operatorCodeValid(operatorCode);
}

export function appConfig(): AppConfig {
  return {
    liveEnabled: liveEnabled(),
    directEnabled: directCallsEnabled(),
    keyConfigured: Boolean(process.env.CALLE_API_KEY),
    operatorCodeRequired: Boolean(process.env.PHARMABRIDGE_OPERATOR_CODE?.trim()),
    testLines: allowedNumbers().map((phone, index) => ({ index, masked: maskPhone(phone), region: regionFromE164(phone) })),
    webhookConfigured: Boolean(webhookUrl()),
    googlePlaces: googlePlacesEnabled(),
    dailyCap: dailyCap(),
    liveCallsToday: liveCallsToday(),
    recordsEnabled: recordsEnabled(),
    ai: aiProvider(),
  };
}

export function operatorCodeValid(code: string | null | undefined): boolean {
  const expected = process.env.PHARMABRIDGE_OPERATOR_CODE?.trim();
  if (!expected || !code) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type DialDecision = { ok: true; phone: string; masked: string } | { ok: false; reason: string };

export interface DialRequest {
  routing: Routing;
  /** The facility's (or office's) listed number. */
  listedPhone: string | null;
  /** True when the number carries a valid discovery signature, or the operator typed it for their own prescriber. */
  listedVerified: boolean;
  /** The operator confirmed they are authorized to have an AI agent call these numbers. */
  directConsent: boolean;
  testLineIndex: number;
}

export function resolveDialTarget(request: DialRequest): DialDecision {
  const allow = allowedNumbers();
  if (request.routing === "test_line") {
    if (!allow.length) return { ok: false, reason: "No test lines configured (PHARMABRIDGE_ALLOWED_NUMBERS is empty)." };
    const phone = allow[((request.testLineIndex % allow.length) + allow.length) % allow.length];
    return { ok: true, phone, masked: maskPhone(phone) };
  }
  if (request.routing === "direct") {
    const phone = request.listedPhone;
    if (!isE164(phone)) return { ok: false, reason: "This facility has no valid E.164 number." };
    if (allow.includes(phone)) return { ok: true, phone, masked: maskPhone(phone) };
    if (!directCallsEnabled()) return { ok: false, reason: "Direct calls are disabled on this server; add the number to the allowlist or use test lines." };
    if (!request.listedVerified) return { ok: false, reason: "Refused: this number was not issued by PharmaBridge discovery." };
    if (!request.directConsent) return { ok: false, reason: "Confirm that you are authorized to have an AI agent call these numbers." };
    return { ok: true, phone, masked: maskPhone(phone) };
  }
  return { ok: false, reason: "Simulation routing never dials." };
}
