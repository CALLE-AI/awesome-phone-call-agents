import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.string().default('http://localhost:8081'),
  DATABASE_FILE: z.string().default('./data/afterhold.db'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  CALLE_MOCK: z
    .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
    .default('1')
    .transform((v) => v === '1' || v === 'true'),
  CALLE_ENABLED: z
    .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
    .default('1')
    .transform((v) => v === '1' || v === 'true'),
  CALLE_API_KEY: z.string().default(''),
  CALLE_BASE_URL: z.string().default('https://api.heycall-e.com'),

  POLL_FIRST_DELAY_SEC: z.coerce.number().int().positive().default(60),
  POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(8),

  RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(21),
  QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(7),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isMock = env.CALLE_MOCK;
