import { z } from 'zod';
export const ConfigSchema = z.object({
  apiKey:z.string().min(1), baseUrl:z.string().url().default('https://api.heycall-e.com'),
  webhookSecret:z.string().optional(), timeoutMs:z.coerce.number().int().positive().default(30000),
  maxRetries:z.coerce.number().int().min(0).max(5).default(3),
  allowedRegions:z.string().default('CA,US,GB,AU,SG,IN'),
  demoMode:z.coerce.boolean().default(false),
});
export type Config=z.infer<typeof ConfigSchema>;
export function loadConfig(env=process.env):Config {
  return ConfigSchema.parse({apiKey:env.CALLE_API_KEY,baseUrl:env.CALLE_BASE_URL,webhookSecret:env.CALLE_WEBHOOK_SECRET,timeoutMs:env.CALLE_TIMEOUT_MS,maxRetries:env.CALLE_MAX_RETRIES,allowedRegions:env.CALLE_ALLOWED_REGIONS,demoMode:env.CALLE_DEMO_MODE});
}
