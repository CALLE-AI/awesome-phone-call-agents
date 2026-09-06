/** Environment/config loader. Demo mode defaults ON so nothing calls out by accident. */

export interface AppConfig {
  demo: boolean;
  apiKey?: string;
  baseUrl?: string;
  auditFile: string;
  port: number;
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Fail SAFE: demo mode is on unless explicitly disabled.
  const demo = envBool(env.DEMO_MODE, true);
  const config: AppConfig = {
    demo,
    auditFile: env.ATTEST_AUDIT_FILE ?? "./data/attestations.log",
    port: Number(env.PORT ?? 4600),
  };
  if (env.CALLE_API_KEY) config.apiKey = env.CALLE_API_KEY;
  if (env.CALLE_BASE_URL) config.baseUrl = env.CALLE_BASE_URL;
  return config;
}
