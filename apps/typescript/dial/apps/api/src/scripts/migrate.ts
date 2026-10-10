import { getDatabase, runMigrations, closeDatabase } from '@dial/database';

const handle = await getDatabase();
const applied = await runMigrations(handle.db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
await closeDatabase();
