import { promises as fs } from "fs";
import path from "path";
import type { Mission } from "@/types";
import { pgEnabled, pgGetMission, pgListMissions, pgNextMissionNumber, pgSaveMission } from "@/lib/pgstore";

// Durable Postgres is used whenever DATABASE_URL is set (required on
// serverless, where local files are ephemeral and per-instance).
// Otherwise a local JSON file backs development.
const usePg = () => pgEnabled();

const DATA_FILE = path.join(process.cwd(), ".data", "missions.json");
let mem: Mission[] = [];
let counter = 1042;
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as { missions: Mission[]; counter: number };
    mem = parsed.missions ?? [];
    counter = parsed.counter ?? 1042;
  } catch { mem = []; }
}

async function persist() {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify({ missions: mem, counter }, null, 2), "utf8");
  } catch { /* ephemeral envs */ }
}

export async function listMissions(): Promise<Mission[]> {
  if (usePg()) return pgListMissions();
  await load();
  return [...mem].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getMission(id: string): Promise<Mission | null> {
  if (usePg()) return pgGetMission(id);
  await load();
  return mem.find((m) => m.id === id) ?? null;
}
export async function saveMission(m: Mission): Promise<Mission> {
  if (usePg()) return pgSaveMission(m);
  await load();
  const i = mem.findIndex((x) => x.id === m.id);
  if (i >= 0) mem[i] = m; else mem.push(m);
  await persist();
  return m;
}
export async function nextMissionNumber(): Promise<number> {
  if (usePg()) return pgNextMissionNumber();
  await load();
  const n = counter++;
  await persist();
  return n;
}
