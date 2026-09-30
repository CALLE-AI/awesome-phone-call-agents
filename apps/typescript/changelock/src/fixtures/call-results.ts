import confirmed from "./call-results/confirmed.json";
import denied from "./call-results/denied.json";
import unableToVerify from "./call-results/unable-to-verify.json";
import unreachable from "./call-results/unreachable.json";
import sensitiveData from "./call-results/sensitive-data.json";
import malformed from "./call-results/malformed.json";
import inProgress from "./call-results/in-progress.json";
import type { NormalizedSnapshot } from "../domain/evaluate-result";
import type { CallIntent } from "../domain/types";

const FIXTURES = {
  confirmed,
  denied,
  "unable-to-verify": unableToVerify,
  unreachable,
  "sensitive-data": sensitiveData,
  malformed,
  "in-progress": inProgress,
} as const;

export type FixtureName = keyof typeof FIXTURES;

export const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];

interface FixtureShape {
  status: string;
  taskCompleted: boolean | null;
  recipientStatus: string | null;
  confidenceScore: number | null;
  failureCode: string | null;
  structuredResult: Record<string, unknown> | null;
  evidence: string[];
}

export function loadCallResultFixture(
  name: FixtureName,
  intent: CallIntent,
): NormalizedSnapshot {
  const f = FIXTURES[name] as FixtureShape;
  return {
    callId: `replay_${name}_v${intent.version}`,
    status: f.status,
    taskCompleted: f.taskCompleted,
    recipientStatus: f.recipientStatus,
    confidenceScore: f.confidenceScore,
    structuredResult: f.structuredResult,
    evidence: f.evidence,
    destinationFingerprint: intent.destinationFingerprint,
    meta: {
      intentId: intent.id,
      requestHash: intent.requestHash,
      taskVersion: intent.taskVersion,
      schemaVersion: intent.schemaVersion,
    },
  };
}
