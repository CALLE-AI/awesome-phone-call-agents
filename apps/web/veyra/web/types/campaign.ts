/**
 * Campaign, contact, and call-result shapes. Documented in TECHNICAL_ARCH.md
 * section 3.2 — keep the two in step.
 */

import type { Workflow } from "@/types/workflow";

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  /** Arbitrary extra fields, e.g. { source: "web form" }. Interpolated into the task. */
  metadata?: Record<string, string>;
}

export const CAMPAIGN_LOCALES = ["en-IN", "en-US", "hi-IN"] as const;
export type CampaignLocale = (typeof CAMPAIGN_LOCALES)[number];

export const CAMPAIGN_LOCALE_LABELS: Record<CampaignLocale, string> = {
  "en-IN": "Indian English",
  "en-US": "US English",
  "hi-IN": "Hinglish (Hindi + English)",
};

/**
 * Narrows a raw DB string to a known CampaignLocale, defaulting to "en-IN" for
 * anything unrecognized (a locale added after a row was written, or bad data).
 * Centralizing this avoids the "value === 'en-US' ? 'en-US' : 'en-IN'" ternary that
 * used to be duplicated at every read site and would have silently dropped hi-IN.
 */
export function toCampaignLocale(value: string): CampaignLocale {
  return (CAMPAIGN_LOCALES as readonly string[]).includes(value)
    ? (value as CampaignLocale)
    : "en-IN";
}

/**
 * The flattened Calls API request produced by lib/compiler.ts. One is built per
 * contact at dispatch time — see TECHNICAL_ARCH.md section 4.3.
 */
export interface CalleCallRequest {
  task: string;
  result_schema: Record<string, unknown>;
  recipient_result_schema?: Record<string, unknown>;
  metadata: { campaignId: string; contactId: string };
  webhook_url: string;
}

export type CampaignStatus =
  | "draft"
  | "compiled"
  | "scheduled"
  | "launching"
  | "launched"
  | "reconciliation_required"
  | "completed"
  | "failed";

export interface Campaign {
  id: string;
  workflowId: string;
  name: string;
  status: CampaignStatus;
  locale: CampaignLocale;
  contacts: Contact[];
  scheduledAt?: string;
  /** Set once the workflow has been compiled for this campaign. */
  compiledAt?: string;
  createdAt: string;
  launchedAt?: string;
}

export type CallStatus =
  | "pending"
  | "submitting"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled"
  | "no_answer"
  | "result_validation_failed"
  | "submission_uncertain";

export interface CallResult {
  id: string;
  campaignId: string;
  contactId: string;
  /** The CALL-E call id, once the call is created. */
  calleCallId?: string;
  qualified: boolean | null;
  /** Null when CALL-E returned structured_result: null — a normal outcome. */
  capturedData: Record<string, unknown> | null;
  summary?: string | null;
  transcript?: string;
  status: CallStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CampaignRecipientPreview {
  contactId: string;
  name: string;
  maskedPhone: string;
  task: string;
  resultSchema: Record<string, unknown>;
  locale: CampaignLocale;
}

export interface CampaignLaunchPreview {
  campaignId: string;
  mode: "fake" | "live";
  callCount: number;
  locale: CampaignLocale;
  localeLabel: string;
  scheduledAt: string | null;
  recipients: CampaignRecipientPreview[];
  sideEffects: string[];
  recipientAuthorizationRequired: boolean;
  approvalDigest: string;
}

/** A campaign plus the workflow it runs, as the campaign builder needs it. */
export interface CampaignDraft {
  workflow: Workflow;
  name: string;
  locale: CampaignLocale;
  scheduledAt: string | null;
  contacts: Contact[];
}
