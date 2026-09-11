import {
  createCallPreview,
  isE164,
  type CallMode,
  type SafeCallDraft,
  type SafeCallPreview,
} from "@/lib/calle/safety";
import type {
  CampaignLocale,
  CampaignLaunchPreview,
  Contact,
} from "@/types/campaign";
import { CAMPAIGN_LOCALES, CAMPAIGN_LOCALE_LABELS } from "@/types/campaign";

export const MAX_CAMPAIGN_CONTACTS = 10;
export const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METADATA_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export class CampaignLifecycleError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "CampaignLifecycleError";
  }
}

export interface CampaignContactInput {
  id?: string;
  name: string;
  phoneNumber: string;
  metadata?: Record<string, string>;
}

export interface CampaignPreviewInput {
  name: string;
  contacts: CampaignContactInput[];
  locale: CampaignLocale;
  scheduledAt: string | null;
}

export interface CampaignLaunchApproval {
  approvalDigest: string;
  previewApproved: true;
  recipientAuthorizationConfirmed: boolean;
  callCount: number;
}

export interface PreparedCampaignCall {
  contact: Contact;
  draft: SafeCallDraft;
  preview: SafeCallPreview;
  callResultId: string;
}

export interface PreparedCampaignLaunch {
  preview: CampaignLaunchPreview;
  calls: PreparedCampaignCall[];
}

function isObject(value: unknown): value is Record<string, unknown> {
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

export function parseCampaignPreviewInput(value: unknown): CampaignPreviewInput {
  if (!isObject(value)) throw new CampaignLifecycleError(["request body must be an object"]);
  const issues: string[] = [];
  onlyKeys(value, ["name", "contacts", "locale", "scheduledAt"], "request", issues);

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name.length < 3 || name.length > 120) {
    issues.push("name must contain 3 to 120 characters");
  }

  const locale = typeof value.locale === "string" ? value.locale : "en-IN";
  if (!CAMPAIGN_LOCALES.includes(locale as CampaignLocale)) {
    issues.push(`locale must be one of: ${CAMPAIGN_LOCALES.join(", ")}`);
  }

  let scheduledAt: string | null = null;
  if (value.scheduledAt !== undefined && value.scheduledAt !== null && value.scheduledAt !== "") {
    const parsed = typeof value.scheduledAt === "string" ? Date.parse(value.scheduledAt) : Number.NaN;
    const now = Date.now();
    if (!Number.isFinite(parsed)) {
      issues.push("scheduledAt must be a valid ISO-8601 timestamp or null");
    } else if (parsed <= now) {
      issues.push("scheduledAt must be in the future");
    } else if (parsed - now > MAX_SCHEDULE_AHEAD_MS) {
      issues.push("scheduledAt must be no more than 7 days in the future");
    } else {
      scheduledAt = new Date(parsed).toISOString();
    }
  }

  const rawContacts = Array.isArray(value.contacts) ? value.contacts : [];
  if (!rawContacts.length || rawContacts.length > MAX_CAMPAIGN_CONTACTS) {
    issues.push(`contacts must contain 1 to ${MAX_CAMPAIGN_CONTACTS} recipients`);
  }

  const contacts: CampaignContactInput[] = [];
  const phones = new Set<string>();
  rawContacts.forEach((raw, index) => {
    if (!isObject(raw)) {
      issues.push(`contacts[${index}] must be an object`);
      return;
    }
    onlyKeys(raw, ["id", "name", "phoneNumber", "metadata"], `contacts[${index}]`, issues);
    const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
    const contactName = typeof raw.name === "string" ? raw.name.trim() : "";
    const phoneNumber = typeof raw.phoneNumber === "string" ? raw.phoneNumber : "";
    if (!contactName || contactName.length > 120) {
      issues.push(`contacts[${index}].name must contain 1 to 120 characters`);
    }
    if (!isE164(phoneNumber)) {
      issues.push(`contacts[${index}].phoneNumber must use strict E.164 format`);
    } else if (phones.has(phoneNumber)) {
      issues.push(`contacts[${index}].phoneNumber duplicates another recipient`);
    }
    phones.add(phoneNumber);

    let metadata: Record<string, string> | undefined;
    if (raw.metadata !== undefined) {
      if (!isObject(raw.metadata)) {
        issues.push(`contacts[${index}].metadata must be an object`);
      } else {
        metadata = {};
        const entries = Object.entries(raw.metadata);
        if (entries.length > 8) issues.push(`contacts[${index}].metadata supports at most 8 fields`);
        for (const [key, item] of entries) {
          if (!METADATA_KEY.test(key)) {
            issues.push(`contacts[${index}].metadata key "${key}" is invalid`);
          } else if (typeof item !== "string" || !item.trim() || item.length > 160) {
            issues.push(`contacts[${index}].metadata.${key} must be a short non-empty string`);
          } else {
            metadata[key] = item.trim();
          }
        }
      }
    }
    contacts.push({
      ...(id ? { id } : {}),
      name: contactName,
      phoneNumber,
      ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
    });
  });

  if (issues.length) throw new CampaignLifecycleError(issues);
  return { name, contacts, locale: locale as CampaignLocale, scheduledAt };
}

