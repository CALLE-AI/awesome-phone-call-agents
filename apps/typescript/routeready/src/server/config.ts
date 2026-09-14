import { calleClientOptions } from "../calle/endpoint.js";
import { isE164 } from "../core/phone.js";
import type { DayFixture } from "../core/types.js";
import type { CallTarget } from "../engine/engine.js";
import type { LiveConfig } from "./run.js";

/**
 * Live calls need all of ROUTEREADY_LIVE=1, CALLE_API_KEY, and LIVE_TARGETS
 * mapping stops to numbers you are authorised to call, for example
 * "s2=+1XXXXXXXXXX@US,s3=+65XXXXXXXX@SG@en-SG". Stops without a target keep
 * scripted customers, so a demo can mix a few real calls into a simulated day.
 *
 * The shared day's transcripts and controls have no login, so live calls are
 * only allowed while the server listens on a loopback address.
 */
export function loadLiveConfig(env: NodeJS.ProcessEnv, day: DayFixture, host: string): { config: LiveConfig | null; problem: string | null } {
  if (env.ROUTEREADY_LIVE !== "1") return { config: null, problem: "ROUTEREADY_LIVE is not set to 1" };
  if (!isLoopbackHost(host)) {
    return { config: null, problem: `the shared demo day places live calls only on a loopback HOST such as 127.0.0.1, not ${host}` };
  }
  const apiKey = env.CALLE_API_KEY?.trim();
  if (!apiKey) return { config: null, problem: "CALLE_API_KEY is not set" };
  const baseUrl = env.CALLE_BASE_URL?.trim() || undefined;
  try {
    calleClientOptions(apiKey, baseUrl);
  } catch (error) {
    return { config: null, problem: (error as Error).message };
  }

  const targets = new Map<string, CallTarget>();
  const entries = (env.LIVE_TARGETS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [stopId = "", destination = ""] = entry.split("=");
    const [phone = "", region = "", locale] = destination.split("@");
    if (!day.stops.some((stop) => stop.id === stopId)) {
      return { config: null, problem: `LIVE_TARGETS names an unknown stop "${stopId}"` };
    }
    if (!isE164(phone) || !/^[A-Za-z]{2}$/.test(region)) {
      return { config: null, problem: `LIVE_TARGETS entry for ${stopId} must look like ${stopId}=+E164@REGION` };
    }
    if ([...targets.values()].some((target) => target.phone === phone)) {
      return { config: null, problem: `LIVE_TARGETS gives ${stopId} a number another stop already has; each customer is called at most once a day` };
    }
    targets.set(stopId, { phone, region: region.toUpperCase(), ...(locale ? { locale } : {}) });
  }
  if (targets.size === 0) return { config: null, problem: "LIVE_TARGETS is empty" };
  return { config: { apiKey, baseUrl, language: env.LIVE_LANGUAGE?.trim() || "English", targets }, problem: null };
}

/** True for addresses only this computer can reach: localhost, 127.x.x.x and ::1. */
export function isLoopbackHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "::1" || /^127(\.\d{1,3}){3}$/.test(name);
}
