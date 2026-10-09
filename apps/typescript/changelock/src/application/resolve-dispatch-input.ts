import { recipientResultSchema } from "../domain/schemas";
import { getIntent, getTrustedContact, type Db } from "../infrastructure/db";
import type { ReservedCallInput } from "../provider/call-provider";

export async function resolveDispatchInput(db: Db, intentId: string): Promise<ReservedCallInput> {
  const intent = await getIntent(db, intentId);
  if (!intent) throw new Error("intent not found");
  const contact = await getTrustedContact(db, intent.trustedContactId);
  if (!contact || !contact.active) throw new Error("trusted contact unavailable");
  return {
    task: intent.taskText,
    phoneE164: contact.phoneE164,
    region: contact.region,
    locale: contact.locale,
    recipientResultSchema: { ...recipientResultSchema },
    metadata: {
      intentId: intent.id,
      caseId: intent.caseId,
      requestHash: intent.requestHash,
      taskVersion: intent.taskVersion,
      schemaVersion: intent.schemaVersion,
    },
    idempotencyKey: intent.idempotencyKey,
  };
}
