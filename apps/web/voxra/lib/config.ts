const DEFAULT_BROKER_BASE_URL = "https://seleven-mcp-sg.airudder.com";
const DEFAULT_MCP_URL = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";
const DEFAULT_REDIS_PORT = 6380;

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getIntEnv(name: string, fallback: number): number {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getBoolEnv(name: string, fallback: boolean): boolean {
  const raw = getEnv(name);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function hasRedisConfig(): boolean {
  return Boolean(getEnv("REDIS_URL") || (getEnv("AZURE_REDIS_HOST") && getEnv("AZURE_REDIS_PASSWORD")));
}

export const config = {
  brokerBaseUrl: getEnv("CALLE_BROKER_BASE_URL") ?? DEFAULT_BROKER_BASE_URL,
  mcpUrl: getEnv("CALLE_MCP_URL") ?? DEFAULT_MCP_URL,
  timeoutMs: getIntEnv("CALLE_TIMEOUT_MS", 30_000),
  redisUrl: getEnv("REDIS_URL"),
  redisHost: getEnv("AZURE_REDIS_HOST"),
  redisPort: getIntEnv("AZURE_REDIS_PORT", DEFAULT_REDIS_PORT),
  redisPassword: getEnv("AZURE_REDIS_PASSWORD"),
  redisTls: getBoolEnv("AZURE_REDIS_TLS", true),
  sessionEncryptionKey: getEnv("CALLE_SESSION_ENCRYPTION_KEY"),
};

export function getConfigHealth(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!config.brokerBaseUrl) missing.push("CALLE_BROKER_BASE_URL");
  if (!config.mcpUrl) missing.push("CALLE_MCP_URL");
  if (!config.sessionEncryptionKey) missing.push("CALLE_SESSION_ENCRYPTION_KEY");
  if (!hasRedisConfig()) {
    missing.push("REDIS_URL or AZURE_REDIS_HOST + AZURE_REDIS_PASSWORD");
  }
  return { ok: missing.length === 0, missing };
}
