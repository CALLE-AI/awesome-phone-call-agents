import type { AgentClock, AgentIdFactory } from "./types";

export function createIdFactory(): AgentIdFactory {
  let n = 0;
  return {
    next(prefix: string) {
      n += 1;
      return `${prefix}_${String(n).padStart(4, "0")}`;
    },
  };
}

export function createSequenceClock(startIso = "2026-09-14T12:00:00.000Z"): AgentClock {
  let ms = Date.parse(startIso);
  return {
    nowIso() {
      const iso = new Date(ms).toISOString();
      ms += 1000;
      return iso;
    },
  };
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}
