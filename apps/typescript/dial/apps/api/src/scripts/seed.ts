/**
 * Seeds a local development account so the app has something to sign in with.
 *
 *   npm run seed
 *   SEED_EMAIL=me@local.test SEED_PASSWORD='correct horse' npm run seed
 *
 * Idempotent: an existing account is left as it is and reported. Nothing here
 * is suitable for production -- production accounts come from the sign-up
 * endpoint, and the password is printed to stdout when generated, which is
 * exactly as secure as a dev convenience needs to be and no more.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDatabase, closeDatabase, users, contacts } from '@dial/database';
import { ensureSettings, newId } from '@dial/orchestrator';
import { hashPassword } from '../auth.js';

const DEFAULT_EMAIL = 'demo@dial.local';

async function main(): Promise<void> {
  const email = (process.env.SEED_EMAIL ?? DEFAULT_EMAIL).trim().toLowerCase();
  const password = process.env.SEED_PASSWORD ?? randomBytes(12).toString('base64url');

  const handle = await getDatabase();
  const db = handle.db;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    console.log(`Account ${email} already exists — nothing to do.`);
    await closeDatabase();
    return;
  }

  const id = newId('usr');
  await db.insert(users).values({
    id,
    email,
    name: process.env.SEED_NAME ?? 'Demo User',
    passwordHash: await hashPassword(password),
  });
  await ensureSettings(db, id);

  // A couple of contacts so the direct-dial path ("call Malik") is exercisable
  // immediately. Numbers are documentation examples, diallable by nobody real.
  const samples = [
    { name: 'Malik at the garage', phoneE164: '+971555501234' },
    { name: 'FixLab', phoneE164: '+353871234567' },
  ];
  for (const sample of samples) {
    await db
      .insert(contacts)
      .values({ id: newId('con'), userId: id, ...sample })
      .onConflictDoNothing();
  }

  console.log(`Seeded ${email}`);
  if (!process.env.SEED_PASSWORD) {
    console.log(`Password (generated, shown once): ${password}`);
  }
  await closeDatabase();
}

try {
  await main();
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
