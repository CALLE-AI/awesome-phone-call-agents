import { openDatabase } from "../src/infrastructure/db";
import { seedFixtures, SEED_EVENTS, SEED_VENDORS, SEED_CONTACTS } from "../src/fixtures/seed-data";
import { importChangeRequest } from "../src/application/import-change-request";

async function main() {
  const db = await openDatabase();
  try {
    await seedFixtures(db);

    let imported = 0;
    for (const event of SEED_EVENTS) {
      const result = await importChangeRequest(db, {
        externalEventId: event.externalEventId,
        vendorCode: event.vendorCode,
        requestedAt: event.requestedAt,
        sourceSystem: event.sourceSystem,
        sourceReference: event.sourceReference,
        requestContactName: event.requestContactName,
        requestContactPhone: event.requestContactPhone,
        newDestinationLabel: event.newDestinationLabel,
      });
      if (!result.duplicate) imported += 1;
    }

    process.stdout.write(
      `Seeded ${SEED_VENDORS.length} vendors, ${SEED_CONTACTS.length} trusted contacts, ` +
        `${imported} new change requests (${SEED_EVENTS.length - imported} already present).\n`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
