export const VOUCH_RING_MS = 5000;
export const VOUCH_TALK_MS = 7000;

export type LivePhase = "queued" | "ringing" | "on_the_line";

export function callDurationMs() {
  return VOUCH_RING_MS + VOUCH_TALK_MS;
}

export function phaseForAttempt(startedAt: number | null | undefined, now = Date.now()): LivePhase {
  const start = startedAt ?? 0;
  if (now < start) return "queued";
  if (now < start + VOUCH_RING_MS) return "ringing";
  return "on_the_line";
}

export function callProgress(startedAt: number | null | undefined, now = Date.now()) {
  const start = startedAt ?? 0;
  if (now <= start) return 0;
  return Math.min(1, (now - start) / callDurationMs());
}