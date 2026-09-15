import { resolveCalleBaseUrl } from "../../../lib/calle/config";

interface HealthDependencies {
  apiKey?: string | null;
  baseUrl?: string;
  environment?: string;
  now?: () => Date;
}

export function healthResponse(
  dependencies: HealthDependencies = {},
): Response {
  const environment =
    dependencies.environment ?? process.env.NODE_ENV ?? "development";
  let baseUrlValid = true;
  try {
    resolveCalleBaseUrl(
      dependencies.baseUrl ?? process.env.CALLE_BASE_URL,
      environment,
    );
  } catch {
    baseUrlValid = false;
  }

  const apiKey =
    dependencies.apiKey === undefined
      ? process.env.CALLE_API_KEY
      : dependencies.apiKey;
  const ready = Boolean(apiKey) && baseUrlValid;

  return Response.json(
    {
      app: "bellwrench",
      version: "0.1.0",
      status: ready ? "ready" : "configuration_required",
      baseUrlValid,
      timestamp: (dependencies.now ?? (() => new Date()))().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
