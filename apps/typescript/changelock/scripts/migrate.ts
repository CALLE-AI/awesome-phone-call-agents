import { openDatabase } from "../src/infrastructure/db";

async function main() {
  const db = await openDatabase();
  db.close();
  process.stdout.write("Migrations applied.\n");
}

main().catch((err) => {
  process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
