import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) throw new Error("D1 binding DB is unavailable");
  return bindings.DB;
}
