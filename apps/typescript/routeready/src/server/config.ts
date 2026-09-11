import { isE164 } from "../core/phone.js";
import type { DayFixture } from "../core/types.js";
import type { CallTarget } from "../engine/engine.js";
import type { LiveConfig } from "./run.js";

/**
 * Live calls need all of ROUTEREADY_LIVE=1, CALLE_API_KEY, and LIVE_TARGETS
 * mapping stops to numbers you are authorised to call, for example
 * "s2=+12763229632@US,s3=+6591234567@SG@en-SG". Stops without a target keep
 * scripted customers, so a demo can mix a few real calls into a simulated day.
 */
export function loadLiveConfig(env: NodeJS.ProcessEnv, day: DayFixture): { config: LiveConfig | null; problem: string | null } {
  if (env.ROUTEREADY_LIVE !== "1") return { config: null, problem: "ROUTEREADY_LIVE is not set to 1" };
  const apiKey = env.CALLE_API_KEY?.trim();
  if (!apiKey) return { config: null, problem: "CALLE_API_KEY is not set" };

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
    targets.set(stopId, { phone, region: region.toUpperCase(), ...(locale ? { locale } : {}) });
  }
  if (targets.size === 0) return { config: null, problem: "LIVE_TARGETS is empty" };
  return { config: { apiKey, language: env.LIVE_LANGUAGE?.trim() || "English", targets }, problem: null };
}
