import { openDatabase, type Db } from "../../infrastructure/db";
import { seedFixtures, SEED_EVENTS } from "../../fixtures/seed-data";
import { importChangeRequest } from "../../application/import-change-request";

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const db = openDatabase();
  seedFixtures(db);
  const count = db.prepare("SELECT COUNT(*) c FROM change_requests").get() as { c: number };
  if (count.c === 0) {
    for (const event of SEED_EVENTS) {
      importChangeRequest(db, {
        externalEventId: event.externalEventId,
        vendorCode: event.vendorCode,
        requestedAt: event.requestedAt,
        sourceSystem: event.sourceSystem,
        sourceReference: event.sourceReference,
        requestContactName: event.requestContactName,
        requestContactPhone: event.requestContactPhone,
        newDestinationLabel: event.newDestinationLabel,
      });
    }
  }
  cached = db;
  return db;
}
