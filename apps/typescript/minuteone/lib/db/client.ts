import * as schema from "./schema";

/**
 * Local/submission mode: no TURSO_DATABASE_URL set, falls back to a local SQLite file.
 * Netlify mode: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) point at a hosted Turso DB, since
 * Netlify functions have an ephemeral filesystem a local file can't survive on.
 */
const url = process.env.TURSO_DATABASE_URL ?? `file:${process.env.SQLITE_PATH ?? "./local.db"}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

// The remote-URL case uses the /web variants of @libsql/client and drizzle-orm/libsql — pure
// HTTP, no native bindings. The default @libsql/client pulls in the `libsql` native addon, which
// needs a platform-specific binary (@libsql/linux-x64-gnu etc.) that Next's file tracing doesn't
// reliably bundle for a Netlify function. Critically, drizzle-orm/libsql's own driver module
// imports the plain @libsql/client at ITS top level too (just to type its own createClient
// fallback) — so passing it an already-built web client isn't enough; drizzle-orm/libsql/web
// has to be imported instead, or the native import crashes on load regardless of which client
// object actually gets used. Local/submission mode still needs the native client and driver,
// since /web can't open an on-disk file. Plain `require` (not top-level `await import`) keeps
// this loadable by esbuild's CJS output for the standalone Netlify Function bundle
// (netlify/functions/sweep-scheduled.ts), which doesn't support top-level await.
/* eslint-disable @typescript-eslint/no-require-imports -- must stay synchronous, see above */
const { createClient } = process.env.TURSO_DATABASE_URL
  ? (require("@libsql/client/web") as typeof import("@libsql/client/web"))
  : (require("@libsql/client") as typeof import("@libsql/client"));

const { drizzle } = process.env.TURSO_DATABASE_URL
  ? (require("drizzle-orm/libsql/web") as typeof import("drizzle-orm/libsql/web"))
  : (require("drizzle-orm/libsql") as typeof import("drizzle-orm/libsql"));
/* eslint-enable @typescript-eslint/no-require-imports */

const client = createClient({ url, authToken });

export const db = drizzle(client, { schema });
