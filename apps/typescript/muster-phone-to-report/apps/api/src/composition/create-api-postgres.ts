import {
  createPostgresPersistence,
  type PostgresPersistence,
  validatePostgresConnectionString,
} from "@muster/infrastructure-postgres";
import { Pool } from "pg";

export interface ApiPostgresBinding extends PostgresPersistence {
  close(): Promise<void>;
}

export function createApiPostgresBinding(
  connectionString: string,
  options: { readonly probeTimeoutMs?: number } = {},
): ApiPostgresBinding {
  const validatedConnectionString = validatePostgresConnectionString(connectionString);
  const pool = new Pool({
    connectionString: validatedConnectionString,
    max: 5,
    connectionTimeoutMillis: 1_000,
  });
  const persistence = createPostgresPersistence(pool, {
    probeTimeoutMs: options.probeTimeoutMs ?? 500,
  });
  return Object.freeze({
    ...persistence,
    close: async () => {
      await persistence.disconnect();
      await pool.end();
    },
  });
}
