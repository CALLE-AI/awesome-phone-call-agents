import type { Provider } from "./types";
import { getCalleV4PublicConfig, type CalleV4Config } from "./config";

export async function health(provider: Provider, config: CalleV4Config) {
  const { mode: _ignored, ...publicConfig } = getCalleV4PublicConfig(config);
  if (config.demoMode) {
    return {
      ok: true,
      providerReachable: false,
      ...publicConfig,
      mode: "demo" as const,
    };
  }
  try {
    await provider.getCall("health-check-invalid");
    return { ok: true, providerReachable: true, ...publicConfig, mode: "live" as const };
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error
      ? Number((error as { status: number }).status)
      : undefined;
    return {
      ok: status === 401 || status === 403 ? false : true,
      providerReachable: status !== undefined && status !== 401 && status !== 403,
      status,
      ...publicConfig,
      mode: "live" as const,
    };
  }
}
