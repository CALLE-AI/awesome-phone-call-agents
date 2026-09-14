import { eq } from "drizzle-orm";
import {
  DEFAULT_PROJECT_CAP,
  isReached,
  remainingCalls,
  resolveCalleMode,
  type Disposition,
} from "@caller-ai/core";
import { db, schema } from "@/db";
import { parseJson } from "./utils";
import { countAttempts, getKilled, phaseForAttempt, type LivePhase } from "./wave-runner";

export const SEED_EVENT_ID = "evt_bennett_valley";

export async function listEvents() {
  return db.select().from(schema.events).all();
}

export async function getEvent(id: string) {
  return db.select().from(schema.events).where(eq(schema.events.id, id)).get();
}

export async function getInstrument(id: string) {
  return db.select().from(schema.instruments).where(eq(schema.instruments.id, id)).get();
}

export async function listInstruments(eventId: string) {
  return db.select().from(schema.instruments).where(eq(schema.instruments.eventId, eventId)).all();
}

export async function listRoster(eventId: string) {
  return db.select().from(schema.roster).where(eq(schema.roster.eventId, eventId)).all();
}

export async function listWaves(eventId: string) {
  return db.select().from(schema.waves).where(eq(schema.waves.eventId, eventId)).all();
}

export async function getAttempt(id: string) {
  return db.select().from(schema.attempts).where(eq(schema.attempts.id, id)).get();
}

export async function getWave(id: string) {
  return db.select().from(schema.waves).where(eq(schema.waves.id, id)).get();
}

export async function getConsoleState() {
  const used = countAttempts();
  const killed = getKilled();
  const cap = DEFAULT_PROJECT_CAP;
  const remaining = remainingCalls({ projectCap: cap, used, killed, blocklist: [] });
  return {
    used,
    cap,
    remaining,
    killed,
    mode: resolveCalleMode(),
  };
}

export async function getRosterEntry(id: string) {
  return db.select().from(schema.roster).where(eq(schema.roster.id, id)).get();
}

export type LiveCall = {
  attemptId: string;
  displayName: string;
  phoneMasked: string;
  phase: LivePhase;
  startedAt: number | null;
};

export type CoverageCard = {
  id: string;
  attemptId: string;
  rosterEntryId: string;
  severity: string;
  needs: string[];
  household: { displayName: string; phoneMasked: string } | null;
};

export type CoverageSnapshot = {
  coverage: {
    dialed: number;
    reached: number;
    unreached: number;
    inFlight: number;
    queued: number;
    planned: number;
  };
  live: LiveCall[];
  cards: CoverageCard[];
  waveStatus: "idle" | "running" | "complete" | "killed";
};

export async function coverageForEvent(eventId: string) {
  const snapshot = await getCoverageSnapshot(eventId);
  return snapshot.coverage;
}

export async function getCoverageSnapshot(eventId: string): Promise<CoverageSnapshot> {
  const eventWaves = await listWaves(eventId);
  const waveIds = new Set(eventWaves.map((wave) => wave.id));
  const people = await listRoster(eventId);
  const byId = new Map(people.map((row) => [row.id, row]));
  const now = Date.now();
  const allAttempts = db.select().from(schema.attempts).all().filter((row) => waveIds.has(row.waveId));
  const terminal = allAttempts.filter((row) => row.status === "terminal");
  const pending = allAttempts.filter((row) => row.status === "in_progress");
  const started = allAttempts.filter((row) => row.status === "terminal" || now >= (row.startedAt ?? 0));
  const reached = terminal.filter((row) => row.disposition && isReached(row.disposition as Disposition)).length;
  const live: LiveCall[] = pending
    .map((attempt) => {
      const household = byId.get(attempt.rosterEntryId);
      return {
        attemptId: attempt.id,
        displayName: household?.displayName ?? attempt.rosterEntryId,
        phoneMasked: household?.phoneMasked ?? "",
        phase: phaseForAttempt(attempt.startedAt, now),
        startedAt: attempt.startedAt ?? null,
      };
    })
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.displayName.localeCompare(b.displayName));
  const queued = live.filter((call) => call.phase === "queued").length;
  const inFlight = live.length - queued;

  const latestWave = eventWaves.reduce<(typeof eventWaves)[number] | null>((max, wave) => {
    if (!max || wave.waveNo > max.waveNo) return wave;
    return max;
  }, null);
  const waveStatus =
    latestWave?.status === "running" || latestWave?.status === "complete" || latestWave?.status === "killed"
      ? latestWave.status
      : "idle";

  return {
    coverage: {
      dialed: started.length,
      reached,
      unreached: terminal.length - reached,
      inFlight,
      queued,
      planned: latestWave?.budgetCap ?? people.length,
    },
    live,
    cards: (await triageForEvent(eventId)).map((card) => ({
      id: card.id,
      attemptId: card.attemptId,
      rosterEntryId: card.rosterEntryId,
      severity: card.severity,
      needs: card.needs,
      household: card.household
        ? { displayName: card.household.displayName, phoneMasked: card.household.phoneMasked }
        : null,
    })),
    waveStatus,
  };
}

export async function triageForEvent(eventId: string) {
  const cards = db.select().from(schema.triageCards).where(eq(schema.triageCards.eventId, eventId)).all();
  const people = await listRoster(eventId);
  const byId = new Map(people.map((row) => [row.id, row]));
  const latest = new Map<string, (typeof cards)[number]>();
  for (const card of cards) {
    const current = latest.get(card.rosterEntryId);
    if (!current || card.id > current.id) latest.set(card.rosterEntryId, card);
  }

  return [...latest.values()].map((card) => ({
    ...card,
    needs: parseJson<string[]>(card.needsJson, []),
    household: byId.get(card.rosterEntryId),
  }));
}
