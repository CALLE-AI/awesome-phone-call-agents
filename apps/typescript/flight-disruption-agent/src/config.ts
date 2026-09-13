import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliGateway, DryRunGateway, SdkGateway, type CallGateway } from "./calle.ts";

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env loader so the app has no extra dependency. Real env vars win. */
export function loadEnvFile(path = join(APP_ROOT, ".env")): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] === undefined) continue;
    const key = match[1];
    const value = (match[2] ?? "").replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function gatewayFromEnv(env = process.env): CallGateway {
  const mode = (env.CALLE_MODE ?? "dry-run").trim();
  if (mode === "dry-run" || mode === "") return new DryRunGateway();
  if (mode === "sdk") {
    const key = env.CALLE_API_KEY?.trim();
    if (!key) throw new Error("CALLE_MODE=sdk needs CALLE_API_KEY (dashboard.heycall-e.com/account/api-keys).");
    return new SdkGateway(key);
  }
  if (mode === "cli") return new CliGateway(env.CALLE_CLI?.trim() || "calle");
  throw new Error(`Unknown CALLE_MODE "${mode}". Use dry-run, sdk, or cli.`);
}
