/** Recorded CALL-E payloads for offline contract tests. */

/**
 * The statuses a CALL-E call reports. `result_validation_failed` is the status
 * `spec.md` section 3 names for a call whose result failed validation, and it
 * is the one that lands a run in the `no_result` terminal state.
 */
export type CallStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled"
  | "result_validation_failed";

/**
 * The two spellings CALL-E uses for a failed result validation. The bare form
 * is the call status. The namespaced form carries the event-type namespace, and
 * a re-fetch or an operator selecting a rehearsal may repeat it.
 */
export const RESULT_VALIDATION_FAILED = [
  "result_validation_failed",
  "call.result_validation_failed",
] as const;

export interface TranscriptTurnFixture {
  offset_seconds: number;
  speaker: string;
  text: string;
}

export interface CallAttemptFixture {
  id: string;
  phone: string;
  status: CallStatus;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  transcript_turns: TranscriptTurnFixture[];
  provider_call_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

export interface CallRecipientFixture {
  id: string;
  phones: string[];
  locale: string | null;
  region: string | null;
  status: CallStatus;
  structured_result: unknown | null;
  summary: string | null;
  attempts: CallAttemptFixture[];
}

export interface CallTaskFixture {
  id: string;
  object: "call_task";
  status: CallStatus;
  task: string;
  recipients: CallRecipientFixture[];
  structured_result: unknown | null;
  summary: string | null;
  task_completed: boolean;
  completion_confidence: { score: number; label: string } | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CallEventFixture {
  id: string;
  type: string;
  call_id: string;
  created_at: string;
  level: string;
  status: CallStatus;
  message: string;
  details: Record<string, unknown>;
}

export interface CallEventPageFixture {
  object: "list";
  data: CallEventFixture[];
  next_cursor: string | null;
}

export interface CallFixtures {
  completed: CallTaskFixture;
  completedEvents: CallEventPageFixture;
  failed: CallTaskFixture;
  transcript: TranscriptTurnFixture[];
}

const fixtureDirectory = new URL("../../../testdata/calle/", import.meta.url);

async function readFixture<T>(filename: string): Promise<T> {
  const text = await Deno.readTextFile(new URL(filename, fixtureDirectory));
  return JSON.parse(text) as T;
}

/** Loads every committed CALL-E fixture without contacting CALL-E. */
export async function loadCallFixtures(): Promise<CallFixtures> {
  const [completed, completedEvents, failed, transcript] = await Promise.all([
    readFixture<CallTaskFixture>("call-completed.json"),
    readFixture<CallEventPageFixture>("call-completed-events.json"),
    readFixture<CallTaskFixture>("call-failed.json"),
    readFixture<TranscriptTurnFixture[]>("transcript.json"),
  ]);

  return { completed, completedEvents, failed, transcript };
}
