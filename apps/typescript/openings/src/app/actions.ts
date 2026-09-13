"use server";

import { z } from "zod";
import { createApp } from "../app/app";
import { requireAuth } from "./auth";
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
  authorizeRecipients: z.string().optional(),
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
  await requireAuth();
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

  // Explicit recipient authorization is required for every watch. A public
  // directory listing alone is not consent to dial. The user must check the
  // authorization box, which is an affirmative statement for this exact search
  // and its framed recipients. This is enforced even in dry-run so the
  // authorization habit is not bypassed, and it is mandatory for live calls.
  if (input.authorizeRecipients !== "on") {
    return {
      ok: false,
      error:
        "You must authorize the recipients for this search. Check the authorization box to confirm these are numbers you are authorized to have Openings call on your behalf.",
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
  await requireAuth();
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  return { ok: app.stopWatch(id) };
}

/**
 * Watches with an in-flight dispatch run. Server actions run in the long-lived
 * server process (not serverless), so this set is shared across requests on the
 * same machine and prevents double-dispatch on a double click.
 */
const runningWatches = new Set<string>();

/**
 * Kick off one dispatch run for a watch. Live calls spend minutes in IVR/hold,
 * so this returns immediately and runs the dispatch in the background; the UI
 * polls {@link watchState} and reloads when the run has recorded results.
 */
export async function runWatchOnce(
  id: string,
): Promise<{ ok: boolean; error?: string; reason?: string }> {
  await requireAuth();
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });

  if (runningWatches.has(id)) {
    return { ok: true, reason: "already_running" };
  }
  const watch = app.getWatch(id);
  if (!watch) return { ok: false, error: "watch_not_found" };

  const state = app.getWatchRunState(id);
  const runNumber = state.runCount + 1;

  runningWatches.add(id);
  void app
    .runWatch(id, runNumber)
    .catch((err) => {
      console.error(`[runWatch] background run failed for ${id}:`, err);
    })
    .finally(() => runningWatches.delete(id));

  return { ok: true, reason: "started" };
}

/**
 * Lightweight state for the run-in-progress poll. Never places a call.
 */
export async function watchState(
  id: string,
): Promise<{ ok: boolean; runCount: number; status: string; running: boolean; error?: string }> {
  await requireAuth();
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  const watch = app.getWatch(id);
  if (!watch) return { ok: false, runCount: 0, status: "missing", running: false, error: "watch_not_found" };
  const { runCount } = app.getWatchRunState(id);
  return { ok: true, runCount, status: watch.status, running: runningWatches.has(id) };
}

export async function optOut(phoneE164: string): Promise<{ ok: boolean }> {
  await requireAuth();
  const config = getConfig();
  const app = createApp({ store: config.store, caller: config.caller });
  app.optOut(phoneE164);
  return { ok: true };
}

/** Preview the exact call task without dialing. */
export async function previewTask(candidate: Candidate, spec: SearchSpec): Promise<string> {
  await requireAuth();
  return buildTask(candidate, spec);
}
