/**
 * Verifies DATABASE_URL before anything else depends on it.
 *
 * A wrong connection string otherwise shows up as the API failing to boot,
 * which says nothing about which part is wrong. This connects, reports what it
 * reached and how long that took, and names the specific problem when it
 * cannot -- a bad password and an unreachable host need different fixes.
 *
 *   npm run db:check
 */
import { getDatabase, closeDatabase, MIGRATIONS } from '@dial/database';
import { sql } from 'drizzle-orm';

const url = process.env['DATABASE_URL'] ?? '';

if (!url) {
  console.error('DATABASE_URL is empty.');
  console.error('Dial is using the embedded PGlite database at .pgdata/.');
  console.error('Set DATABASE_URL in .env to point at a real Postgres, then run this again.');
  process.exit(1);
}

// Never print the password, even to a local terminal.
let shown = url;
try {
  const parsed = new URL(url);
  shown = `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}${parsed.search}`;
} catch {
  shown = '(unparseable URL)';
}
console.log(`Connecting to ${shown}`);

const startedAt = Date.now();

/*
 * A pg pool connects lazily, so building the handle proves nothing -- the
 * first real query is what reaches the server. Everything that can fail
 * because of the connection string therefore has to sit inside one catch,
 * or the failure escapes as a driver stack trace instead of an explanation.
 */
const handle = await getDatabase();

try {
  const version = await handle.db.execute<{ version: string }>(sql`SELECT version()`);
  const connectedMs = Date.now() - startedAt;

  const pinged = Date.now();
  await handle.db.execute(sql`SELECT 1`);
  const roundTripMs = Date.now() - pinged;

  // Missing is a fine answer here: it means migrations have not run yet.
  const applied = await handle.db
    .execute<{ id: string }>(sql`SELECT id FROM _migrations ORDER BY id`)
    .catch(() => ({ rows: [] as Array<{ id: string }> }));

  console.log(`\nConnected in ${connectedMs} ms  (driver: ${handle.driver})`);
  console.log(`Round trip:  ${roundTripMs} ms`);
  console.log(`Server:      ${(version.rows?.[0]?.version ?? 'unknown').split(',')[0]}`);

  const done = (applied.rows ?? []).map((row) => row.id);
  const pending = MIGRATIONS.filter((m) => !done.includes(m.id)).map((m) => m.id);
  console.log(`Migrations:  ${done.length} of ${MIGRATIONS.length} applied`);

  if (pending.length) {
    console.log(`\n${pending.length} not applied yet: ${pending.join(', ')}`);
    console.log('Run: npm run db:migrate');
  } else {
    console.log('\nThe database is ready.');
  }
} catch (error) {
  // Drizzle wraps driver errors, so the useful text is on the cause.
  const cause = (error as { cause?: Error }).cause;
  const message = cause?.message ?? (error as Error).message ?? String(error);
  console.error(`\nCould not reach the database after ${Date.now() - startedAt} ms.`);
  console.error(`  ${message}`);
  console.error('\n' + diagnose(message));
  await closeDatabase().catch(() => undefined);
  process.exit(1);
}

await closeDatabase();

/** Turns a driver error into the thing that is actually wrong. */
function diagnose(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('password authentication failed') || lower.includes('role') && lower.includes('does not exist')) {
    return 'The username or password is wrong. Copy the connection string again from your provider.';
  }
  if (lower.includes('enotfound') || lower.includes('eai_again')) {
    return 'That host does not resolve. Check the hostname, and that you copied the whole string.';
  }
  if (lower.includes('timeout')) {
    return [
      'The connection timed out. Either the host is unreachable, or a suspended',
      'database took longer than 15 seconds to wake. Try once more before',
      'assuming the URL is wrong.',
    ].join('\n');
  }
  if (lower.includes('certificate') || lower.includes('self-signed') || lower.includes('self signed')) {
    return [
      'The TLS certificate was rejected. pg treats ?sslmode=require as full',
      'chain validation. If your provider does not use a publicly trusted',
      'certificate, change the URL to end with ?sslmode=no-verify instead.',
    ].join('\n');
  }
  if (lower.includes('econnrefused')) {
    return 'Nothing is listening there. Check the port, and that the database is running.';
  }
  if (lower.includes('does not exist')) {
    return 'That database name does not exist on the server.';
  }
  return 'Check the connection string against the one your provider shows.';
}