export function parseCampaignLaunchApproval(value: unknown): CampaignLaunchApproval {
  if (!isObject(value)) throw new CampaignLifecycleError(["request body must be an object"]);
  const issues: string[] = [];
  onlyKeys(
    value,
    ["approvalDigest", "previewApproved", "recipientAuthorizationConfirmed", "callCount"],
    "request",
    issues,
  );
  const approvalDigest = typeof value.approvalDigest === "string" ? value.approvalDigest : "";
  if (!/^[a-f0-9]{64}$/.test(approvalDigest)) {
    issues.push("approvalDigest must come from the campaign preview");
  }
  if (value.previewApproved !== true) issues.push("previewApproved must be true");
  if (!Number.isInteger(value.callCount) || Number(value.callCount) < 1) {
    issues.push("callCount must be a positive integer");
  }
  if (typeof value.recipientAuthorizationConfirmed !== "boolean") {
    issues.push("recipientAuthorizationConfirmed must be a boolean");
  }
  if (issues.length) throw new CampaignLifecycleError(issues);
  return {
    approvalDigest,
    previewApproved: true,
    recipientAuthorizationConfirmed: value.recipientAuthorizationConfirmed as boolean,
    callCount: value.callCount as number,
  };
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uuidFromDigest(value: string): string {
  const bytes = Array.from({ length: 16 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isPersistedContactId(value: string | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function prepareCampaignLaunch(params: {
  userId: string;
  campaignId: string;
  mode: CallMode;
  locale: CampaignLocale;
  scheduledAt: string | null;
  calls: Array<{ contact: Contact; draft: SafeCallDraft }>;
}): Promise<PreparedCampaignLaunch> {
  if (!params.calls.length || params.calls.length > MAX_CAMPAIGN_CONTACTS) {
    throw new CampaignLifecycleError([
      `campaign must contain 1 to ${MAX_CAMPAIGN_CONTACTS} calls`,
    ]);
  }
  const calls = await Promise.all(
    params.calls.map(async ({ contact, draft }) => {
      const basePreview = await createCallPreview(params.userId, draft, params.mode);
      const callResultId = uuidFromDigest(basePreview.approvalDigest);
      const enrichedDraft: SafeCallDraft = {
        ...draft,
        metadata: { ...(draft.metadata ?? {}), veyraCallResultId: callResultId },
      };
      const preview = await createCallPreview(params.userId, enrichedDraft, params.mode);
      return { contact, draft: enrichedDraft, preview, callResultId };
    }),
  );
  const approvalDigest = await digest({
    version: 1,
    userId: params.userId,
    campaignId: params.campaignId,
    mode: params.mode,
    locale: params.locale,
    scheduledAt: params.scheduledAt,
    calls: calls.map((call) => ({
      contactId: call.contact.id,
      approvalDigest: call.preview.approvalDigest,
    })),
  });

  return {
    calls,
    preview: {
      campaignId: params.campaignId,
      mode: params.mode,
      callCount: calls.length,
      locale: params.locale,
      localeLabel: CAMPAIGN_LOCALE_LABELS[params.locale],
      scheduledAt: params.scheduledAt,
      recipients: calls.map((call) => ({
        contactId: call.contact.id,
        name: call.contact.name,
        maskedPhone: call.preview.maskedPhone,
        task: call.preview.task,
        resultSchema: call.preview.resultSchema,
        locale: call.draft.locale,
      })),
      sideEffects:
        params.mode === "fake"
          ? ["No external request is made", "No phone call is placed", "No CALL-E credit is used"]
          : [
              "Exactly one outbound phone call is submitted to CALL-E",
              "The call may consume CALL-E credit",
              "An accepted call cannot be cancelled by Veyra",
            ],
      recipientAuthorizationRequired: params.mode === "live",
      approvalDigest,
    },
  };
}
