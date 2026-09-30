import type { NormalizedSnapshot } from "../domain/evaluate-result";
import { phoneFingerprint } from "../domain/fingerprint";
import type { ProviderCallSnapshot } from "./call-provider";

function metaString(metadata: Record<string, unknown>, key: string): string {
  const v = metadata[key];
  return typeof v === "string" ? v : "";
}

export function mapProviderSnapshot(p: ProviderCallSnapshot): NormalizedSnapshot {
  return {
    callId: p.id,
    status: p.status,
    taskCompleted: p.taskCompleted,
    recipientStatus: p.recipientStatus,
    confidenceScore: p.confidenceScore,
    structuredResult: p.structuredResult,
    evidence: p.evidence,
    destinationFingerprint: p.dialedPhoneE164 ? phoneFingerprint(p.dialedPhoneE164) : "",
    meta: {
      intentId: metaString(p.metadata, "intentId"),
      requestHash: metaString(p.metadata, "requestHash"),
      taskVersion: metaString(p.metadata, "taskVersion"),
      schemaVersion: metaString(p.metadata, "schemaVersion"),
    },
  };
}
