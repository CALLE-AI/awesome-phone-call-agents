/**
 * Core domain types for VendorDesk.
 *
 * Naming follows CALL-E's Phase 1 beta API/SDK shape:
 * https://github.com/CALLE-AI/call-e-integrations (see README "API (Preview)")
 */

/** A single vendor to call as part of a sourcing run. */
export interface VendorTask {
  id: string;
  vendorName: string;
  /** E.164 format, e.g. "+15551234567" */
  phoneNumber: string;
  /** CALL-E recipient region code, e.g. "US", "GB", "IN" */
  region: string;
  /** CALL-E recipient locale, e.g. "en-US" */
  locale: string;
  item: string;
  targetQuantity: number;
}

/** Structured data CALL-E extracts once a vendor call completes. */
export interface ExtractedQuote {
  inStock: boolean;
  unitPrice: number | null;
  alternativeOffered: string | null;
  deliveryAvailable: boolean | null;
  representativeName: string | null;
  notes: string | null;
}

export type CallJobStatus = "pending" | "in-progress" | "completed" | "failed";

/** One outbound call job and its lifecycle state. */
export interface CallJob {
  id: string;
  calleCallId: string | null;
  task: VendorTask;
  status: CallJobStatus;
  quote: ExtractedQuote | null;
  transcript: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Request body for POST /api/calls/dispatch */
export interface DispatchRequestBody {
  item: string;
  targetQuantity: number;
  vendors: Array<{
    vendorName: string;
    phoneNumber: string;
    region?: string;
    locale?: string;
  }>;
}

/** CALL-E's JSON-schema-shaped result_schema, as documented in the API preview. */
export interface CalleResultSchema {
  type: "object";
  required: string[];
  properties: Record<string, { type: string; enum?: string[] }>;
  additionalProperties: false;
}

/** CALL-E's real webhook envelope: an event wrapper, not a flat payload.
 * Confirmed via CALL-E support debugging issue #97, then via a real successful
 * call's payload — event types seen so far include "call.completed" and
 * "call.result_validation_failed" (call connected fine, but the reply didn't
 * match our result_schema — e.g. a test hotline with no real pricing to give).
 *
 * IMPORTANT: the call identifier field is `data.id`, NOT `data.call_id` —
 * an earlier version of this code assumed `call_id` and silently rejected
 * every real webhook delivery as a result.
 */
export interface CalleWebhookEvent {
  id: string; // event id, e.g. "evt_5e13fa14720eadf38392c7e5b"
  type: string; // e.g. "call.completed" | "call.result_validation_failed" | "call.failed"
  created_at?: string;
  data: {
    id: string; // the actual call id, e.g. "call_uanRM3CIrRGxF9HLDpFkRw"
    status?: string; // e.g. "completed"
    structured_result?: Record<string, unknown> | null;
    summary?: string | null;
    failure_code?: string | null;
    failure_message?: string | null;
    metadata?: Record<string, unknown>;
    recipients?: Array<{
      attempts?: Array<{
        transcript_turns?: Array<{
          offset_seconds?: number;
          speaker?: string;
          text?: string;
        }>;
      }>;
    }>;
  };
}
