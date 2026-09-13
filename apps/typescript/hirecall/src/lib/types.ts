import type { ScreeningResult } from "@/lib/call-result-schema";
import type { ScoreConfig } from "@/lib/score-config";

export type RecruiterDecision = "" | "call_again" | "next_round" | "rejected";

export type CallStatus =
  | "not_called"
  | "queued"
  | "calling"
  | "talking"
  | "completed"
  | "no_answer"
  | "failed";

export type CallResponse = {
  id: string;
  batchId: string;
  candidateId: string;
  calleCallId: string;
  status: CallStatus;
  startedAt: string;
  endedAt: string;
  durationSeconds: number | null;
  result: ScreeningResult | null;
  summary: string;
  score: number | null;
  passScore: number;
  decision: RecruiterDecision;
  createdAt: string;
};

export type Candidate = {
  id: string;
  batchId: string;
  name: string;
  phone: string;
  consent: boolean;
  resumeUrl: string;
  resumeText: string;
  resumeFetchedAt: string;
  resumeFetchError: string;
  callPrompt: string;
  jobRole: string;
  sourceFilename: string;
  createdAt: string;
  active: boolean;
  callStatus: CallStatus;
  calleCallId: string;
  callAttempt: number;
  callResponse: CallResponse | null;
};

export type CandidateInput = {
  name: string;
  phone: string;
  consent: boolean;
  resumeUrl: string;
  jobRole: string;
};

export type Batch = {
  id: string;
  filename: string;
  jobRole: string;
  systemPrompt: string;
  scoreConfig: ScoreConfig;
  scoreCriteriaSaved: boolean;
  createdAt: string;
  candidateCount: number;
  readyCount: number;
  consentedCount: number;
  queuedCount: number;
  active: boolean;
};
