import { z } from "zod";

const schema = z.object({
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

export const env: Env = schema.parse(process.env);

export function assertLiveCallAllowed(): void {
  if (env.CALLE_DRY_RUN) return;
  if (env.CALLE_API_KEY === "") {
    throw new Error("CALLE_DRY_RUN is false but CALLE_API_KEY is empty. Refusing to run in live mode without credentials.");
  }
  if (!/^\+[1-9]\d{6,14}$/.test(env.LIVE_CALL_OVERRIDE_PHONE)) {
    throw new Error(
      "CALLE_DRY_RUN is false but LIVE_CALL_OVERRIDE_PHONE is not a valid E.164 number. " +
        "Live calls are only ever routed to your own verified number; set it before disabling dry run.",
    );
  }
}
