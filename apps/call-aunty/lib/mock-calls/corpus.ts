/** Synthetic Call Aunty / Call-E corpus index.
 * This file intentionally contains no live phone numbers, credentials, or personal data.
 */
import type { SensitiveCategory } from "./types";

export type CorpusChannel = "sms" | "api" | "mcp";
export type CorpusScenario = "completed" | "refusal" | "callback" | "timeout";

export interface CorpusFixture {
  id: string;
  channel: CorpusChannel;
  scenario: CorpusScenario;
  synthetic: true;
  replayId?: string;
  branch?: SensitiveCategory | "none";
}

const CHANNELS: readonly CorpusChannel[] = ["sms", "api", "mcp"];
const SCENARIOS: readonly CorpusScenario[] = ["refusal", "callback", "timeout", "completed"];

function pad(index: number): string {
  return String(index).padStart(3, "0");
}

function buildIndexedCorpus(count: number): CorpusFixture[] {
  return Array.from({ length: count }, (_, offset) => ({
    id: `corpus-${pad(offset + 1)}`,
    channel: CHANNELS[offset % CHANNELS.length],
    scenario: SCENARIOS[offset % SCENARIOS.length],
    synthetic: true as const,
    branch: "none" as const,
  }));
}

/** Original 128-row SMS/API/MCP matrix from the expanded Call-E corpus. */
export const CALL_AUNTY_CORPUS_BASE: readonly CorpusFixture[] = buildIndexedCorpus(128);

/** Replay and sensitive-answer rows added on top of the original matrix. */
export const CALL_AUNTY_CORPUS_EXTENSIONS: readonly CorpusFixture[] = [
  {
    id: "corpus-129",
    channel: "sms",
    scenario: "completed",
    synthetic: true,
    replayId: "replay-e2e-complete",
    branch: "none",
  },
  {
    id: "corpus-130",
    channel: "sms",
    scenario: "callback",
    synthetic: true,
    replayId: "replay-e2e-callback-resume",
    branch: "none",
  },
  {
    id: "corpus-131",
    channel: "api",
    scenario: "timeout",
    synthetic: true,
    replayId: "replay-e2e-transient-retry",
    branch: "none",
  },
  {
    id: "corpus-132",
    channel: "sms",
    scenario: "refusal",
    synthetic: true,
    replayId: "replay-e2e-refusal",
    branch: "consent_refused",
  },
  {
    id: "corpus-133",
    channel: "sms",
    scenario: "completed",
    synthetic: true,
    replayId: "replay-e2e-distress",
    branch: "distress",
  },
  {
    id: "corpus-134",
    channel: "sms",
    scenario: "completed",
    synthetic: true,
    replayId: "replay-e2e-pii",
    branch: "pii_risk",
  },
  {
    id: "corpus-135",
    channel: "sms",
    scenario: "completed",
    synthetic: true,
    replayId: "replay-e2e-skip-remaining",
    branch: "skip_requested",
  },
  {
    id: "corpus-136",
    channel: "sms",
    scenario: "completed",
    synthetic: true,
    branch: "negative_experience",
  },
  {
    id: "corpus-137",
    channel: "sms",
    scenario: "refusal",
    synthetic: true,
    branch: "contact_opt_out",
  },
  {
    id: "corpus-138",
    channel: "sms",
    scenario: "callback",
    synthetic: true,
    branch: "human_followup",
  },
  {
    id: "corpus-139",
    channel: "mcp",
    scenario: "completed",
    synthetic: true,
    replayId: "replay-e2e-mcp-confirm",
    branch: "none",
  },
  {
    id: "corpus-140",
    channel: "api",
    scenario: "completed",
    synthetic: true,
    replayId: "replay-e2e-complete",
    branch: "none",
  },
  {
    id: "corpus-141",
    channel: "api",
    scenario: "timeout",
    synthetic: true,
    replayId: "replay-e2e-provider-failover",
    branch: "none",
  },
  {
    id: "corpus-142",
    channel: "api",
    scenario: "timeout",
    synthetic: true,
    replayId: "replay-e2e-failover-exhausted",
    branch: "none",
  },
  {
    id: "corpus-143",
    channel: "sms",
    scenario: "callback",
    synthetic: true,
    branch: "human_followup",
  },
  {
    id: "corpus-144",
    channel: "api",
    scenario: "completed",
    synthetic: true,
    branch: "distress",
  },
  {
    id: "corpus-145",
    channel: "mcp",
    scenario: "refusal",
    synthetic: true,
    branch: "consent_refused",
  },
  {
    id: "corpus-146",
    channel: "sms",
    scenario: "timeout",
    synthetic: true,
    branch: "none",
  },
];

export const CALL_AUNTY_CORPUS: readonly CorpusFixture[] = [
  ...CALL_AUNTY_CORPUS_BASE,
  ...CALL_AUNTY_CORPUS_EXTENSIONS,
];

export function getCorpusFixture(id: string): CorpusFixture {
  const fixture = CALL_AUNTY_CORPUS.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unknown corpus fixture: ${id}`);
  return fixture;
}

export function countByChannel(channel: CorpusChannel): number {
  return CALL_AUNTY_CORPUS.filter((item) => item.channel === channel).length;
}

export function countByScenario(scenario: CorpusScenario): number {
  return CALL_AUNTY_CORPUS.filter((item) => item.scenario === scenario).length;
}

export function corpusReplayIds(): string[] {
  return [...new Set(CALL_AUNTY_CORPUS.map((item) => item.replayId).filter((id): id is string => Boolean(id)))];
}
