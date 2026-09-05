import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = path.resolve(__dirname, "../..");

/**
 * Minimal dotenv loader (no dependency). Does not override existing env.
 * Never logs values.
 */
export function loadDotEnv(envPath = path.join(SKILL_ROOT, ".env")): void {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export interface SkillEnv {
  calleApiKey: string;
  calleBaseUrl: string;
  calleRegion: string;
  calleLocale: string;
  /**
   * Optional CreateCallInput.webhookUrl — CALL-E POSTs terminal results here.
   * Curtain-up still defaults to create → persist id → waitForResult unless
   * calleWait is false.
   */
  calleWebhookUrl: string;
  /** When false + webhook URL set, skip waitForResult (async completion). */
  calleWait: boolean;
  csOwnerE164: string;
  csOwnerName: string;
  csOwnerId: string;
  signalConfirm: string;
  /** Explicit only — empty means unset (do not treat as default). */
  houseDarkStart: string;
  houseDarkEnd: string;
  houseDarkTimezone: string;
  dedupeMinutes: number;
  ownerMaxRings: number;
  dataDir: string;
  /** Action-intent adapters — placeholders resolve to HOLD, never a silent no-op */
  slackWebhookUrl: string;
  githubToken: string;
  githubRepo: string;
  githubIssue: string;
}

function envFlagTrue(raw: string | undefined, defaultTrue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultTrue;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(v)) return false;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  return defaultTrue;
}

export function readSkillEnv(): SkillEnv {
  const dataDirRaw = process.env.DATA_DIR?.trim();
  return {
    calleApiKey: process.env.CALLE_API_KEY?.trim() ?? "",
    calleBaseUrl: process.env.CALLE_BASE_URL?.trim() || "https://api.heycall-e.com",
    calleRegion: process.env.CALLE_REGION?.trim() || "US",
    calleLocale: process.env.CALLE_LOCALE?.trim() || "en-US",
    calleWebhookUrl: process.env.CALLE_WEBHOOK_URL?.trim() ?? "",
    calleWait: envFlagTrue(process.env.CALLE_WAIT, true),
    csOwnerE164: process.env.CS_OWNER_E164?.trim() ?? "",
    csOwnerName: process.env.CS_OWNER_NAME?.trim() ?? "",
    csOwnerId: process.env.CS_OWNER_ID?.trim() ?? "",
    signalConfirm: process.env.SIGNAL_CONFIRM?.trim() ?? "",
    // Empty string when unset — resolveHouseDarkWindow distinguishes explicit vs default
    houseDarkStart: process.env.HOUSE_DARK_START?.trim() ?? "",
    houseDarkEnd: process.env.HOUSE_DARK_END?.trim() ?? "",
    houseDarkTimezone: process.env.HOUSE_DARK_TIMEZONE?.trim() ?? "",
    dedupeMinutes: Number(process.env.DEDUPE_MINUTES ?? "120") || 120,
    ownerMaxRings: Number(process.env.OWNER_MAX_RINGS ?? "2") || 2,
    dataDir: dataDirRaw
      ? path.isAbsolute(dataDirRaw)
        ? dataDirRaw
        : path.resolve(SKILL_ROOT, dataDirRaw)
      : path.join(SKILL_ROOT, "data"),
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL?.trim() ?? "",
    githubToken: process.env.GITHUB_TOKEN?.trim() ?? "",
    githubRepo: process.env.GITHUB_REPO?.trim() ?? "",
    githubIssue: process.env.GITHUB_ISSUE?.trim() ?? "",
  };
}

/** Live gate: --live AND type/env PLACES */
export function liveGateOpen(args: {
  liveFlag: boolean;
  placesTyped: boolean;
  env: SkillEnv;
}): boolean {
  if (!args.liveFlag) return false;
  const envPlaces = args.env.signalConfirm.toUpperCase() === "PLACES";
  return args.placesTyped || envPlaces;
}
