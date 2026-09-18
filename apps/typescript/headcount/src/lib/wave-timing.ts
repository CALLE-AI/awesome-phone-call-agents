export const WAVE_STAGGER_MS = 2400;
export const WAVE_RING_MS = 6000;
export const WAVE_TALK_MS = 8000;

export type LivePhase = "queued" | "ringing" | "on_the_line";

export function callDurationMs() {
  return WAVE_RING_MS + WAVE_TALK_MS;
}

export function phaseForAttempt(startedAt: number | null | undefined, now = Date.now()): LivePhase {
  const start = startedAt ?? 0;
  if (now < start) return "queued";
  if (now < start + WAVE_RING_MS) return "ringing";
  return "on_the_line";
}

/** 0 while queued, then 0→1 across calling + talking. */
export function callProgress(startedAt: number | null | undefined, now = Date.now()) {
  const start = startedAt ?? 0;
  if (now <= start) return 0;
  return Math.min(1, (now - start) / callDurationMs());
}