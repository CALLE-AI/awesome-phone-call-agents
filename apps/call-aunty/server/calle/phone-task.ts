import { z } from "zod";
import type { CallPurpose, TriageState } from "./types";

/** Canonical phone-task model (V3). Maps onto CallWorkflow for persistence/UI. */
export const phoneTaskStatusSchema = z.enum([
  "draft",
  "approved",
  "queued",
  "dialing",
  "ringing",
  "connected",
  "in_progress",
  "completed",
  "no_answer",
  "busy",
  "voicemail",
  "failed",
  "canceled",
  "blocked",
  "needs_review",
]);
export type PhoneTaskStatus = z.infer<typeof phoneTaskStatusSchema>;

export const consentStateSchema = z.enum(["granted", "missing", "expired", "revoked"]);
export type ConsentState = z.infer<typeof consentStateSchema>;

export type PhoneTask = {
  taskId: string;
  beneficiaryId: string;
  purpose: CallPurpose;
  priority: "low" | "normal" | "high";
  consentState: ConsentState;
  target: {
    e164Masked: string;
    region: string;
    locale: string;
  };
  preferredWindow: "morning" | "afternoon" | "evening" | "any";
  scriptVersion: string;
  aiPolicyVersion: string;
  idempotencyKey: string;
  status: PhoneTaskStatus;
  attemptCount: number;
  triageState: TriageState;
  createdAt: string;
  updatedAt: string;
  redactedMetadata: Record<string, string | number | boolean | null>;
};

export type PhoneTaskEvent = {
  eventId: string;
  taskId: string;
  fromStatus: PhoneTaskStatus | null;
  toStatus: PhoneTaskStatus;
  actor: "system" | "chw" | "provider" | "demo";
  source: string;
  at: string;
  /** Non-sensitive diagnostic code only */
  code?: string;
};
