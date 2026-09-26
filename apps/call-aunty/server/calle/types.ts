import { z } from "zod";

export const callPurposeSchema = z.enum([
  "follow_up_after_check_in",
  "appointment_coordination",
  "callback_confirmation",
]);
export type CallPurpose = z.infer<typeof callPurposeSchema>;

export const callWorkflowStatusSchema = z.enum([
  "prepared",
  "starting",
  "in_progress",
  "completed",
  "no_answer",
  "failed",
  "cancelled",
  "dry_run_completed",
  "unknown",
]);
export type CallWorkflowStatus = z.infer<typeof callWorkflowStatusSchema>;

export const triageStateSchema = z.enum([
  "routine",
  "contact_chw_today",
  "urgent_in_person_care",
]);
export type TriageState = z.infer<typeof triageStateSchema>;

export const e164PhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Recipient must be E.164");

export const callPolicyDecisionSchema = z.enum(["allow", "dry_run", "deny"]);
export type CallPolicyDecision = z.infer<typeof callPolicyDecisionSchema>;

export const callFailureCodeSchema = z.enum([
  "invalid_recipient",
  "unauthorized",
  "missing_consent",
  "unsupported_region",
  "unsupported_language",
  "urgent_state_conflict",
  "calls_disabled",
  "retry_exhausted",
  "duplicate_in_flight",
  "provider_unavailable",
  "timeout",
  "call_failed",
  "no_answer",
  "cancelled",
  "result_invalid",
  "internal_error",
  "insufficient_call_credits",
  "upgrade_required",
  "monthly_call_limit",
]);
export type CallFailureCode = z.infer<typeof callFailureCodeSchema>;

export const callStructuredResultSchema = z.object({
  reached: z.boolean(),
  availability: z.enum(["available", "busy", "unavailable", "unknown"]),
  needsHumanFollowUp: z.boolean(),
  appointmentConfirmed: z.boolean().nullable(),
  preferredCallbackWindow: z.enum(["morning", "afternoon", "evening", "none", "unknown"]),
  safetyEscalation: z.enum(["none", "contact_chw_today", "urgent_in_person_care"]),
  summaryCode: z.enum([
    "ok_routine",
    "needs_callback",
    "needs_chw",
    "urgent_care",
    "no_answer",
    "incomplete",
  ]),
  nextAction: z.enum(["call_again", "clinic_visit", "urgent_review", "none"]),
  completionConfidence: z.number().min(0).max(1).optional(),
});
export type CallStructuredResult = z.infer<typeof callStructuredResultSchema>;

export const prepareCallInputSchema = z.object({
  womanId: z.string().min(1).max(128),
  purpose: callPurposeSchema.default("follow_up_after_check_in"),
  recipientE164: e164PhoneSchema,
  recipientRegion: z.string().min(2).max(8),
  callLanguage: z.string().min(2).max(16),
  triageState: triageStateSchema.default("contact_chw_today"),
  callConsentGranted: z.boolean(),
  consentSource: z.enum(["woman_record", "chw_attestation", "unknown"]).optional(),
  consentRecordedAt: z.string().datetime().optional(),
  actionToken: z.string().min(8).max(128),
  forceDryRun: z.boolean().optional(),
});
export type PrepareCallInput = z.infer<typeof prepareCallInputSchema>;

export const confirmCallInputSchema = z.object({
  workflowId: z.string().min(1).max(64),
  prepareToken: z.string().min(8).max(128),
});
export type ConfirmCallInput = z.infer<typeof confirmCallInputSchema>;

export type CallWorkflow = {
  id: string;
  purpose: CallPurpose;
  womanId: string;
  recipientE164: string;
  recipientRegion: string;
  callLanguage: string;
  initiatorUserId: number;
  triageState: TriageState;
  callConsentGranted: boolean;
  consentSource: "woman_record" | "chw_attestation" | "unknown" | null;
  attemptCount: number;
  policyDecision: CallPolicyDecision;
  policyReasonCode: CallFailureCode | "ok";
  policyExplanation: string;
  idempotencyKey: string;
  prepareToken: string;
  providerCallId: string | null;
  phoneProviderId?: string | null;
  status: CallWorkflowStatus;
  dryRun: boolean;
  structuredResult: CallStructuredResult | null;
  failureCode: CallFailureCode | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export const CALL_E_RESULT_JSON_SCHEMA = {
  type: "object",
  required: [
    "reached",
    "availability",
    "needsHumanFollowUp",
    "appointmentConfirmed",
    "preferredCallbackWindow",
    "safetyEscalation",
    "summaryCode",
    "nextAction",
  ],
  properties: {
    reached: { type: "boolean" },
    availability: { type: "string", enum: ["available", "busy", "unavailable", "unknown"] },
    needsHumanFollowUp: { type: "boolean" },
    appointmentConfirmed: { type: ["boolean", "null"] },
    preferredCallbackWindow: {
      type: "string",
      enum: ["morning", "afternoon", "evening", "none", "unknown"],
    },
    safetyEscalation: {
      type: "string",
      enum: ["none", "contact_chw_today", "urgent_in_person_care"],
    },
    summaryCode: {
      type: "string",
      enum: ["ok_routine", "needs_callback", "needs_chw", "urgent_care", "no_answer", "incomplete"],
    },
    nextAction: {
      type: "string",
      enum: ["call_again", "clinic_visit", "urgent_review", "none"],
    },
  },
} as const;

export const CallStatusSchema = z.enum(["queued", "in_progress", "completed", "failed", "canceled"]);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export type JsonSchema = {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean" | string;
  description?: string;
  enum?: string[];
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

export type Recipient = { phones: string[]; region?: string; locale?: string };

export type CreateCallRequest = {
  task: string;
  recipients: Recipient[];
  resultSchema?: JsonSchema;
  recipientResultSchema?: JsonSchema;
  metadata?: Record<string, string>;
  idempotencyKey: string;
  webhookUrl?: string;
};

export type CallTask = {
  id: string;
  object?: "call_task";
  status: CallStatus;
  task: string;
  recipients: unknown[];
  structured_result?: unknown;
  summary?: string | null;
  task_completed?: boolean;
  completion_confidence?: { score: number; label: string } | null;
  evidence?: string[];
  metadata?: Record<string, string>;
  failure_code?: string | null;
  failure_message?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type CallEvent = {
  id: string;
  type: string;
  call_id: string;
  created_at: string;
  level?: string;
  status?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type CallEventPage = {
  object: "list";
  data: CallEvent[];
  next_cursor?: string | null;
};

export const CreateCallRequestSchema = z.object({
  task: z.string().min(1).max(20_000),
  recipients: z
    .array(
      z.object({
        phones: z.array(z.string().min(1)).min(1),
        region: z.string().length(2).optional(),
        locale: z.string().min(2).optional(),
      }),
    )
    .min(1)
    .max(100),
  resultSchema: z.custom<JsonSchema>().optional(),
  recipientResultSchema: z.custom<JsonSchema>().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  idempotencyKey: z.string().min(8).max(255),
  webhookUrl: z.string().url().optional(),
});
