"use server";

import { z } from "zod";
import { createApp } from "../app/app";
import { getConfig } from "../app/config";
import { buildTask } from "../core/calle";
import { frameFromNppes } from "../core/frame";
import { parseCity, parseState } from "../core/location";
import { checkCrisis, containsPhi } from "../core/safety";
import { SPECIALTY_IDS, specialtyLabel, taxonomyFor } from "../core/specialties";
import type { Candidate, SearchSpec, Watch } from "../core/types";

const MODALITY = z.enum(["in_person", "telehealth", "either"]);

const startWatchSchema = z.object({
  need: z.string().min(3, "Tell us what you need in a few words.").max(140),
  plan: z.string().min(2).max(80),
  location: z.string().min(2).max(120),
  modality: MODALITY.default("either"),
  specialty: z.enum(SPECIALTY_IDS),
  targetOpen: z.coerce.number().int().min(1).max(5).default(3),
  maxCallsPerRun: z.coerce.number().int().min(1).max(40).default(10),
});

export type StartWatchState =
  | { ok: true; watch: Watch; simulated: boolean }
  | { ok: false; error: string; reason?: "crisis" | "phi" | "validation" };

/**
 * Start a standing watch. The need statement is screened before anything
 * else happens: crisis language stops the search entirely. The location must
 * name a state, because framing candidates against the wrong region means
 * dialing the wrong region.
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

  const city = parseCity(input.location);
  const state = parseState(input.location);
  if (!city || !state) {
    return {
      ok: false,
      error: "Add a city and state to the location, for example \"Austin, TX\".",
      reason: "validation",
    };
  }

  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });

  let candidates: Candidate[];
  try {
    candidates = await frameFromNppes(
      {
        city,
        state,
        taxonomy: taxonomyFor(input.specialty),
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
    return {
      ok: false,
      error: `No ${specialtyLabel(input.specialty).toLowerCase()} listings with usable phone numbers found in ${city}, ${state}.`,
      reason: "validation",
    };
  }

  const spec: SearchSpec = {
    plan: input.plan,
    modality: input.modality,
    location: input.location,
    need: input.need,
    specialty: input.specialty,
  };

  const watch = app.startWatch({
    spec,
    candidates,
    targetOpen: input.targetOpen,
    maxCallsPerRun: input.maxCallsPerRun,
  });
  return { ok: true, watch, simulated: config.callMode !== "live" };
}

export async function stopWatch(id: string): Promise<{ ok: boolean }> {
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  return { ok: app.stopWatch(id) };
}

/** Run one dispatch for a watch and return results (used by the UI first-run and scheduler). */
export async function runWatchOnce(
  id: string,
): Promise<{ ok: boolean; error?: string; reason?: string }> {
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  try {
    const state = app.getWatchRunState(id);
    const dispatch = await app.runWatch(id, state.runCount + 1);
    return { ok: true, reason: dispatch.reason };
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
  return buildTask(candidate, spec);
}
