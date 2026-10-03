import type { CanonicalCallPayload } from "./types.js";
import { isGlobalStopActive } from "./global-stop.js";

export type GuardConfig = {
  /** Inclusive start hour in timezone (0–23) */
  quiet_hours_start: number;
  /** Exclusive end hour in timezone (0–23) */
  quiet_hours_end: number;
  timezone: string;
  max_calls_per_mission: number;
  /** E.164 allowlist; mock placeholder always allowed */
  allowlist: string[];
  /** Injected "now" for tests */
  now?: Date;
};

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  quiet_hours_start: 8,
  quiet_hours_end: 20,
  timezone: "Europe/Berlin",
  max_calls_per_mission: 8,
  allowlist: ["+490000000000"],
};

export type GuardDecision =
  | { ok: true }
  | { ok: false; code: string; reason: string };

function hourInTimezone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value;
  return Number(hour ?? "0");
}

export function checkDispatchGuards(args: {
  consent_recorded: boolean;
  timezone: string;
  payload: CanonicalCallPayload;
  provider_run_count: number;
  mission_status: string;
  dispatches_stopped: boolean;
  /** Recovery reuses one frozen hard-idempotent key; it is not a new call slot. */
  operation?: "dispatch" | "recover";
  config?: Partial<GuardConfig>;
}): GuardDecision {
  const config = { ...DEFAULT_GUARD_CONFIG, ...args.config };
  const operation = args.operation ?? "dispatch";
  const allow = new Set([
    ...config.allowlist,
    "+490000000000",
    ...(process.env.CALLE_TEST_PHONE ? [process.env.CALLE_TEST_PHONE] : []),
  ]);

  if (isGlobalStopActive()) {
    return {
      ok: false,
      code: "GLOBAL_STOP",
      reason: "external or durable operator global stop is active",
    };
  }
  if (!args.consent_recorded) {
    return { ok: false, code: "NO_CONSENT", reason: "consent_recorded must be true" };
  }
  if (!args.timezone || !args.timezone.includes("/")) {
    return { ok: false, code: "BAD_TIMEZONE", reason: "IANA timezone required" };
  }
  const allowedMissionStatus =
    args.mission_status === "running" ||
    (operation === "recover" && args.mission_status === "blocked_needs_resolution");
  if (!allowedMissionStatus) {
    return {
      ok: false,
      code: "MISSION_NOT_RUNNING",
      reason: `mission status ${args.mission_status}`,
    };
  }
  if (args.dispatches_stopped) {
    return {
      ok: false,
      code: "STOP_DISPATCHES",
      reason: "operator stop_dispatches is active",
    };
  }
  if (
    !Number.isInteger(config.max_calls_per_mission) ||
    config.max_calls_per_mission < 1 ||
    !Number.isInteger(config.quiet_hours_start) ||
    !Number.isInteger(config.quiet_hours_end) ||
    config.quiet_hours_start < 0 ||
    config.quiet_hours_start > 23 ||
    config.quiet_hours_end < 0 ||
    config.quiet_hours_end > 23
  ) {
    return {
      ok: false,
      code: "BAD_GUARD_CONFIG",
      reason: "invalid max-call or quiet-hour guard configuration",
    };
  }
  if (
    operation === "dispatch" &&
    args.provider_run_count >= config.max_calls_per_mission
  ) {
    return {
      ok: false,
      code: "MAX_CALLS",
      reason: `max_calls_per_mission ${config.max_calls_per_mission}`,
    };
  }

  const phones = args.payload.recipients.flatMap((r) => r.phones);
  for (const phone of phones) {
    if (!allow.has(phone)) {
      return {
        ok: false,
        code: "NOT_ALLOWLISTED",
        reason: "recipient not on allowlist",
      };
    }
  }

  const now = config.now ?? new Date();
  let hour: number;
  try {
    hour = hourInTimezone(now, args.timezone || config.timezone);
  } catch {
    return {
      ok: false,
      code: "BAD_TIMEZONE",
      reason: "timezone is not a valid IANA zone",
    };
  }
  const start = config.quiet_hours_start;
  const end = config.quiet_hours_end;
  const inWindow = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!inWindow) {
    return {
      ok: false,
      code: "QUIET_HOURS",
      reason: `outside calling window ${start}:00–${end}:00 ${args.timezone}`,
    };
  }

  return { ok: true };
}

/** Live budget must never be mutated by simulation/mock paths. */
export function assertMockCannotBurnLiveBudget(mode: "mock" | "live"): GuardDecision {
  if (mode === "mock") {
    return { ok: true };
  }
  if (process.env.SPIKE_LIVE !== "1") {
    return {
      ok: false,
      code: "LIVE_REFUSED",
      reason: "live adapter refused without SPIKE_LIVE=1",
    };
  }
  return { ok: true };
}
