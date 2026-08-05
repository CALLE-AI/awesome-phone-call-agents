import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  resolveDatabaseSslMode,
  resolveDatabaseUrl,
} from "@/config/database-url";
import * as schema from "@/persistence/schema";

type DatabaseConnection = ReturnType<typeof createDatabase>;

const globalDatabase = globalThis as typeof globalThis & {
  fieldCloseDatabase?: DatabaseConnection;
};

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    max: 5,
    prepare: false,
    ssl: resolveDatabaseSslMode(connectionString),
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export function getDatabase() {
  const nodeEnvironment =
    process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
        ? "test"
        : "development";
  const connectionString = resolveDatabaseUrl(
    process.env.DATABASE_URL,
    nodeEnvironment,
  );

  if (!globalDatabase.fieldCloseDatabase) {
    globalDatabase.fieldCloseDatabase = createDatabase(connectionString);
  }

  return globalDatabase.fieldCloseDatabase;
}

export type FieldCloseDatabase = ReturnType<typeof createDatabase>["db"];
