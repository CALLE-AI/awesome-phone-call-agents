import { openDatabase, type Db } from "../../infrastructure/db";
import { seedFixtures, SEED_EVENTS } from "../../fixtures/seed-data";
import { importChangeRequest } from "../../application/import-change-request";

// Single-flight async initializer: concurrent callers share one in-flight
// initialization; once it resolves, the resolved promise is cached for the
// process lifetime. A rejected attempt clears the cache (guarded on identity
// so a newer attempt is never clobbered) so the next caller retries instead of
// being pinned to the same failure forever.
export function initOnce<T>(init: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (cached) return cached;
    const pending = init();
    pending.catch(() => {
      if (cached === pending) cached = null;
    });
    cached = pending;
    return pending;
  };
}

// open, migrate (inside openDatabase), seed fixtures, and import demo events
// exactly once per process. Every step is idempotent — imports dedupe on
// external_event_id — so a shared Turso database always gains the four demo
// cases without duplicating them.
const initDb = initOnce(async () => {
  const db = await openDatabase();
  await seedFixtures(db);
  for (const event of SEED_EVENTS) {
    await importChangeRequest(db, {
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
  return db;
});

export function getDb(): Promise<Db> {
  return initDb();
}
