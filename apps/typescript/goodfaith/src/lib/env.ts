// File: src/lib/env.ts
// server-only; never import from a "use client" module.
import "server-only";

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  calleApiKey: () => read("CALLE_API_KEY"),
  calleBaseUrl: () => read("CALLE_BASE_URL") ?? "https://api.heycall-e.com",
  calleGoalId: () => read("CALLE_GOAL_ID"),
  calleWebhookUrl: () => read("CALLE_WEBHOOK_URL"),
  placesApiKey: () => read("PLACES_API_KEY"),
  live: () => read("GOODFAITH_LIVE") === "1",
  persist: () => read("GOODFAITH_PERSIST") === "1",
};

// isLive is the single source of truth for mode selection.
export function isLive(): boolean {
  return env.live() && !!env.calleApiKey();
}
