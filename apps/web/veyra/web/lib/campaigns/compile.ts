import { parseCallDraft, type SafeCallDraft } from "@/lib/calle/safety";
import { publicCalleWebhookUrl } from "@/lib/calle/webhook-url";
import type { CalleCallRequest, CampaignLocale, Contact } from "@/types/campaign";

const CAMPAIGN_NAME_MAX = 120;
const DEFAULT_CAMPAIGN_NAME_MAX = 48;
const CONTACT_NAME_MAX = 120;
const CONTACT_METADATA_MAX_FIELDS = 8;
const CONTACT_METADATA_VALUE_MAX = 160;
const METADATA_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export class CampaignInputError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "CampaignInputError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) issues.push(`${label} contains unknown field(s): ${unknown.join(", ")}`);
}

function parseContactMetadata(
  value: unknown,
  issues: string[],
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push("contact.metadata must be an object of short string values");
    return undefined;
  }

  const entries = Object.entries(value);
  if (entries.length > CONTACT_METADATA_MAX_FIELDS) {
    issues.push(`contact.metadata supports at most ${CONTACT_METADATA_MAX_FIELDS} fields`);
  }

  const metadata: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!METADATA_KEY.test(key)) {
      issues.push(`contact.metadata key "${key}" is invalid`);
      continue;
    }
    if (
      typeof item !== "string" ||
      !item.trim() ||
      item.length > CONTACT_METADATA_VALUE_MAX
    ) {
      issues.push(
        `contact.metadata.${key} must be a non-empty string no longer than ${CONTACT_METADATA_VALUE_MAX} characters`,
      );
      continue;
    }
    metadata[key] = item.trim();
  }
  return metadata;
}

export interface CampaignCompileInput {
  name: string;
  contact: Omit<Contact, "id">;
}

export function parseCampaignCompileInput(value: unknown): CampaignCompileInput {
  if (!isPlainObject(value)) {
    throw new CampaignInputError(["request body must be a JSON object"]);
  }

  const issues: string[] = [];
  onlyKeys(value, ["name", "contact"], "request", issues);

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name.length < 3 || name.length > CAMPAIGN_NAME_MAX) {
    issues.push(`name must contain 3 to ${CAMPAIGN_NAME_MAX} characters`);
  }

  const rawContact = value.contact;
  if (!isPlainObject(rawContact)) issues.push("contact is required");
  const contactValue = isPlainObject(rawContact) ? rawContact : {};
  onlyKeys(contactValue, ["name", "phoneNumber", "metadata"], "contact", issues);

  const contactName =
    typeof contactValue.name === "string" ? contactValue.name.trim() : "";
  if (!contactName || contactName.length > CONTACT_NAME_MAX) {
    issues.push(`contact.name must contain 1 to ${CONTACT_NAME_MAX} characters`);
  }

  const phoneNumber =
    typeof contactValue.phoneNumber === "string" ? contactValue.phoneNumber : "";
  const metadata = parseContactMetadata(contactValue.metadata, issues);

  // parseCallDraft remains the single strict E.164 implementation used at dispatch.
  try {
    parseCallDraft({
      phone: phoneNumber,
      locale: "en-IN",
      task: "Validate this contact phone number before compiling the campaign call.",
      resultSchema: {
        type: "object",
        properties: { valid: { type: "boolean" } },
        required: ["valid"],
        additionalProperties: false,
      },
    });
  } catch {
    issues.push("contact.phoneNumber must use strict E.164 format, for example +14155550100");
  }

  if (issues.length) throw new CampaignInputError(issues);
  return {
    name,
    contact: {
      name: contactName,
      phoneNumber,
      ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
    },
  };
}

/** Convert untrusted engine output into the exact Phase 1 request shape and validate it. */
export function createSafeDraftFromCompiled(
  compiled: CalleCallRequest,
  campaignName: string,
  contact: Contact,
  locale: CampaignLocale,
): SafeCallDraft {
  return parseCallDraft({
    phone: contact.phoneNumber,
    locale,
    task: compiled.task,
    resultSchema: compiled.result_schema,
    metadata: {
      ...compiled.metadata,
      campaignName,
      contactName: contact.name,
    },
  });
}

export function campaignNameFromGoal(goal: string): string {
  const normalized = goal.replace(/\s+/g, " ").trim();
  const base = normalized || "Generated campaign";
  if (base.length <= DEFAULT_CAMPAIGN_NAME_MAX) return base;

  const clipped = base.slice(0, DEFAULT_CAMPAIGN_NAME_MAX - 1).trimEnd();
  const lastWordBoundary = clipped.lastIndexOf(" ");
  const concise = lastWordBoundary >= 24 ? clipped.slice(0, lastWordBoundary) : clipped;
  return `${concise}…`;
}

export function calleWebhookUrl(): string {
  try {
    return publicCalleWebhookUrl();
  } catch {
    throw new CampaignInputError(["APP_URL must be an absolute http(s) URL"]);
  }
}
