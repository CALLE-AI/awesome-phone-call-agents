import { z } from "zod";

const schema = z.object({
  ADMIN_API_KEY: z
    .string()
    .min(16, "ADMIN_API_KEY must be set to a random string of at least 16 characters (e.g. `openssl rand -hex 32`)."),
  CALLE_API_KEY: z.string().default(""),
  CALLE_BASE_URL: z.string().url().default("https://api.heycall-e.com"),
  CALLE_DRY_RUN: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  LIVE_CALL_OVERRIDE_PHONE: z.string().default(""),
  DATABASE_URL: z.string().default("file:./dev.db"),
  PORT: z.coerce.number().default(3000),
  CONFIRM_CRON: z.string().default("0 9 * * *"),
  CONFIRM_CRON_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
});

export type Env = z.infer<typeof schema>;

/** Frozen at import time. Fine for values that never change mid-process (port, cron spec, db path). */
export const env: Env = schema.parse(process.env);

const calleRuntimeSchema = schema.pick({
  CALLE_API_KEY: true,
  CALLE_BASE_URL: true,
  CALLE_DRY_RUN: true,
  LIVE_CALL_OVERRIDE_PHONE: true,
});

export type CalleRuntimeConfig = z.infer<typeof calleRuntimeSchema>;

/**
 * Re-read from process.env on every call, unlike `env` above. The CALL-E
 * client needs this so tests can point CALLE_BASE_URL at a fake server
 * whose port is only known after that server has started (i.e. after this
 * module was already imported) — a frozen module-load snapshot can't do that.
 */
export function readCalleRuntimeConfig(): CalleRuntimeConfig {
  return calleRuntimeSchema.parse(process.env);
}

export function assertLiveCallAllowed(config: CalleRuntimeConfig = readCalleRuntimeConfig()): void {
  if (config.CALLE_DRY_RUN) return;
  if (config.CALLE_API_KEY === "") {
    throw new Error("CALLE_DRY_RUN is false but CALLE_API_KEY is empty. Refusing to run in live mode without credentials.");
  }
  if (!/^\+[1-9]\d{6,14}$/.test(config.LIVE_CALL_OVERRIDE_PHONE)) {
    throw new Error(
      "CALLE_DRY_RUN is false but LIVE_CALL_OVERRIDE_PHONE is not a valid E.164 number. " +
        "Live calls are only ever routed to your own verified number; set it before disabling dry run.",
    );
  }
}
