export type SafetyMode = "info_only" | "approval_required" | "autonomous";
export type MissionStatus = "draft" | "planned" | "queued" | "dialing" | "connected" | "understanding" | "negotiating" | "confirming" | "completed" | "needs_review" | "failed";
export type MissionCategory =
  | "appointment"
  | "quote"
  | "lead"
  | "availability"
  | "service"
  | "followup";

export interface MissionInput {
  title: string;
  targetName: string;
  phoneE164: string;
  category: MissionCategory;
  goal: string;
  questions: string[];
  constraints: string[];
  desiredOutcome: string;
  safetyMode: SafetyMode;
  demoMode: boolean;
}

export interface ExecutionPlan {
  objective: string;
  target: string;
  questions: string[];
  constraints: string[];
  success_condition: string;
  agentInstructions: string;
  resultSchema: Record<string, unknown>;
  safety: { mode: SafetyMode; guardrails: string[] };
}

export interface CallEvent {
  id: string;
  missionId: string;
  ts: string;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface StructuredResult {
  status: string;
  objective_achieved: boolean;
  availability: { date: string; time: string }[];
  price: string | null;
  requirements: string[];
  notes: string[];
  next_action: string;
  confidence: number;
  questionsAnswered: string[];
  questionsUnanswered: string[];
  entities: string[];
  constraintsSatisfied: string[];
  transcriptExcerpt?: { speaker: string; text: string; offset_seconds: number }[];
  summary: string;
  recommendedNextStep: string;
}

export interface Mission extends MissionInput {
  id: string;
  number: number;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  plan: ExecutionPlan | null;
  callId: string | null;
  calleRunId: string | null;
  events: CallEvent[];
  result: StructuredResult | null;
  elapsedSeconds: number;
  provider: "calle-live" | "calle-mock";
  error: string | null;
}
