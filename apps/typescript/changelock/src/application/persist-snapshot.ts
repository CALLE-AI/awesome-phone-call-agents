import { structuredResultValidator } from "../domain/schemas";
import { redactSensitiveText } from "../domain/redact";
import type { NormalizedSnapshot } from "../domain/evaluate-result";
import { insertSnapshot, newId, now, type Db } from "../infrastructure/db";

export function persistSnapshot(
  db: Db,
  intentId: string,
  snapshot: NormalizedSnapshot,
  verificationMode: "replay" | "live",
): void {
  const parsed = structuredResultValidator.safeParse(snapshot.structuredResult);
  insertSnapshot(db, {
    id: newId("snap"),
    intentId,
    providerCallId: snapshot.callId,
    providerStatus: snapshot.status,
    taskCompleted: snapshot.taskCompleted,
    recipientStatus: snapshot.recipientStatus,
    confidenceScore: snapshot.confidenceScore,
    structuredResultJson: parsed.success ? JSON.stringify(parsed.data) : null,
    evidenceJson: JSON.stringify(snapshot.evidence.map(redactSensitiveText)),
    receivedAt: now(),
    verificationMode,
  });
}
