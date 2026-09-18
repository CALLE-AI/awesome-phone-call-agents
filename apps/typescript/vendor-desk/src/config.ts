import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),

  calle: {
    apiKey: process.env.CALLE_API_KEY ?? "",
    baseUrl: required("CALLE_BASE_URL", "https://api.heycall-e.com"),
  },

  webhook: {
    baseUrl: required("PUBLIC_WEBHOOK_BASE_URL", "http://localhost:3001"),
    get url() {
      return `${this.baseUrl.replace(/\/$/, "")}/api/calle-webhook`;
    },
  },

  defaults: {
    region: process.env.DEFAULT_RECIPIENT_REGION ?? "US",
    locale: process.env.DEFAULT_RECIPIENT_LOCALE ?? "en-US",
  },

  // Safety default: no real phone calls unless explicitly opted in.
  // Set CALLE_DRY_RUN=false to place live calls.
  dryRun: process.env.CALLE_DRY_RUN !== "false",
};

export function assertCalleConfigured(): void {
  if (config.dryRun) return; // no live API calls, so no key needed
  if (!config.calle.apiKey) {
    throw new Error(
      "CALLE_API_KEY is not set. Copy .env.example to .env and add your CALL-E API key " +
        "(see docs.heycall-e.com/#/sdks for beta onboarding), or set CALLE_DRY_RUN=true to run without one."
    );
  }
}
