"use server";

import { z } from "zod";
import { createApp } from "../app/app";
import { getConfig } from "../app/config";
import { buildTask, type Caller } from "../core/calle";
import { frameFromNppes } from "../core/frame";
import { checkCrisis, containsPhi } from "../core/safety";
import type { Candidate, SearchSpec, Watch } from "../core/types";

const MODALITY = z.enum(["in_person", "telehealth", "either"]);

const startWatchSchema = z.object({
  need: z.string().min(3, "Tell us what you need in a few words.").max(140),
  plan: z.string().min(2).max(80),
  location: z.string().min(2).max(120),
  modality: MODALITY.default("either"),
  radiusMiles: z.coerce.number().int().min(5).max(100).default(20),
  targetOpen: z.coerce.number().int().min(1).max(5).default(3),
});

export type StartWatchState =
  | { ok: true; watch: Watch; simulated: boolean }
  | { ok: false; error: string; reason?: "crisis" | "phi" | "validation" };

/**
 * Start a standing watch. The need statement is screened before anything
 * else happens: crisis language stops the search entirely.
 */
export async function startWatch(
  _prevState: StartWatchState,
  formData: FormData,
): Promise<StartWatchState> {
  const parsed = startWatchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", reason: "validation" };
  }
  const input = parsed.data;

  const crisis = checkCrisis(input.need);
  if (crisis.isCrisis) {
    return {
      ok: false,
      error:
        "It sounds like you may be in crisis. We cannot start a search right now. Please contact a crisis line immediately — in the US, call or text 988 (Suicide & Crisis Lifeline) or dial 911.",
      reason: "crisis",
    };
  }

  if (containsPhi(input.need)) {
    return {
      ok: false,
      error:
        "Please don't share diagnosis or medication details here. We only need the type of care you're looking for, so we never handle protected health information.",
      reason: "phi",
    };
  }

  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });

  let candidates: Candidate[];
  try {
    candidates = await frameFromNppes(
      {
        city: input.location.split(",")[0]?.trim() ?? input.location,
        state: inferState(input.location),
        taxonomy: "Psychiatry",
        limit: 40,
      },
      { fetch: globalThis.fetch },
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not load provider listings.",
      reason: "validation",
    };
  }

  if (candidates.length === 0) {
    return { ok: false, error: "No providers found for that location.", reason: "validation" };
  }

  const spec: SearchSpec = {
    plan: input.plan,
    modality: input.modality,
    location: input.location,
    need: input.need,
    radiusMiles: input.radiusMiles,
  };

  const watch = app.startWatch({ spec, candidates, targetOpen: input.targetOpen });
  return { ok: true, watch, simulated: config.callMode !== "live" };
}

export async function stopWatch(id: string): Promise<{ ok: boolean }> {
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  return { ok: app.stopWatch(id) };
}

/** Run one dispatch for a watch and return results (used by the UI first-run and scheduler). */
export async function runWatchOnce(id: string): Promise<{ ok: boolean; error?: string }> {
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  try {
    const state = app.getWatchRunState(id);
    await app.runWatch(id, state.runCount + 1);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

export async function optOut(phoneE164: string): Promise<{ ok: boolean }> {
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  app.optOut(phoneE164);
  return { ok: true };
}

/** Preview the exact call task without dialing. */
export async function previewTask(candidate: Candidate, spec: SearchSpec): Promise<string> {
  const caller: Caller = { placeCall: () => Promise.reject(new Error("unused")) };
  void caller;
  return buildTask(candidate, spec);
}

/** Best-effort state inference from a location string. Not critical-path. */
function inferState(location: string): string {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^[A-Za-z]{2}$/.test(last)) return last.toUpperCase();
  if (last) {
    const full = STATES[last.toLowerCase()];
    if (full) return full;
  }
  return "PA";
}

const STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};
