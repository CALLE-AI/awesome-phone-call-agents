export type CallStatus = "awaiting_approval" | "queued" | "in_progress" | "needs_review" | "failed" | "canceled" | "applied" | "rejected";
export type CallOutcome = "confirmed" | "reschedule_requested" | "declined" | "unknown";
export type FakeOutcome = CallOutcome | "failed";
export type WorkflowType = "appointment_management" | "lead_follow_up" | "shift_coordination";

export interface WorkflowTemplate {
  id: WorkflowType;
  label: string;
  business: string;
  description: string;
  recipientLabel: string;
  recordLabel: string;
  applyLabel: string;
  demoEmployeeId: string;
  demoShiftId: string;
  demoOutcome: FakeOutcome;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  business?: string;
  phone: string;
  locale: string;
  region: string;
}

export interface Shift {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  role: string;
  status: "scheduled" | "confirmed" | "rescheduled";
}

export interface CallResult {
  outcome: CallOutcome;
  requested_date: string;
  requested_time: string;
  contact_message: string;
  confidence: number;
  needs_manager_review: boolean;
}

export interface TranscriptTurn { speaker: string; text: string }

export interface CallJob {
  id: string;
  employeeId: string;
  shiftId: string;
  workflowType: WorkflowType;
  proposedDate: string;
  proposedTime: string;
  fakeOutcome: FakeOutcome;
  task: string;
  status: CallStatus;
  provider: "fake" | "live";
  providerStatus: string | null;
  providerCallId: string | null;
  outcome: CallOutcome | null;
  result: CallResult | null;
  evidence: string[];
  transcript: TranscriptTurn[];
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  approvalId: string;
}

export interface Approval { id: string; jobId: string; status: "pending" | "approved" | "rejected" | "canceled"; createdAt: string; decidedAt: string | null }
export interface Event { id: string; type: string; message: string; createdAt: string; jobId?: string }
export interface RuntimeConfig {
  provider: "fake" | "live";
  liveEnabled: boolean;
  liveRequested: boolean;
  liveReady: boolean;
  apiKeyConfigured: boolean;
  baseUrlTrusted: boolean;
  testPhoneConfigured: boolean;
  testPhoneMasked: string;
  testRegionConfigured: boolean;
  testLocaleConfigured: boolean;
  workspaceConfigured: boolean;
  baseUrl: string;
  language: string;
  region: string;
  workflows: WorkflowTemplate[];
}
export interface AppState { version: number; executionMode?: "fake" | "live"; employees: Employee[]; shifts: Shift[]; jobs: CallJob[]; approvals: Approval[]; events: Event[]; runtime: RuntimeConfig }
export interface Preview { workflowType: WorkflowType; workflow: WorkflowTemplate; employee: Pick<Employee, "id" | "name" | "role" | "phone">; shift: Shift; proposedDate: string; proposedTime: string; task: string; provider: string; fakeOutcome?: FakeOutcome; safety: { ok: boolean; reason: string } }
