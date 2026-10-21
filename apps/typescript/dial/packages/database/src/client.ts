import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { config } from '@dial/config';
import { logger } from '@dial/observability';
import * as schema from './schema.js';
import { MIGRATIONS } from './migrations.js';

/**
 * One database, two drivers.
 *
 * - DATABASE_URL set  -> real PostgreSQL over node-postgres (production).
 * - DATABASE_URL empty -> PGlite, which is genuine PostgreSQL compiled to WASM,
 *   stored on disk at .pgdata/. Real SQL, real constraints, real transactions --
 *   so a foreign key or unique-index violation fails in development exactly as
 *   it would in production. It is not a stub or an in-memory fake.
 *
 * PGlite is refused in production by the config layer.
 */

export type Db = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  driver: 'pglite' | 'postgres';
  close: () => Promise<void>;
}

let handle: DatabaseHandle | null = null;

/** Names the process that holds the directory. Not PGlite's own lock. */
const LOCK_FILE = 'dial-server.lock';

/**
 * Left behind when a database is found to be damaged, so the next start can
 * clear it. The move cannot happen in the process that found the damage: the
 * failed PGlite keeps the directory open for the life of that process, and
 * Windows will not rename a directory with open handles inside it.
 */
const CORRUPT_MARKER = 'dial-corrupt';

export async function createDatabase(options?: {
  url?: string;
  /** PGlite data directory; 'memory://' gives a throwaway instance for tests. */
  dataDir?: string;
}): Promise<DatabaseHandle> {
  const url = options?.url ?? config().databaseUrl;

  if (url) {
    const pg = await import('pg');
    const pool = new pg.default.Pool(poolSettings(url));

    // A pool swallows background errors by default; an idle client dropped by
    // the server (or by a provider suspending compute) would otherwise crash
    // the process as an unhandled 'error' event.
    pool.on('error', (error) => {
      logger.warn('idle postgres client errored', { error: (error as Error).message });
    });

    const db = drizzlePg(pool, { schema });
    return {
      db,
      driver: 'postgres',
      close: async () => {
        await pool.end();
      },
    };
  }

  const dataDir = options?.dataDir ?? process.env.PGLITE_DIR ?? '.pgdata';
  const client = await openPglite(dataDir);
  // The query surface drizzle exposes is identical across both drivers; the
  // cast keeps one Db type across the codebase instead of a union at every use.
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    driver: 'pglite',
    close: async () => {
      await client.close();
      await releaseDataDir(dataDir);
    },
  };
}

/**
 * Opens the on-disk database, surviving the two ways it goes wrong.
 *
 * PGlite is a single process holding a directory. Two servers started against
 * the same one do not queue politely -- they corrupt it, and every later start
 * dies with `Aborted()`, a WASM-level abort that says nothing about the cause.
 * That happened three times during development before the pattern was obvious,
 * and each time the fix was manual.
 *
 * So: refuse the second instance rather than let it do damage, clear a lock
 * left behind by a process that was killed, and if the directory is beyond
 * saving, move it aside and start fresh rather than leaving the app dead. The
 * old directory is preserved, never deleted -- this runs only in development,
 * but it is still somebody's data.
 */
async function openPglite(dataDir: string): Promise<PGlite> {
  // Throwaway instances share nothing and cannot conflict.
  if (dataDir.startsWith('memory://')) {
    const client = new PGlite(dataDir);
    await client.waitReady;
    return client;
  }

  await claimDataDir(dataDir);
  await clearIfMarkedCorrupt(dataDir);

  let client: PGlite | undefined;
  try {
    client = new PGlite(dataDir);
    await client.waitReady;
    return client;
  } catch (error) {
    /*
     * Release whatever the failed instance still holds before moving the
     * directory. Windows refuses to rename a directory that has open handles
     * inside it, and an abort during startup does not close them by itself --
     * without this the move fails and the "fresh" start reopens the same broken
     * directory, reporting the same error with the cause now hidden.
     */
    await client?.close().catch(() => undefined);

    /*
     * Mark it and stop. The directory cannot be moved from here -- the failed
     * instance still holds handles inside it -- so recovery is handed to the
     * next start, which has none.
     */
    await fs
      .writeFile(path.join(dataDir, CORRUPT_MARKER), (error as Error).message, 'utf8')
      .catch(() => undefined);
    await releaseDataDir(dataDir);

    logger.error('the local database is damaged', {
      dataDir,
      error: (error as Error).message,
      likelyCause: 'two servers running against the same directory, or one killed mid-write',
    });
    throw new Error(
      `The local database at ${dataDir} is damaged and cannot be opened. ` +
        'Start the server again and Dial will move it aside and begin a fresh one. ' +
        'This happens when two servers share the directory, which PGlite does not allow.',
    );
  }
}

/**
 * Clears a database the previous start found damaged.
 *
 * Runs before anything opens the directory, which is the only moment the move
 * can succeed. The damaged copy is kept, never deleted -- this is development
 * data, but it is still somebody's.
 */
async function clearIfMarkedCorrupt(dataDir: string): Promise<void> {
  const marker = path.join(dataDir, CORRUPT_MARKER);
  const found = await fs.readFile(marker, 'utf8').catch(() => null);
  if (found === null) return;

  const quarantined = `${dataDir}.corrupt-${timestamp()}`;
  await moveAside(dataDir, quarantined);
  logger.warn('moved a damaged database aside and started a fresh one', {
    dataDir,
    movedTo: quarantined,
    originalError: found.slice(0, 200),
  });
}

/**
 * Moves a directory out of the way, retrying while handles are released.
 *
 * Reported rather than swallowed. If the move quietly fails, the fresh start
 * opens the same broken directory and fails again with a message that now
 * points at the wrong cause.
 */
