import { z } from "zod";

export const rentalInput = z.object({
  assetId: z.string().trim().min(2).max(50),
  name: z.string().trim().min(3).max(100),
  supplier: z.string().trim().min(2).max(100),
  contract: z.string().trim().min(2).max(60),
  site: z.string().trim().min(2).max(150),
  dailyRate: z.number().min(0).max(100000),
  currency: z.enum(["USD", "GBP", "INR", "SGD", "AUD"]).default("USD"),
  phone: z
    .string()
    .regex(
      /^\+[1-9]\d{7,14}$/,
      "Use an international number, for example +14155550123.",
    )
    .or(z.literal("")),
  region: z.enum(["US", "GB", "IN", "SG", "AU", "CA"]).default("US"),
  timezone: z
    .string()
    .max(60)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone."),
  requestedAt: z.string().datetime({ offset: true }),
  accessNotes: z.string().trim().max(500),
  requestNote: z.string().trim().min(5).max(800),
  ready: z.boolean(),
  authorizedContact: z.boolean(),
  isTest: z.boolean().default(false),
});
export type RentalInput = z.infer<typeof rentalInput>;
export type Rental = RentalInput & {
  id: string;
  workspaceId: string;
  createdAt: string;
  collectedAt: string | null;
  writtenConfirmation: boolean;
  invoiceReviewed: boolean;
};
export type Scenario =
  | "confirmed"
  | "ambiguous"
  | "voicemail"
  | "contradiction"
  | "unsupported"
  | "wrong_asset";
export type Turn = {
  speaker: "bot" | "user" | "unknown";
  text: string;
  offset_seconds: number | null;
};
export const extractionSchema = z
  .object({
    contact_outcome: z.enum([
      "reached",
      "voicemail",
      "no_answer",
      "wrong_party",
      "refused",
      "unknown",
    ]),
    authorized_representative: z.enum(["yes", "no", "unknown"]),
    representative_name: z.string().max(150),
    asset_id: z.string().max(60),
    contract_id: z.string().max(60),
    identity_quote: z.string().max(2000),
    billing_status: z.enum(["off_rent_confirmed", "still_billing", "unknown"]),
    off_rent_at: z.string().max(100),
    off_rent_reference: z.string().max(100),
    billing_quote: z.string().max(2000),
    reference_quote: z.string().max(2000),
    readback_confirmed: z.enum(["yes", "no", "unknown"]),
    readback_quote: z.string().max(2000),
    pickup_status: z.enum(["scheduled", "pending", "collected", "unknown"]),
    pickup_window: z.string().max(300),
    pickup_quote: z.string().max(2000),
    written_confirmation: z.enum([
      "sent",
      "requested",
      "unavailable",
      "unknown",
    ]),
    conditions: z.string().max(1000),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export type CallSnapshot = {
  id: string;
  status: string;
  taskCompleted: boolean | null;
  structuredResult: unknown;
  summary: string | null;
  completedAt: string | null;
  failureCode?: string | null;
  recipients: {
    status: string;
    structuredResult?: unknown;
    attempts: { status: string; transcriptTurns: Turn[] }[];
  }[];
};
export type Decision = {
  disposition: "confirmed" | "needs_review" | "unreached";
  billing: "reported_off_rent" | "still_billing" | "unconfirmed";
  pickup: "scheduled" | "pending" | "reported_collected" | "unknown";
  title: string;
  reasons: string[];
  nextAction: string;
  offRentAt: string | null;
  reference: string | null;
  pickupWindow: string | null;
  evidence: { field: string; quote: string; turn: number }[];
  extracted: Extraction | null;
  transcript: Turn[];
};
export type JobStatus =
  | "prepared"
  | "dispatching"
  | "dispatch_uncertain"
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";
export type Job = {
  id: string;
  workspaceId: string;
  rentalId: string;
  mode: "demo" | "live";
  status: JobStatus;
  idempotencyKey: string;
  requestJson: string;
  scenario: Scenario;
  callId: string | null;
  createdAt: string;
  updatedAt: string;
  decisionOrder?: number;
  grantExpiresAt: string;
  approvedBy: string | null;
  decision: Decision | null;
  snapshot: CallSnapshot | null;
  error: string | null;
  nextCheckAt: string | null;
};
export const activeStatuses: JobStatus[] = [
  "dispatching",
  "dispatch_uncertain",
  "queued",
  "in_progress",
];
export const terminalStatuses = ["completed", "failed", "canceled"];
export type DeskState = {
  mode: "demo" | "live";
  rentals: Rental[];
  jobs: Omit<Job, "requestJson" | "idempotencyKey">[];
  connection: {
    configured: boolean;
    liveEnabled: boolean;
    owner: boolean;
    signedIn: boolean;
    email: string | null;
    remainingCalls: number;
    callLimit: number;
  };
};
