export type CallReelTurn = {
  offset_seconds?: number;
  speaker: string;
  text: string;
};

export type CallReelField = {
  field: string;
  value: unknown;
  supported: boolean;
  score: number;
  turnText?: string | null;
  turnOffset?: number | null;
};

export type CallReelProps = {
  household: string;
  disposition: string;
  transcript_turns: CallReelTurn[];
  structured_result?: Record<string, unknown>;
  linked: CallReelField[];
  peerLabel?: string;
};

export type CoverageReelProps = {
  dialed: number;
  reached: number;
  unaccounted: number;
  names?: string[];
};

export type TitleCardsProps = {
  event?: string;
};

export type ScopeReelProps = {
  candidate?: string;
  jurisdiction?: string;
  requested: string[];
  permitted: string[];
  blocked: Array<{ field: string; reason: string }>;
  transcript_turns?: CallReelTurn[];
  peerLabel?: string;
};

export type VerificationReelProps = {
  dialed: number;
  confirmed: number;
  blocked: number;
  names?: string[];
};
