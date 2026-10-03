import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

function stopFilePath(): string {
  if (process.env.CONTINUUM_GLOBAL_STOP_FILE) {
    return resolve(process.env.CONTINUUM_GLOBAL_STOP_FILE);
  }
  const dbPath = process.env.CONTINUUM_DB;
  if (dbPath && dbPath !== ":memory:") {
    return join(dirname(resolve(dbPath)), "global-stop.lock");
  }
  return join(process.cwd(), ".data", "global-stop.lock");
}

/** External SPIKE_STOP and the durable operator lock are independent stops. */
export function isGlobalStopActive(): boolean {
  return (
    process.env.SPIKE_STOP === "1" ||
    process.env.CONTINUUM_OPERATOR_STOP === "1" ||
    existsSync(stopFilePath())
  );
}

/** Persist/clear only the authenticated operator stop, never an external stop. */
export function setDurableOperatorStop(on: boolean): void {
  const path = stopFilePath();
  if (on) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeFileSync(fd, "STOP\n", "utf8");
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    process.env.CONTINUUM_OPERATOR_STOP = "1";
    return;
  }

  if (existsSync(path)) unlinkSync(path);
  delete process.env.CONTINUUM_OPERATOR_STOP;
}

export function globalStopFileForDiagnostics(): string {
  return stopFilePath();
}
