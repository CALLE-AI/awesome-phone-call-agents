import type { QuietHours } from "../schemas.js";
import type { HouseDarkWindow } from "./shouldRing.js";

export type HouseDarkResolve =
  | { ok: true; window: HouseDarkWindow; source: "env" | "owner" | "default" }
  | { ok: false; reason: string };

/**
 * Resolve house-dark window without treating env defaults as explicit overrides.
 *
 * - Both HOUSE_DARK_START and HOUSE_DARK_END set → env window (TZ: env or owner)
 * - Only one of START/END set → fail closed
 * - Else owner.quiet_hours when present
 * - Else documented default 22:00–07:00 process-local
 */
export function resolveHouseDarkWindow(input: {
  envStart?: string;
  envEnd?: string;
  envTimezone?: string;
  ownerQuietHours?: QuietHours;
}): HouseDarkResolve {
  const start = input.envStart?.trim() || undefined;
  const end = input.envEnd?.trim() || undefined;
  const tz = input.envTimezone?.trim() || undefined;

  const startSet = Boolean(start);
  const endSet = Boolean(end);

  if (startSet !== endSet) {
    return {
      ok: false,
      reason:
        "Partial HOUSE_DARK_START/END override — both must be set together (fail closed).",
    };
  }

  if (startSet && endSet) {
    if (!/^\d{2}:\d{2}$/.test(start!) || !/^\d{2}:\d{2}$/.test(end!)) {
      return {
        ok: false,
        reason: "Invalid HOUSE_DARK_START/END format (expected HH:MM).",
      };
    }
    return {
      ok: true,
      source: "env",
      window: {
        start: start!,
        end: end!,
        timezone: tz || input.ownerQuietHours?.timezone,
      },
    };
  }

  if (input.ownerQuietHours) {
    return {
      ok: true,
      source: "owner",
      window: {
        start: input.ownerQuietHours.start,
        end: input.ownerQuietHours.end,
        timezone: input.ownerQuietHours.timezone,
      },
    };
  }

  return {
    ok: true,
    source: "default",
    window: { start: "22:00", end: "07:00" },
  };
}
