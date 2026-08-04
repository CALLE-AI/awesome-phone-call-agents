import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/persistence/schema";

const localDatabaseUrl =
  "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose";

type DatabaseConnection = ReturnType<typeof createDatabase>;

const globalDatabase = globalThis as typeof globalThis & {
  fieldCloseDatabase?: DatabaseConnection;
};

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 5,
    prepare: false,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL?.trim() || localDatabaseUrl;

  if (!globalDatabase.fieldCloseDatabase) {
    globalDatabase.fieldCloseDatabase = createDatabase(connectionString);
  }

  return globalDatabase.fieldCloseDatabase;
}

export type FieldCloseDatabase = ReturnType<typeof createDatabase>["db"];
