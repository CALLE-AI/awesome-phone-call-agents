export type PersonaId =
  | "cooperative"
  | "voicemail"
  | "partial"
  | "emergency"
  | "wrong_person"
  | "gatekeeper"
  | "ivr_maze"
  | "hostile"
  | "unsupported_claim";

export type TranscriptTurn = {
  offset_seconds: number;
  speaker: "bot" | "user";
  text: string;
};

export type PersonaFixture = {
  id: PersonaId;
  status: string;
  task_completed: boolean;
  completion_confidence: { score: number; label: string };
  evidence: string[];
  structured_result: Record<string, unknown>;
  recipient_structured_result: Record<string, unknown>;
  disposition: string;
  transcript_turns: TranscriptTurn[];
};

export type StoredCall = {
  id: string;
  createdAt: number;
  persona: PersonaId;
  request: unknown;
  fixture: PersonaFixture;
};
