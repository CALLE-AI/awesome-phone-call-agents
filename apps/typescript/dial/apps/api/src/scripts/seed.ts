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

  /*
   * Two contacts so the contacts screen and the direct-dial path ("call Malik")
   * have something to work with straight away.
   *
   * Both numbers are in the NANP range reserved for fiction, 555-0100 to
   * 555-0199. That detail matters more than it looks. A seed that writes a
   * *plausible* number -- a well-formed mobile in a real country code -- hands
   * whoever flips TEST_PROVIDER=real next a stranger to ring, and "it looked
   * like an example" is not a defence to the person whose phone rang.
   *
   * Reserved-fiction numbers are refused by `isBlockedNumber`, so the
   * direct-dial path can be exercised right up to the refusal and no further.
   * To place a real call, add your own number as a contact.
   */
  const samples = [
    { name: 'Malik at the garage', phoneE164: '+12025550143' },
    { name: 'FixLab', phoneE164: '+14155550117' },
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
