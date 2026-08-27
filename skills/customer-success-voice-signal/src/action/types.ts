import { z } from "zod";

/** Named Monday-morning adapters — POC emits the contract; live CRM is next. */
export const AdapterHintSchema = z.enum([
  "zendesk_ticket_note",
  "salesforce_task",
  "slack_webhook",
  "internal_queue",
  "none",
]);
export type AdapterHint = z.infer<typeof AdapterHintSchema>;

export const ActionIntentStatusSchema = z.enum([
  "pending",
  "dry_run_printed",
  "executed_local",
]);
export type ActionIntentStatus = z.infer<typeof ActionIntentStatusSchema>;

export const ActionIntentSchema = z.object({
  intent_id: z.string().min(1),
  at: z.string().datetime(),
  status: ActionIntentStatusSchema,
  mode: z.enum(["dress_rehearsal", "curtain_up"]),
  trigger_id: z.string().min(1),
  account_id: z.string().min(1),
  account_name: z.string().min(1),
  cs_owner_id: z.string().min(1),
  ticket_id: z.string().nullable(),
  call_run_id: z.string().nullable(),
  option_id: z.enum(["1", "2", "3", "hold", "unknown"]),
  decision: z.string().min(1),
  decision_label: z.string().min(1),
  /** Stable verb for downstream systems */
  action: z.string().min(1),
  /** Primary adapter this intent targets */
  adapter: AdapterHintSchema,
  /** Planned adapter family (documentation / POC seam) */
  adapters_planned: z.array(AdapterHintSchema).min(1),
  follow_up_at: z.string().datetime().nullable(),
  /** Payload a Zendesk/Salesforce/Slack adapter would consume */
  payload: z.record(z.unknown()),
  notes: z.string().nullable(),
});
export type ActionIntent = z.infer<typeof ActionIntentSchema>;

export const ActionReceiptSchema = z.object({
  receipt_id: z.string().min(1),
  at: z.string().datetime(),
  intent_id: z.string().min(1),
  dry_run: z.boolean(),
  /** "local_receipt" unless a live adapter actually posted */
  effect: z.enum(["local_receipt", "slack_webhook_posted", "github_comment_posted"]),
  summary: z.string().min(1),
  intent: ActionIntentSchema,
});
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;
