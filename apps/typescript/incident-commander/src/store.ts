import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Incident } from "./types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = join(root, "data", "state.json");

type State = {
  incidents: Incident[];
  processedEventIds: string[];
  openAlarmKeys: Record<string, string>;
};

const empty: State = { incidents: [], processedEventIds: [], openAlarmKeys: {} };
let cache: State | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function readState(): Promise<State> {
  if (cache) return cache;
  try {
    const raw = await readFile(dataFile, "utf8");
    cache = { ...empty, ...JSON.parse(raw) } as State;
  } catch {
    cache = { ...empty };
  }
  return cache;
}

async function persist(state: State): Promise<void> {
  cache = state;
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(dataFile), { recursive: true });
    await writeFile(dataFile, JSON.stringify(state, null, 2), "utf8");
  });
  await writeQueue;
}

export async function listIncidents(): Promise<Incident[]> {
  const state = await readState();
  return [...state.incidents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getIncident(id: string): Promise<Incident | undefined> {
  const state = await readState();
  return state.incidents.find((item) => item.id === id);
}

export async function getIncidentByCallId(callId: string): Promise<Incident | undefined> {
  const incidents = await listIncidents();
  return incidents.find(
    (item) =>
      item.calleCallId === callId || item.escalateCallId === callId || item.resultCallId === callId
  );
}

export async function saveIncident(incident: Incident): Promise<Incident> {
  const currentVersion = incident.version || 0;
  const next = { ...incident, version: currentVersion + 1, updatedAt: new Date().toISOString() };
  const state = await readState();
  const index = state.incidents.findIndex((item) => item.id === next.id);
  if (index === -1) state.incidents.unshift(next);
  else state.incidents[index] = next;
  if (next.alarmName && ["resolved", "failed", "escalated", "no_answer", "timeout"].includes(next.status)) {
    if (state.openAlarmKeys[next.alarmName] === next.id) delete state.openAlarmKeys[next.alarmName];
  } else if (next.alarmName) {
    state.openAlarmKeys[next.alarmName] = next.id;
  }
  await persist(state);
  return next;
}

export async function findOpenAlarmIncident(alarmName: string): Promise<Incident | undefined> {
  const incidents = await listIncidents();
  return incidents.find(
    (item) =>
      item.alarmName === alarmName &&
      !["resolved", "failed", "escalated", "no_answer", "timeout"].includes(item.status)
  );
}

export async function hasProcessedEvent(eventId: string): Promise<boolean> {
  const state = await readState();
  return state.processedEventIds.includes(eventId);
}

export async function markProcessedEvent(eventId: string): Promise<void> {
  const state = await readState();
  if (!state.processedEventIds.includes(eventId)) {
    state.processedEventIds.push(eventId);
    if (state.processedEventIds.length > 500) state.processedEventIds = state.processedEventIds.slice(-400);
    await persist(state);
  }
}
