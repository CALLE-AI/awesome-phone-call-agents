/** Guarded Call-E AI-agent types. Synthetic identities only. */

export type AgentMode = "assist" | "simulate" | "replay";
export type AgentChannel = "sms" | "call" | "mcp";
export type AgentRisk = "low" | "medium" | "high" | "critical";

export type AgentTurnState =
  | "completed"
  | "awaiting_approval"
  | "escalated"
  | "blocked"
  | "refused";

export type AgentIntentName =
  | "greeting"
  | "survey_assist"
  | "place_call"
  | "callback"
  | "refuse"
  | "distress"
  | "pii_share"
  | "operator_request"
  | "memory_recall"
  | "unknown";

export type AgentToolName =
  | "recall_memory"
  | "record_survey_answer"
  | "request_callback"
  | "draft_call_plan"
  | "place_outbound_call"
  | "escalate_operator";

export type AgentContact = {
  id: string;
  displayName: string;
  locale: string;
  consentGranted: boolean;
  dnc: boolean;
  triageState?: "routine" | "contact_chw_today" | "urgent_in_person_care";
};

export type AgentMessage = {
  id?: string;
  channel: AgentChannel;
  text: string;
};

export type AgentIntent = {
  name: AgentIntentName;
  confidence: number;
  reasons: string[];
};

export type AgentPolicy = {
  allowed: boolean;
  risk: AgentRisk;
  reasons: string[];
  requiresApproval: boolean;
  requiredApprovals: number;
  approvalAction: ApprovalAction | null;
  escalate: boolean;
  suppressOutreach: boolean;
  consentOk: boolean;
};

export type AgentPlan = {
  goal: string;
  steps: string[];
  tools: AgentToolName[];
};

export type ToolInvocation = {
  name: AgentToolName;
  args: Record<string, unknown>;
  status: "skipped" | "executed" | "blocked" | "pending_approval";
  result?: unknown;
};

export type AgentResponse = {
  text: string;
  channel: AgentChannel;
};

export type AgentTurn = {
  id: string;
  state: AgentTurnState;
  input: AgentMessage;
  sanitizedText: string;
  contactId: string;
  intent: AgentIntent;
  plan: AgentPlan;
  policy: AgentPolicy;
  tools: ToolInvocation[];
  response: AgentResponse;
  approvalId?: string;
  handoffId?: string;
  at: string;
};

export type ApprovalAction =
  | "execute_tools"
  | "place_call"
  | "persist_pii"
  | "resume_outreach";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type ApprovalDecision = {
  operatorId: string;
  decision: "approve" | "deny";
  at: string;
  notes?: string;
};

export type ApprovalTicket = {
  id: string;
  turnId: string;
  contactId: string;
  action: ApprovalAction;
  risk: AgentRisk;
  reasons: string[];
  requiredApprovals: number;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decisions: ApprovalDecision[];
  summary: string;
};

export type AgentRequest = {
  contact: AgentContact;
  message: AgentMessage;
  mode?: AgentMode;
};

export type AgentHandleResult = {
  turn: AgentTurn;
  auditId: string;
  explanations: string[];
  handoffId?: string;
  approvalId?: string;
};

export type AgentClock = {
  nowIso: () => string;
};

export type AgentIdFactory = {
  next: (prefix: string) => string;
};
