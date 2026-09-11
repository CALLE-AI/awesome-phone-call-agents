import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { FieldCloseDatabase } from "@/persistence/database";
import { contacts } from "@/persistence/schema";

type WorkflowTransaction = Parameters<
  Parameters<FieldCloseDatabase["transaction"]>[0]
>[0];

export async function lockRecipientSuppression(
  transaction: WorkflowTransaction,
  workspaceId: string,
  phoneLookupHash: string,
) {
  const lockKey = `fieldclose:closeout:${workspaceId}:${phoneLookupHash}`;

  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}

export async function lockAndCheckRecipientSuppression(
  transaction: WorkflowTransaction,
  workspaceId: string,
  phoneLookupHash: string,
) {
  await lockRecipientSuppression(transaction, workspaceId, phoneLookupHash);

  const [suppressed] = await transaction
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        eq(contacts.phoneLookupHash, phoneLookupHash),
        isNotNull(contacts.doNotCallAt),
      ),
    )
    .limit(1);

  return Boolean(suppressed);
}
