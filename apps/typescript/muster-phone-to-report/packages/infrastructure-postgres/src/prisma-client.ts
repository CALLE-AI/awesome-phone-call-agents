import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "./generated/prisma/client.js";

export interface PostgresPoolHandle {
  readonly options: {
    readonly max: number;
  };
}

export function createPrismaClient(pool: PostgresPoolHandle): PrismaClient {
  // Keep pg out of the public persistence signature while rejecting structural impostors
  // before a vendor client can be constructed with an unowned connection resource.
  if (!(pool instanceof Pool)) {
    throw new TypeError("PostgreSQL persistence requires a composition-root-owned pool");
  }

  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
