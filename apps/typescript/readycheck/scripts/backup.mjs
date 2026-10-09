import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

if (existsSync('.env')) process.loadEnvFile('.env');
process.umask(0o077);
const source = resolve(process.env.DATABASE_PATH || './data/readycheck.sqlite');
const destination = resolve(process.argv[2] || './data/backups');
const db = new DatabaseSync(source, { readOnly: true });
try {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(destination, 'readycheck-'));
  const snapshot = join(directory, 'readycheck.sqlite');
  await backup(db, snapshot);
  const restored = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const checks = restored.prepare('PRAGMA integrity_check').all();
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok')
      throw new Error('Snapshot integrity check failed; do not restore this backup.');
  } finally {
    restored.close();
  }
  console.log(JSON.stringify({ status: 'verified', snapshot }));
} finally {
  db.close();
}
