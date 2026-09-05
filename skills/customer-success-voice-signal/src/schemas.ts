import { z } from "zod";

export const TriggerIdSchema = z.enum([
  "stuck_support",
  "sla_risk",
  "agent_needs_decision",
  "health_onboarding",
]);
export type TriggerId = z.infer<typeof TriggerIdSchema>;

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const QuietHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().min(1),
});
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export const AccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: z.enum(["standard", "business", "enterprise"]).default("standard"),
  health_flags: z.array(z.string()).default([]),
});
export type Account = z.infer<typeof AccountSchema>;

export const CsOwnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  opt_in_phone: z.boolean(),
  quiet_hours: QuietHoursSchema.optional(),
});
export type CsOwner = z.infer<typeof CsOwnerSchema>;

export const DecisionOptionSchema = z.object({
  option_id: z.enum(["1", "2", "3"]),
  decision: z.string().min(1),
  decision_label: z.string().min(1),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const AccountEventSchema = z.object({
  event_id: z.string().min(1),
  trigger_id: TriggerIdSchema,
  account: AccountSchema,
  cs_owner: CsOwnerSchema,
  severity: SeveritySchema,
  summary: z.string().min(1),
  brief: z.string().min(1),
  ticket_id: z.string().optional(),
  option_set: z.array(DecisionOptionSchema).length(3).optional(),
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type AccountEvent = z.infer<typeof AccountEventSchema>;

export const CallIntentSchema = z.object({
  persona: z.literal("Stage Manager"),
  trigger_id: TriggerIdSchema,
  account_id: z.string(),
  account_name: z.string(),
  cs_owner_id: z.string(),
  cs_owner_name: z.string(),
  callee_e164: z.string(),
  task: z.string().min(1),
  options: z.array(DecisionOptionSchema).length(3),
  result_schema: z.record(z.unknown()),
  never_call_customer: z.literal(true),
  metadata: z.record(z.unknown()).default({}),
});
export type CallIntent = z.infer<typeof CallIntentSchema>;

export const DecisionResultSchema = z.object({
  trigger_id: TriggerIdSchema,
  account_id: z.string(),
  account_name: z.string(),
  cs_owner_id: z.string(),
  call_run_id: z.string().nullable(),
  decision: z.string(),
  decision_label: z.string(),
  option_id: z.enum(["1", "2", "3", "hold", "unknown"]),
  notes_short: z.string().nullable(),
  follow_up_at: z.string().nullable(),
  completed_at: z.string(),
  mode: z.enum(["dress_rehearsal", "curtain_up"]),
  hold_reason: z.string().nullable().optional(),
});
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

export const RawFixtureSchema = z.object({
  fixture_id: z.string().min(1),
  trigger_id: TriggerIdSchema,
  account: AccountSchema,
  cs_owner: CsOwnerSchema,
  severity: SeveritySchema,
  summary: z.string().min(1),
  brief: z.string().min(1),
  ticket_id: z.string().optional(),
  option_set: z.array(DecisionOptionSchema).length(3).optional(),
  occurred_at: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type RawFixture = z.infer<typeof RawFixtureSchema>;
