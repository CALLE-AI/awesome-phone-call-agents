/**
 * Replay and demo fixtures.
 *
 * A fixture bundles a CALL-E `Call` response with the clarifications that
 * produced it. The call is pushed back through `normalizeCall` — the same
 * boundary a live call crosses — so a rehearsal cannot drift away from
 * reality: there is no second render path, only a second source of the same
 * object. Carrying the clarifications alongside keeps the result cards keyed to
 * the run, and lets a rehearsal spend neither call credits nor Gemini tokens.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Call } from "@call-e/calle";
import { normalizeCall } from "./call-record";
import type { ApplicationInput, CallRecord, CallStatus, Clarification } from "./types";

const FIXTURES = path.join(process.cwd(), "fixtures");

/** Seconds of simulated call, so the status strip and pacing can be rehearsed. */
const SIMULATED_DURATION_MS = 9000;

export function isReplayMode(): boolean {
  return process.env.DEMO_MODE?.trim().toLowerCase() !== "live";
}

type Fixture = {
  note?: string;
  synthetic?: boolean;
  clarifications: Clarification[];
  call: Call;
};

export type ReplayRun = {
  record: CallRecord;
  clarifications: Clarification[];
  /** True when the fixture is hand-authored rather than a captured real call. */
  synthetic: boolean;
};

/**
 * Prefers a real captured run, falling back to the hand-authored demo — and
 * says which one it used, because a synthetic run must never be presented as a
 * real one.
 */
export async function loadReplayRun(): Promise<ReplayRun> {
  const golden = await readFixture("golden-run.json");
  if (golden) {
    return {
      record: normalizeCall(golden.call),
      clarifications: golden.clarifications,
      synthetic: golden.synthetic === true,
    };
  }
  return loadDemoRun();
}

/**
 * The hand-authored Cloud Support Engineer run, already completed. Debug mode
 * reads this explicitly rather than going through `loadReplayRun`, so what it
 * renders is the same every time regardless of which captures are on disk.
 */
export async function loadDemoRun(): Promise<ReplayRun> {
  const demo = await readFixture("demo-run.json");
  if (!demo) throw new Error("Missing fixtures/demo-run.json.");
  return {
    record: normalizeCall(demo.call),
    clarifications: demo.clarifications,
    synthetic: demo.synthetic !== false,
  };
}

/** The seeded example application, served to the compose screen and to debug. */
export async function loadDemoApplication(): Promise<ApplicationInput> {
  const raw = await fs.readFile(path.join(FIXTURES, "demo-application.json"), "utf8");
  return JSON.parse(raw) as ApplicationInput;
}

async function readFixture(name: string): Promise<Fixture | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(FIXTURES, name), "utf8")) as Fixture;
    if (!parsed?.call || !Array.isArray(parsed.clarifications)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Rewinds a finished run to its start so replay can be rehearsed at real
 * pacing: status advances over ~9s and the transcript fills in turn by turn.
 *
 * Only replay mode uses this. Debug mode deliberately does not — it goes
 * straight to the completed record, because its job is iterating on the result
 * screen, not rehearsing the call.
 */
export function progressReplay(record: CallRecord, startedAt: string): CallRecord {
  const elapsed = Date.now() - Date.parse(startedAt);
  if (elapsed >= SIMULATED_DURATION_MS) return record;

  const fraction = Math.min(1, Math.max(0, elapsed) / SIMULATED_DURATION_MS);

  // Nothing is said before the call connects, so the transcript starts filling
  // only once the attempt reaches `in_progress` — otherwise the screen shows
  // turns from a call it is still claiming to be dialing.
  const talking = Math.max(0, (fraction - CONNECTED_AT) / (1 - CONNECTED_AT));
  const turns = Math.floor(record.transcript.length * talking);

  return {
    ...record,
    status: (fraction < 0.15 ? "queued" : "in_progress") as CallStatus,
    attemptStatus: fraction < 0.15 ? "queued" : fraction < CONNECTED_AT ? "dialing" : "in_progress",
    summary: null,
    taskCompleted: null,
    completionConfidence: null,
    taskEvidence: [],
    transcript: record.transcript.slice(0, turns),
    structuredResult: null,
    completedAt: null,
  };
}

/** The point in a simulated call at which the recipient picks up. */
const CONNECTED_AT = 0.3;