async function moveAside(from: string, to: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(
    `The local database at ${from} is unusable and could not be moved aside ` +
      `(${(lastError as Error)?.message}). Stop every running server, then ` +
      `delete or rename that directory by hand.`,
  );
}

/**
 * Refuses to open a database another Dial server already has.
 *
 * PGlite's own `postmaster.pid` cannot be used for this: it carries a sentinel
 * (-42) rather than a real process id, so every check reads as "nobody is
 * there" and a second server opens the directory and corrupts it. This lock
 * holds the actual pid, so a live instance is recognised and a stale file from
 * a killed process is cleared instead of blocking startup forever.
 */
async function claimDataDir(dataDir: string): Promise<void> {
  const lockPath = path.join(dataDir, LOCK_FILE);
  const existing = await fs.readFile(lockPath, 'utf8').catch(() => null);

  if (existing !== null) {
    const pid = Number.parseInt(existing.trim(), 10);
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid && isProcessAlive(pid)) {
      throw new Error(
        `Another Dial server (pid ${pid}) already has ${dataDir} open. PGlite ` +
          'allows one process at a time, and a second one corrupts the database. ' +
          'Stop the other server first.',
      );
    }
    logger.warn('clearing a database lock left by a process that is gone', { dataDir, pid });
  }

  await fs.mkdir(dataDir, { recursive: true }).catch(() => undefined);
  await fs.writeFile(lockPath, String(process.pid), 'utf8').catch(() => undefined);
}

/** Gives up the claim, so the next start does not have to reason about it. */
async function releaseDataDir(dataDir: string): Promise<void> {
  if (dataDir.startsWith('memory://')) return;
  await fs.rm(path.join(dataDir, LOCK_FILE), { force: true }).catch(() => undefined);
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence checks without delivering.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else, which still counts.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

export async function getDatabase(): Promise<DatabaseHandle> {
  if (!handle) handle = await createDatabase();
  return handle;
}

export async function closeDatabase(): Promise<void> {
  if (handle) {
    await handle.close();
    handle = null;
  }
}

/**
 * Splits a migration into individual statements.
 *
 * Necessary because PGlite executes through the extended query protocol, which
 * rejects multiple commands in one prepared statement ("cannot insert multiple
 * commands into a prepared statement"). The split is quote-aware so a semicolon
 * inside a string literal or a dollar-quoted body does not end a statement.
 */
export function splitStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inLineComment = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < sqlText.length; i += 1) {
    const char = sqlText[i]!;
    const next = sqlText[i + 1];

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (!inSingle && !dollarTag && char === '-' && next === '-') {
      inLineComment = true;
      current += char;
      continue;
    }
    if (dollarTag) {
      current += char;
      if (sqlText.startsWith(dollarTag, i)) {
        current += sqlText.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (!inSingle && char === '$') {
      const match = /^\$[A-Za-z_]*\$/.exec(sqlText.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (char === "'") {
      // '' inside a literal is an escaped quote, not a terminator.
      if (inSingle && next === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === ';' && !inSingle) {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Applies any migration not already recorded. Safe to run repeatedly. */
export async function runMigrations(db: Db): Promise<string[]> {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS _migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const existing = await db.execute<{ id: string }>(sql`SELECT id FROM _migrations`);
  const applied = new Set((existing.rows ?? []).map((r) => r.id));
  const ran: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    for (const statement of splitStatements(migration.sql)) {
      await db.execute(sql.raw(statement));
    }
    await db.execute(sql`INSERT INTO _migrations (id) VALUES (${migration.id})`);
    ran.push(migration.id);
    logger.info('migration applied', { migration: migration.id });
  }
  return ran;
}

export { schema };


/* ------------------------------------------------------- remote postgres */

/**
 * Pool settings for a managed Postgres over the network.
 *
 * The defaults are tuned for a database on the same machine, which is not
 * where this one lives. Three things differ:
 *
 *  - **Cold starts.** Providers that scale to zero (Neon suspends compute
 *    after a few minutes idle) take seconds to wake. node-postgres defaults
 *    to no connect timeout at all, so a wake-up either works or hangs; an
 *    explicit, generous one turns that into a bounded wait with a real error.
 *  - **Idle connections.** A pooler or a NAT will drop a connection that has
 *    been quiet, and the pool will hand out the dead one. Retiring them first,
 *    and keeping the rest alive at the TCP level, avoids that.
 *  - **Connection budget.** Free tiers cap connections, and Dial runs two
 *    processes (API and worker), each with its own pool.
 */
export function poolSettings(connectionString: string): {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  keepAlive: boolean;
  ssl?: { rejectUnauthorized: boolean };
} {
  const settings = {
    connectionString,
    // Two processes at 8 stays inside a 20-connection free-tier budget with
    // room for a migration or a psql session.
    max: 8,
    // Long enough for a suspended database to wake, short enough that a wrong
    // host fails with an error rather than appearing to hang.
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
  };

  /*
   * pg 8.23 reads `sslmode` from the URL but treats `require` as `verify-full`
   * -- full chain validation -- and warns that this will change. Providers
   * differ on whether their certificate chains satisfy that: Neon's are
   * publicly trusted and do, some others are not and do not.
   *
   * `sslmode=no-verify` is the explicit way to say "encrypt, do not verify".
   * It is honoured here rather than left to the driver, so the intent is
   * visible instead of depending on which pg version is installed.
   */
  if (/[?&]sslmode=no-verify\b/i.test(connectionString)) {
    return { ...settings, ssl: { rejectUnauthorized: false } };
  }

  return settings;
}
