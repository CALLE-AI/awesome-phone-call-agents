export type Clock = () => number;

let clockImpl: Clock = () => Date.now();

export function systemClock(): Clock {
  return () => Date.now();
}

export function setClock(clock: Clock) {
  clockImpl = clock;
}

export function resetClock() {
  clockImpl = () => Date.now();
}

export function nowMs(): number {
  return clockImpl();
}

export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}

/** Deterministic ISO string for tests/demo playback. */
export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}
