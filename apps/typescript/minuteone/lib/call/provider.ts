/** Minimal JSON Schema subset needed to describe a call's expected structured result. */
export type JsonSchema = Record<string, unknown>;

export interface PlaceCallInput {
  phone: string;
  /** Natural-language instructions for the call agent: opening line + questions to ask. */
  task: string;
  resultSchema: JsonSchema;
}

/**
 * The raw telephony/connection outcome, independent of business-logic scoring.
 * "voicemail" and "failed" both collapse onto LeadCard outcome "no_answer" —
 * the fixed LeadCard.outcome enum has no room for them as distinct values.
 */
export type CallConnectionStatus =
  | "completed"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "declined"
  | "failed";

export interface CallResult {
  connectionStatus: CallConnectionStatus;
  /** Present only when connectionStatus === "completed"; matches the requested resultSchema. */
  structuredResult: Record<string, unknown> | null;
  evidence: string[];
  callId: string;
  durationS: number;
  transcriptRef?: string;
}

export interface CallProvider {
  placeCall(input: PlaceCallInput): Promise<CallResult>;
}
