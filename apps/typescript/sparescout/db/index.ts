import { drizzle } from "drizzle-orm/d1";
import { getRuntimeBindings } from "../lib/runtime-bindings";
import * as schema from "./schema";

export type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
};

export type D1Binding = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown[]>;
};

export function getOptionalD1(): D1Binding | undefined {
  return getRuntimeBindings().DB as D1Binding | undefined;
}

export function getD1(): D1Binding {
  const database = getOptionalD1();
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return database;
}

export function getDb() {
  return drizzle(getD1() as Parameters<typeof drizzle>[0], { schema });
}
