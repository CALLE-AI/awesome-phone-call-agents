// Snapshot types matching what @call-e/calle returns, declared locally so
// dry-run mode and tests work with no SDK/network involved.

export interface JsonSchema {
  type: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: string[];
  description?: string;
  additionalProperties?: boolean;
}

export interface TranscriptTurn {
  offset_seconds: number | null;
  speaker: "bot" | "user" | "unknown";
  text: string;
}

export interface Confidence {
  score: number;
  label: string;
}

export type CallFlow = "CONFIRM" | "BACKFILL" | "QUALIFY" | "HELLO_WORLD";

export interface RunCallInput {
  flow: CallFlow;
  businessId: string;
  /** The contact's real (possibly fictional seed) number, for records/masking. */
  phone: string;
  task: string;
  resultSchema: JsonSchema;
  /** FK pointers for the CallLog row. */
  appointmentId?: string;
  waitlistEntryId?: string;
  leadId?: string;
  /** Deterministic mock used when CALLE_DRY_RUN=true. */
  dryRunResult: Record<string, unknown>;
  idempotencyKey: string;
}

export interface NormalizedCallResult {
  callLogId: string;
  calleCallId: string | null;
  status: string; // completed | failed | canceled | dry_run
  taskCompleted: boolean | null;
  completionConfidence: Confidence | null;
  structuredResult: Record<string, unknown> | null;
  summary: string | null;
  transcript: TranscriptTurn[];
  dryRun: boolean;
}
