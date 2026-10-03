import type { ServerEnvironment } from "../config/runtime";

export interface SupabasePublicConfig {
  readonly publishableKey: string;
  readonly url: string;
}

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 16) throw new Error(`${name} is not configured`);
  return trimmed;
}

export function readSupabasePublicConfig(
  environment: ServerEnvironment,
): SupabasePublicConfig {
  const url = required("NEXT_PUBLIC_SUPABASE_URL", environment.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("Supabase URL must use HTTPS outside loopback development");
  }
  return { publishableKey, url: parsed.toString().replace(/\/$/, "") };
}
