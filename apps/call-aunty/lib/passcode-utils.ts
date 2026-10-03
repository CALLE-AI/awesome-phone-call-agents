const PASSCODE_PATTERN = /^\d{4,6}$/;
export const MAX_PASSCODE_ATTEMPTS = 3;
export const PASSCODE_COOLDOWN_MS = 30_000;

export function isValidPasscode(passcode: string) {
  return PASSCODE_PATTERN.test(passcode);
}

export function getPasscodeStrength(passcode: string) {
  if (!isValidPasscode(passcode)) return "Enter 4–6 digits";
  if (/^(\d)\1+$/.test(passcode) || "0123456789".includes(passcode) || "9876543210".includes(passcode)) return "Needs a less predictable pattern";
  return passcode.length >= 6 ? "Strong enough for this device" : "Good · 6 digits is stronger";
}

export function isCooldownActive(cooldownUntil: number | null, now: number) {
  return cooldownUntil !== null && cooldownUntil > now;
}

export function getCooldownSeconds(cooldownUntil: number | null, now: number) {
  if (!isCooldownActive(cooldownUntil, now)) return 0;
  return Math.max(1, Math.ceil((cooldownUntil! - now) / 1000));
}

export function getCooldownProgress(cooldownUntil: number | null, now: number) {
  if (cooldownUntil === null) return 0;
  return Math.min(1, Math.max(0, 1 - (cooldownUntil - now) / PASSCODE_COOLDOWN_MS));
}

export function nextFailedAttempt(attempts: number, now: number) {
  const nextAttempts = attempts + 1;
  return { attempts: nextAttempts, cooldownUntil: nextAttempts >= MAX_PASSCODE_ATTEMPTS ? now + PASSCODE_COOLDOWN_MS : null };
}
