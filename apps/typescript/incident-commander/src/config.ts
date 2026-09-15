import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const envSchema = z.object({
  CALLE_API_KEY: z.preprocess(emptyToUndefined, z.string().min(8).optional()),
  CALLE_BASE_URL: z.string().url().default("https://api.heycall-e.com"),
  ONCALL_PHONE: z.preprocess(emptyToUndefined, z.string().regex(/^\+[1-9]\d{6,14}$/).optional()),
  ESCALATE_PHONE: z.preprocess(emptyToUndefined, z.string().regex(/^\+[1-9]\d{6,14}$/).optional()),
  ONCALL_REGION: z.string().default("SG"),
  ONCALL_LOCALE: z.string().default("en-US"),
  PUBLIC_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  PORT: z.coerce.number().int().positive().default(8787),
  AWS_REGION: z.string().default("ap-southeast-1"),
  ECS_CLUSTER: z.preprocess(emptyToUndefined, z.string().optional()),
  ECS_SERVICE: z.preprocess(emptyToUndefined, z.string().optional()),
  CW_ALARM_NAME: z.preprocess(emptyToUndefined, z.string().optional()),
  ALB_TARGET_GROUP_ARN: z.preprocess(emptyToUndefined, z.string().optional()),
  ECS_SECURITY_GROUP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  ECS_LOG_GROUP: z.preprocess(emptyToUndefined, z.string().optional()),
  ENABLE_ALARM_POLLER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  ALLOW_AWS_WRITES: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  MAX_DESIRED_COUNT: z.coerce.number().int().positive().default(20),
  DYNAMODB_TABLE_NAME: z.string().default("incident-commander-state")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
