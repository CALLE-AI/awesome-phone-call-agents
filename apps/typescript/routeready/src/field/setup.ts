import { isE164 } from "../core/phone.js";
import type { FieldSetup, FieldStop } from "./session.js";

export const MAX_FIELD_STOPS = 5;
export const FIELD_CONSENT = "Every number on this route belongs to me or to someone who agreed to take this call.";

export type ParsedStart = { ok: true; apiKey: string; setup: FieldSetup } | { ok: false; error: string };

/** Validates the route a visitor entered. Every text that reaches a call task is trimmed to one short line. */
export function parseFieldStart(body: Record<string, unknown>): ParsedStart {
  const fail = (error: string): ParsedStart => ({ ok: false, error });

  if (body.consent !== FIELD_CONSENT) return fail("Confirm that everyone on the route agreed to take a call.");
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 400 || /\s/.test(apiKey)) return fail("Paste your CALL-E API key.");

  const rider = point(body.rider);
  if (!rider) return fail("Place the rider on the map or share your location.");

  const rawStops = Array.isArray(body.stops) ? body.stops : [];
  if (rawStops.length === 0) return fail("Add at least one stop.");
  if (rawStops.length > MAX_FIELD_STOPS) return fail(`Add at most ${MAX_FIELD_STOPS} stops.`);

  const stops: FieldStop[] = [];
  for (const [index, raw] of rawStops.entries()) {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const number = index + 1;
    const customer = line(entry.customer, 40);
    if (!customer) return fail(`Stop ${number}: enter the customer's name.`);
    const phone = typeof entry.phone === "string" ? entry.phone.replace(/[\s()-]/g, "") : "";
    if (!isE164(phone)) return fail(`Stop ${number}: enter the phone number with its country code, for example +14155550123.`);
    const same = stops.find((earlier) => earlier.phone === phone);
    if (same) return fail(`Stop ${number} has the same number as stop ${same.id.slice(1)}. Each customer is called at most once a day.`);
    const region = typeof entry.region === "string" ? entry.region.trim().toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(region)) return fail(`Stop ${number}: choose the phone number's country.`);
    const location = point(entry);
    if (!location) return fail(`Stop ${number}: place it on the map.`);
    stops.push({
      id: `s${number}`,
      order: `#RR${5100 + number}`,
      customer,
      label: line(entry.label, 80) || "Pinned on the map",
      phone,
      region,
      cash: line(entry.cash, 24),
      lat: location.lat,
      lng: location.lng,
      codAmount: null,
      serviceMinutes: 3,
      windowEnd: null,
      firstTime: false,
      gated: false,
    });
  }

  return {
    ok: true,
    apiKey,
    setup: {
      merchant: line(body.merchant, 40) || "RouteReady Demo Shop",
      language: line(body.language, 24) || "English",
      callAheadMinutes: bounded(body.callAheadMinutes, 1, 30, 10),
      speedKmh: bounded(body.speedKmh, 5, 80, 20),
      testCall: body.testCall !== false,
      utcOffsetMinutes: bounded(body.utcOffsetMinutes, -720, 840, 0),
      stops,
      rider,
      locationSource: body.locationSource === "gps" ? "gps" : "drag",
    },
  };
}

/** A latitude and longitude from untrusted input, or null. */
export function point(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object") return null;
  const { lat, lng } = value as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function line(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
