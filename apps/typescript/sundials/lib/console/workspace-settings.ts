import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WorkspaceSettings } from "../types.ts";

function settingsPath(): string {
  const dbPath = process.env.SUNDIALS_DB_PATH || join(process.cwd(), "data", "sundials.db");
  if (dbPath === ":memory:") return join(process.cwd(), "data", "sundials-settings.json");
  return join(dirname(dbPath), "sundials-settings.json");
}

export function readWorkspaceSettings(): WorkspaceSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as { dataSource?: string };
    return { dataSource: raw.dataSource === "mock" ? "mock" : "live" };
  } catch {
    return { dataSource: "live" };
  }
}

export function writeWorkspaceSettings(next: WorkspaceSettings): WorkspaceSettings {
  const settings: WorkspaceSettings = { dataSource: next.dataSource === "mock" ? "mock" : "live" };
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}
